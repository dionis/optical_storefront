import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { LENS_CONFIG_MODULE } from "../modules/lens-config/index";
import type LensConfigModuleService from "../modules/lens-config/service";
import { recordAudit } from "./audit";
import { cellMatchesFinish, type LensFinish } from "./lens-finish";
import { deriveLensCode, type LensCellInput, type LensDesignInput, type LensDesignPatch } from "./lens-design";
import { invalidatePriceCaches } from "./price-matrix-data";
import { lensBaseKey } from "./pricing-overview";

/**
 * Writers of the lens designs and their cells (docs/PRICE-MATRIX.md §12).
 * A design or cell that sold stays in the database so past sales keep their
 * labels and margins: deleting a sold design archives it (`is_active = false`,
 * gone from the POS, the web and the matrix); a cell is soft-deleted.
 */

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
const svcOf = (c: MedusaContainer) => c.resolve<LensConfigModuleService>(LENS_CONFIG_MODULE);

type Row = Record<string, unknown>;

async function findDesign(container: MedusaContainer, code: string): Promise<Row | null> {
  const rows = (await svcOf(container).listLensDesigns({ code } as never)) as unknown as Row[];
  return rows.find((r) => !r["deleted_at"]) ?? null;
}

/** Whether any sale (till facts or web order lines) carried this design. */
export async function lensDesignWasSold(container: MedusaContainer, code: string): Promise<boolean> {
  const pg = pgOf(container);
  try {
    if (await pg("sale_fact").whereNull("deleted_at").where("lens_design", code).first("id")) return true;
  } catch {
    // No till facts table: the order lines decide alone.
  }
  const line = await pg("order_line_item")
    .whereNull("deleted_at")
    .whereRaw(`metadata->'lens_config'->>'design_code' = ?`, [code])
    .first("id");
  return Boolean(line);
}

/** `POST /admin/pricing/lens-designs`. `code_taken` when the code exists (live, archived or deleted). */
export async function createLensDesign(container: MedusaContainer, d: LensDesignInput, actorId: string | null): Promise<{ code: string } | { reason: string }> {
  const pg = pgOf(container);
  const existing = (await pg("lens_design").select("code", "sort")) as Array<{ code: string; sort: number | null }>;
  const taken = new Set(existing.map((r) => String(r.code)));
  if (d.code && taken.has(d.code)) return { reason: "code_taken" };
  const code = d.code ?? deriveLensCode(d.label_es || d.label_en, taken);
  const sort = existing.reduce((m, r) => Math.max(m, Number(r.sort) || 0), 0) + 10;
  const row = {
    code,
    category: d.category,
    label_es: d.label_es,
    label_en: d.label_en,
    requires_rx: true,
    requires_add: d.requires_add,
    tier: d.tier,
    use_es: d.use_es,
    use_en: d.use_en,
    sort,
    is_active: true,
  };
  await svcOf(container).createLensDesigns(row as never);
  await recordAudit(container, { actorId, action: "catalog.create", entity: "lens_design", entityId: code, after: row });
  invalidatePriceCaches();
  return { code };
}

/** `POST /admin/pricing/lens-designs/:code`. `design_not_found` when there is no live design. */
export async function updateLensDesign(container: MedusaContainer, code: string, patch: LensDesignPatch, actorId: string | null): Promise<{ code: string } | { reason: string }> {
  const row = await findDesign(container, code);
  if (!row) return { reason: "design_not_found" };
  const update: Row = { id: row["id"], ...patch };
  await svcOf(container).updateLensDesigns([update] as never);
  const before: Row = {};
  for (const k of Object.keys(patch)) before[k] = row[k] ?? null;
  await recordAudit(container, { actorId, action: "catalog.update", entity: "lens_design", entityId: code, before, after: patch as Row });
  invalidatePriceCaches();
  return { code };
}

/** Soft-deletes the stores' own prices and discounts of the given lens keys (or key prefix). */
async function dropStoreRows(pg: Knex, match: { keys?: string[]; prefix?: string }): Promise<void> {
  const now = new Date();
  const scope = (q: Knex.QueryBuilder) => (match.prefix ? q.where("item_key", "like", `${match.prefix}%`) : q.whereIn("item_key", match.keys ?? []));
  await scope(pg("lens_store_price").whereNull("deleted_at").where("item_kind", "base")).update({ deleted_at: now }).catch(() => 0);
  await scope(pg("store_item_discount").whereNull("deleted_at").where("item_kind", "lens")).update({ deleted_at: now }).catch(() => 0);
}

/**
 * `DELETE /admin/pricing/lens-designs/:code`: never sold → the design, its
 * cells, its treatment prices and the stores' own prices / discounts of it go;
 * sold → archived (`is_active = false`). Reasons: `design_not_found`.
 */
export async function deleteLensDesign(container: MedusaContainer, code: string, actorId: string | null): Promise<{ deleted: true } | { archived: true } | { reason: string }> {
  const row = await findDesign(container, code);
  if (!row) return { reason: "design_not_found" };
  const svc = svcOf(container);
  const pg = pgOf(container);
  const sold = await lensDesignWasSold(container, code);
  if (sold) {
    await svc.updateLensDesigns([{ id: row["id"], is_active: false }] as never);
  } else {
    const now = new Date();
    await pg("lens_base_price").whereNull("deleted_at").where({ design_code: code }).update({ deleted_at: now });
    await pg("lens_treatment_price").whereNull("deleted_at").where({ design_code: code }).update({ deleted_at: now }).catch(() => 0);
    await dropStoreRows(pg, { prefix: `${code}:` });
    await svc.deleteLensDesigns([String(row["id"])]);
  }
  await recordAudit(container, {
    actorId,
    action: "catalog.delete",
    entity: "lens_design",
    entityId: code,
    before: { code, label_es: row["label_es"] ?? null, category: row["category"] ?? null },
    after: sold ? { is_active: false, archived: true } : null,
  });
  invalidatePriceCaches();
  return sold ? { archived: true } : { deleted: true };
}

/** Every live material, in list order (the «add material» picker). */
export async function listLensMaterials(container: MedusaContainer): Promise<Array<{ code: string; label_es: string; label_en: string; max_abs: number | null; is_active: boolean }>> {
  const rows = (await pgOf(container)("lens_material").whereNull("deleted_at").orderBy("sort", "asc").select("code", "label_es", "label_en", "max_abs", "is_active")) as Row[];
  return rows.map((r) => ({
    code: String(r["code"]),
    label_es: String(r["label_es"] ?? ""),
    label_en: String(r["label_en"] ?? ""),
    max_abs: r["max_abs"] == null ? null : Number(r["max_abs"]),
    is_active: r["is_active"] !== false,
  }));
}

/**
 * `POST /admin/pricing/lens-designs/:code/cells`: a priced (design, material,
 * finish) cell, creating the material first when it is new. Reasons:
 * `design_not_found`, `bad_material` (no such material), `cell_exists`.
 */
export async function addLensCell(container: MedusaContainer, designCode: string, cell: LensCellInput, actorId: string | null): Promise<{ key: string; material_code: string } | { reason: string }> {
  const design = await findDesign(container, designCode);
  if (!design) return { reason: "design_not_found" };
  const pg = pgOf(container);
  const svc = svcOf(container);
  let materialCode: string;
  if ("code" in cell.material) {
    const m = (await pg("lens_material").whereNull("deleted_at").where({ code: cell.material.code }).first("code", "is_active")) as Row | undefined;
    if (!m) return { reason: "bad_material" };
    if (m["is_active"] === false) await pg("lens_material").where({ code: cell.material.code }).update({ is_active: true });
    materialCode = cell.material.code;
  } else {
    const all = (await pg("lens_material").select("code", "sort")) as Array<{ code: string; sort: number | null }>;
    materialCode = deriveLensCode(cell.material.label_es || cell.material.label_en, new Set(all.map((r) => String(r.code))));
    const sort = all.reduce((m, r) => Math.max(m, Number(r.sort) || 0), 0) + 10;
    const row = { code: materialCode, label_es: cell.material.label_es, label_en: cell.material.label_en, max_abs: cell.material.max_abs ?? 99, sort, is_active: true };
    await svc.createLensMaterials(row as never);
    await recordAudit(container, { actorId, action: "catalog.create", entity: "lens_material", entityId: materialCode, after: row });
  }
  const rows = (await svc.listLensBasePrices({ design_code: designCode, material_code: materialCode } as never)) as unknown as Row[];
  if (rows.some((r) => !r["deleted_at"] && cellMatchesFinish(r as { finish?: unknown }, cell.finish))) return { reason: "cell_exists" };
  await svc.createLensBasePrices({ design_code: designCode, material_code: materialCode, finish: cell.finish, price_cents: cell.price_cents, cost_cents: cell.cost_cents } as never);
  const key = lensBaseKey(designCode, materialCode, cell.finish, String(design["category"] ?? ""));
  await recordAudit(container, {
    actorId,
    action: "price.change",
    entity: "lens_base_price",
    entityId: key,
    after: { price_cents: cell.price_cents, cost_cents: cell.cost_cents },
  });
  invalidatePriceCaches();
  return { key, material_code: materialCode };
}

/**
 * `DELETE /admin/pricing/lens-designs/:code/cells?material=&finish=`: the cell
 * stops being offered (soft delete; past sales keep their figures), with the
 * stores' own prices and discounts of it. Reasons: `design_not_found`, `cell_not_found`.
 */
export async function deleteLensCell(container: MedusaContainer, designCode: string, materialCode: string, finish: LensFinish, actorId: string | null): Promise<{ deleted: true } | { reason: string }> {
  const design = await findDesign(container, designCode);
  if (!design) return { reason: "design_not_found" };
  const svc = svcOf(container);
  const rows = (await svc.listLensBasePrices({ design_code: designCode, material_code: materialCode } as never)) as unknown as Row[];
  const cell = rows.find((r) => !r["deleted_at"] && cellMatchesFinish(r as { finish?: unknown }, finish));
  if (!cell) return { reason: "cell_not_found" };
  await svc.softDeleteLensBasePrices([String(cell["id"])]);
  const category = String(design["category"] ?? "");
  const key = lensBaseKey(designCode, materialCode, finish, category);
  // The store rows of the cell, under the key as written then (the stock key has no suffix).
  await dropStoreRows(pgOf(container), { keys: [...new Set([key, `${designCode}:${materialCode}:${finish}`])] });
  await recordAudit(container, {
    actorId,
    action: "catalog.delete",
    entity: "lens_base_price",
    entityId: key,
    before: { price_cents: cell["price_cents"] ?? null, cost_cents: cell["cost_cents"] ?? null },
    after: null,
  });
  invalidatePriceCaches();
  return { deleted: true };
}

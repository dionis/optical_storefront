import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { LENS_CONFIG_MODULE } from "../modules/lens-config/index";
import type LensConfigModuleService from "../modules/lens-config/service";
import { recordAudit } from "./audit";
import { photoPricesAfter, type PhotoCategory, type TreatmentPatch } from "./price-matrix";
import { invalidatePriceCaches } from "./price-matrix-data";

/**
 * Editing and removing a treatment of «Productos y precios» (docs/PRICE-MATRIX.md
 * v2 «Tratamientos»): a photochromic (`lens_photo_option`) or an
 * anti-reflective (`lens_ar_option`), found by its `code`.
 *
 * «SOLD» = a sale line carries the code: a till fact (`sale_fact.lens_photo` /
 * `lens_ar`) or an order line's lens configuration
 * (`order_line_item.metadata.lens_config.photo_code` / `ar_code`, web and till).
 * A sold treatment is never deleted — it is switched off (`is_active = false`),
 * so its receipts and margins keep resolving its labels and costs.
 */

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
const lensSvc = (c: MedusaContainer) => c.resolve<LensConfigModuleService>(LENS_CONFIG_MODULE);

export type TreatmentType = "photo" | "ar";
const TABLE: Record<TreatmentType, string> = { photo: "lens_photo_option", ar: "lens_ar_option" };

/** The live option with this code: its type and row. `type` narrows the search; null when none. */
export async function findTreatment(
  container: MedusaContainer,
  code: string,
  type: TreatmentType | null
): Promise<{ type: TreatmentType; row: Record<string, unknown> } | { reason: string } | null> {
  const pg = pgOf(container);
  const types: TreatmentType[] = type ? [type] : ["photo", "ar"];
  const hits: Array<{ type: TreatmentType; row: Record<string, unknown> }> = [];
  for (const t of types) {
    const row = (await pg(TABLE[t]).whereNull("deleted_at").where("code", code).first()) as Record<string, unknown> | undefined;
    if (row) hits.push({ type: t, row });
  }
  if (hits.length > 1) return { reason: "bad_type" };
  return hits[0] ?? null;
}

/** Whether a sale line ever carried this treatment. */
export async function treatmentWasSold(container: MedusaContainer, type: TreatmentType, code: string): Promise<boolean> {
  const pg = pgOf(container);
  const column = type === "photo" ? "lens_photo" : "lens_ar";
  try {
    if (await pg("sale_fact").whereNull("deleted_at").where(column, code).first("id")) return true;
  } catch {
    // No till facts table: the order lines decide alone.
  }
  const key = type === "photo" ? "photo_code" : "ar_code";
  const line = await pg("order_line_item")
    .whereNull("deleted_at")
    .whereRaw(`metadata->'lens_config'->>'${key}' = ?`, [code])
    .first("id");
  return Boolean(line);
}

const num = (v: unknown): number | null => (v == null || v === "" ? null : Math.round(Number(v)));

/**
 * `POST /admin/pricing/treatments/:code`. Reasons: `treatment_not_found`,
 * `bad_type`, `bad_value` (a photochromic left with no category priced).
 * Audited as `catalog.update` with the fields before and after.
 */
export async function updateTreatment(
  container: MedusaContainer,
  input: { code: string; type: TreatmentType | null; patch: TreatmentPatch },
  actorId: string | null
): Promise<{ type: TreatmentType; code: string } | { reason: string }> {
  const found = await findTreatment(container, input.code, input.type);
  if (!found) return { reason: "treatment_not_found" };
  if ("reason" in found) return found;
  const { type, row } = found;
  const p = input.patch;
  const update: Record<string, unknown> = { id: row["id"] };
  if (p.label_es !== undefined) update["label_es"] = p.label_es;
  if (p.label_en !== undefined) update["label_en"] = p.label_en;
  if (p.is_active !== undefined) update["is_active"] = p.is_active;
  if (p.cost_cents !== undefined) update["cost_cents"] = p.cost_cents;
  if (type === "ar") {
    if (p.ar_group !== undefined) update["ar_group"] = p.ar_group;
    if (p.prices && "ar" in p.prices) update["price_cents"] = p.prices.ar;
  } else if (p.prices && !("ar" in p.prices)) {
    const current = { sv: num(row["price_sv_cents"]), bifocal: num(row["price_bifocal_cents"]), prog: num(row["price_prog_cents"]) } as Record<PhotoCategory, number | null>;
    const next = photoPricesAfter(current, p.prices);
    if (!next) return { reason: "bad_value" };
    update["price_sv_cents"] = next.sv;
    update["price_bifocal_cents"] = next.bifocal;
    update["price_prog_cents"] = next.prog;
  }
  if (type === "ar" && p.prices && !("ar" in p.prices)) return { reason: "bad_value" };
  const svc = lensSvc(container);
  if (type === "photo") await svc.updateLensPhotoOptions([update] as never);
  else await svc.updateLensArOptions([update] as never);
  const before: Record<string, unknown> = {};
  for (const k of Object.keys(update)) if (k !== "id") before[k] = row[k] ?? null;
  const after: Record<string, unknown> = { ...update };
  delete after["id"];
  await recordAudit(container, { actorId, action: "catalog.update", entity: TABLE[type], entityId: input.code, before, after });
  invalidatePriceCaches();
  return { type, code: input.code };
}

/**
 * `DELETE /admin/pricing/treatments/:code`: never sold → the option row is
 * deleted (its code becomes free again) together with the stores' own prices
 * and discounts of it; sold → `is_active = false`. Reasons:
 * `treatment_not_found`, `bad_type`. Audited as `catalog.delete`.
 */
export async function deleteTreatment(
  container: MedusaContainer,
  input: { code: string; type: TreatmentType | null },
  actorId: string | null
): Promise<{ deleted: true; type: TreatmentType } | { archived: true; type: TreatmentType } | { reason: string }> {
  const found = await findTreatment(container, input.code, input.type);
  if (!found) return { reason: "treatment_not_found" };
  if ("reason" in found) return found;
  const { type, row } = found;
  const svc = lensSvc(container);
  const sold = await treatmentWasSold(container, type, input.code);
  if (sold) {
    if (type === "photo") await svc.updateLensPhotoOptions([{ id: row["id"], is_active: false }] as never);
    else await svc.updateLensArOptions([{ id: row["id"], is_active: false }] as never);
  } else {
    if (type === "photo") await svc.deleteLensPhotoOptions([String(row["id"])]);
    else await svc.deleteLensArOptions([String(row["id"])]);
    // The stores' own prices / promotions of an option that no longer exists.
    const pg = pgOf(container);
    const now = new Date();
    const keyMatch = type === "photo" ? (q: Knex.QueryBuilder) => q.where("item_key", "like", `${input.code}:%`) : (q: Knex.QueryBuilder) => q.where("item_key", input.code);
    await keyMatch(pg("lens_store_price").whereNull("deleted_at").where("item_kind", type)).update({ deleted_at: now }).catch(() => 0);
    await keyMatch(pg("store_item_discount").whereNull("deleted_at").where("item_kind", type)).update({ deleted_at: now }).catch(() => 0);
  }
  await recordAudit(container, {
    actorId,
    action: "catalog.delete",
    entity: TABLE[type],
    entityId: input.code,
    before: { code: input.code, label_es: row["label_es"] ?? null, is_active: row["is_active"] ?? null },
    after: sold ? { is_active: false, archived: true } : null,
  });
  invalidatePriceCaches();
  return sold ? { archived: true, type } : { deleted: true, type };
}

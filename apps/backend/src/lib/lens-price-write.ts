import type { MedusaContainer } from "@medusajs/framework/types";
import { LENS_CONFIG_MODULE } from "../modules/lens-config/index";
import type LensConfigModuleService from "../modules/lens-config/service";
import { clearLensCellCostCache } from "./lens-cost";
import { cellMatchesFinish, type LensFinish } from "./lens-finish";
import { lensBaseKey, parseLensBaseKey } from "./pricing-overview";

/**
 * Writes of the owner's MASTER lens list (the lens-config tables the whole
 * chain quotes from), shared by `POST /admin/pricing/lenses` and the price
 * matrix (`POST /admin/pricing/matrix/cell`, lib/price-matrix-data.ts), so the
 * two screens can never write a cell two different ways.
 *
 *   base   "<design>:<material>[:<finish>]"   price or lab cost of the cell
 *   photo  "<code>:<sv|bifocal|prog>"         price or lab cost in that category
 *          "<code>" (cost only)               the same cost in every category
 *   ar     "<code>"                           price or cost of the treatment
 *
 * Amounts in CENTS. A price is never removed from the master (null = 0, the
 * route refuses it first); a cost of null goes back to "unknown".
 */

const svcOf = (c: MedusaContainer) => c.resolve<LensConfigModuleService>(LENS_CONFIG_MODULE);

/** The category of a design, for the key and finish rules; null when unknown. */
export async function lensDesignCategory(container: MedusaContainer, design_code: string): Promise<string | null> {
  const rows = (await svcOf(container).listLensDesigns({ code: design_code })) as unknown as Record<string, unknown>[];
  const design = rows.find((r) => !r["deleted_at"]);
  return design ? String(design["category"] ?? "") : null;
}

/**
 * A store cell's key as `lensBaseKey` spells it, whatever the panel sent
 * ("prog-mid:cr39:digital" → "prog-mid:cr39"), so the quote finds it.
 */
export async function canonicalLensBaseKey(container: MedusaContainer, key: string): Promise<string> {
  const parts = parseLensBaseKey(key);
  if (!parts) return key;
  const category = await lensDesignCategory(container, parts.design_code);
  return lensBaseKey(parts.design_code, parts.material_code, parts.finish, category);
}

const PHOTO_COLUMN: Record<string, string> = { sv: "price_sv_cents", bifocal: "price_bifocal_cents", prog: "price_prog_cents" };
const PHOTO_COST_COLUMN: Record<string, string> = { sv: "cost_sv_cents", bifocal: "cost_bifocal_cents", prog: "cost_prog_cents" };

/** Writes one cell of the owner's master list; a `reason` code when the item does not exist. */
export async function writeLensMaster(
  container: MedusaContainer,
  kind: string,
  key: string,
  field: "price" | "cost",
  amountCents: number | null
): Promise<string | null> {
  const svc = svcOf(container);
  if (kind === "base") {
    const parts = parseLensBaseKey(key);
    if (!parts) return "bad_key";
    const { design_code, material_code } = parts;
    const category = await lensDesignCategory(container, design_code);
    if (category === null) return "unknown_item";
    // A progressive has one cell and it is digital: a "stock" write on it
    // would create a second cell the quote never reads.
    const finish: LensFinish = category === "prog" ? "digital" : parts.finish;
    if (finish !== parts.finish) return "finish_unavailable";
    const rows = (await svc.listLensBasePrices({ design_code, material_code })) as unknown as Record<string, unknown>[];
    const cell = rows.find((r) => !r["deleted_at"] && cellMatchesFinish(r as { finish?: unknown }, finish));
    if (field === "cost") {
      // Cost on a cell that is not priced yet: nothing to attach it to.
      if (!cell) return "unknown_item";
      await svc.updateLensBasePrices([{ id: cell["id"], cost_cents: amountCents }] as never);
    } else if (cell) {
      await svc.updateLensBasePrices([{ id: cell["id"], price_cents: amountCents ?? 0 }] as never);
    } else {
      await svc.createLensBasePrices({ design_code, material_code, finish, price_cents: amountCents ?? 0 } as never);
    }
    // Margins read the cell's cost through a process cache (lib/lens-cost.ts).
    clearLensCellCostCache();
    return null;
  }
  if (kind === "photo") {
    const [code, category] = key.split(":");
    if (!code || (category !== undefined && !PHOTO_COLUMN[category]) || (field === "price" && category === undefined)) return "bad_key";
    const rows = (await svc.listLensPhotoOptions({ code })) as unknown as Record<string, unknown>[];
    const row = rows.find((r) => !r["deleted_at"]);
    if (!row) return "unknown_item";
    if (field === "price") {
      await svc.updateLensPhotoOptions([{ id: row["id"], [PHOTO_COLUMN[category as string]]: amountCents ?? 0 }] as never);
    } else if (category !== undefined) {
      // Each category has its own lab cost (a progressive blank costs more).
      await svc.updateLensPhotoOptions([{ id: row["id"], [PHOTO_COST_COLUMN[category]]: amountCents }] as never);
    } else {
      // No category: the same cost everywhere (the old single figure too).
      await svc.updateLensPhotoOptions([{ id: row["id"], cost_cents: amountCents, cost_sv_cents: amountCents, cost_bifocal_cents: amountCents, cost_prog_cents: amountCents }] as never);
    }
    return null;
  }
  if (kind === "ar") {
    const rows = (await svc.listLensArOptions({ code: key })) as unknown as Record<string, unknown>[];
    const row = rows.find((r) => !r["deleted_at"]);
    if (!row) return "unknown_item";
    await svc.updateLensArOptions([
      field === "cost" ? { id: row["id"], cost_cents: amountCents } : { id: row["id"], price_cents: amountCents ?? 0 },
    ] as never);
    return null;
  }
  return "bad_kind";
}

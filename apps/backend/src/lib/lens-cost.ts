import type { MedusaContainer } from "@medusajs/framework/types";
import { defaultLensFinish, resolveLensFinish, type LensFinish } from "./lens-finish";
import { LENS_CONFIG_MODULE } from "../modules/lens-config/index";
import type LensConfigModuleService from "../modules/lens-config/service";

/**
 * The lab's cost of a lens cell, for margins (lib/costing.ts).
 *
 * `lens_base_price.cost_cents` is the real lab price list, typed by the owner
 * next to the selling price (Precios y costos → Lentes). When a sold cell has
 * one, it IS the lens material cost of that line; the `lens_design` /
 * `lens_material` cost rules remain the fallback for cells without one and for
 * databases that have not run the finish migration.
 *
 * Mirrors lib/frame-cost.ts: a process cache warmed by `listCostRules`, so
 * `computeCostSheet` stays synchronous and pure, and a cache that was never
 * loaded answers null — the rules then decide, exactly as before this existed.
 */

export interface LensCellCostRow {
  design_code: string;
  material_code: string;
  finish: LensFinish;
  cost_cents: number | null;
}

/**
 * The lookup `computeCostSheet` takes. `finish` null = the design's default
 * (stock, digital for a progressive): what a sale recorded before finishes
 * existed, or a sale_fact row without one, is costed with the only cell it
 * could have been cut from.
 */
export type LensCostLookup = (design_code: string, material_code: string, finish: LensFinish | null) => number | null;

const TTL_MS = 60_000;

interface Cache {
  at: number;
  cells: Map<string, number | null>;
  category: Map<string, string>;
  loaded: boolean;
}

let cache: Cache | null = null;

const keyOf = (design: string, material: string, finish: LensFinish) => `${design}:${material}:${finish}`;

/** Pure resolution over a set of rows (the lookup and the tests). */
export function lensCellCostFrom(
  rows: readonly LensCellCostRow[],
  categories: ReadonlyMap<string, string>,
  design_code: string,
  material_code: string,
  finish: LensFinish | null
): number | null {
  const effective = resolveLensFinish(finish, categories.get(design_code) ?? null);
  const row = rows.find((r) => r.design_code === design_code && r.material_code === material_code && r.finish === effective);
  return row && row.cost_cents != null ? Math.max(0, Math.round(row.cost_cents)) : null;
}

/** Replace the cache with these rows (the loader and the tests). */
export function setLensCellCostCache(rows: readonly LensCellCostRow[], categories: ReadonlyMap<string, string> = new Map()): void {
  cache = {
    at: Date.now(),
    cells: new Map(rows.map((r) => [keyOf(r.design_code, r.material_code, r.finish), r.cost_cents == null ? null : Math.max(0, Math.round(r.cost_cents))])),
    category: new Map(categories),
    loaded: true,
  };
}

/** Drop the cache: after an edit of a cell's cost, and between tests. */
export function clearLensCellCostCache(): void {
  cache = null;
}

/** The default lookup of `computeCostSheet`. Synchronous, never throws, null until the table was read. */
export function lensCellCostCents(design_code: string, material_code: string, finish: LensFinish | null): number | null {
  if (!cache?.loaded) return null;
  const effective = resolveLensFinish(finish, cache.category.get(design_code) ?? null);
  return cache.cells.get(keyOf(design_code, material_code, effective)) ?? null;
}

/** True once the table was read and at least one cell carries a cost: the lab's list is a cost source (lib/sales-insights.ts costSourcesMissing). */
export function lensCellCostsKnown(): boolean {
  if (!cache?.loaded) return false;
  for (const v of cache.cells.values()) if (v !== null && v > 0) return true;
  return false;
}

/** Reads the matrix cells (and the designs' categories) into the cache; a failure keeps the previous state. */
export async function ensureLensCellCostCache(container: MedusaContainer): Promise<void> {
  if (cache && Date.now() - cache.at < TTL_MS) return;
  try {
    const svc = container.resolve<LensConfigModuleService>(LENS_CONFIG_MODULE);
    const [designs, cells] = await Promise.all([
      svc.listLensDesigns({}, { take: 1000 }) as unknown as Promise<Record<string, unknown>[]>,
      svc.listLensBasePrices({}, { take: 5000 }) as unknown as Promise<Record<string, unknown>[]>,
    ]);
    const categories = new Map(designs.filter((d) => !d["deleted_at"]).map((d) => [String(d["code"]), String(d["category"] ?? "")]));
    const rows: LensCellCostRow[] = cells
      .filter((c) => !c["deleted_at"])
      .map((c) => {
        const design_code = String(c["design_code"]);
        // Before the finish migration the column is absent: the row is the design's only cell.
        const raw = c["finish"];
        const finish: LensFinish = raw === undefined ? defaultLensFinish(categories.get(design_code)) : raw === "digital" ? "digital" : "stock";
        const cost = c["cost_cents"];
        return { design_code, material_code: String(c["material_code"]), finish, cost_cents: cost == null ? null : Number(cost) };
      });
    setLensCellCostCache(rows, categories);
  } catch {
    // Keep whatever we had; `lensCellCostCents` answers null until a read succeeds.
  }
}

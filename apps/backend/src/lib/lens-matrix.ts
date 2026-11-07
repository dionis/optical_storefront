import type { Knex } from "@mikro-orm/knex";
import { defaultLensFinish, parseLensFinish, type LensFinish } from "./lens-finish";
import { applyStoreLensPrice, lensArKey, lensBaseKey, lensPhotoKey, loadStoreLensPricesPg, type LensStorePriceLike } from "./pricing-overview";

/**
 * The editable 2026 lens price list as ONE payload: designs × materials base
 * matrix (one cell per finish, lib/lens-finish.ts) + photochromic + AR options
 * + the treatment matrix. It is what the storefront wizard reads through
 * `GET /store/lens-config/matrix` and what the point of sale reads through
 * `GET /admin/pos/lens-matrix` (same shape, so the panel adapts both with the
 * same `adaptLensMatrix`). Read-only: every total is recomputed server-side by
 * the quote (lib/lens-quote.ts).
 *
 * Reads via the shared Postgres connection (Knex) rather than the module
 * service, which keeps it independent of the lens-config module's ORM manager
 * lifecycle.
 *
 * `lens_base_price` also holds the lab's `cost_cents`, which is internal and
 * must NEVER leave through either route: base cells are rebuilt field by field
 * here (`publicBaseCell`), whatever columns the query returned. The same goes
 * for the photochromic and AR options' `cost_cents` (`publicOptionRow`).
 */

export interface LensMatrixBaseCell {
  design_code: string;
  material_code: string;
  /** Absent only on a database that has not run the finish migration (the row is the cell's only finish). */
  finish?: LensFinish;
  price_cents: number;
}

export type LensMatrixRow = Record<string, unknown>;

export interface LensMatrixPayload {
  designs: LensMatrixRow[];
  materials: LensMatrixRow[];
  base_prices: LensMatrixBaseCell[];
  photos: LensMatrixRow[];
  ars: LensMatrixRow[];
  treatment_prices: LensMatrixRow[];
}

const cents = (v: unknown): number => {
  const x = typeof v === "string" ? parseInt(v, 10) : Number(v);
  return Number.isFinite(x) ? Math.round(x) : 0;
};

/** The public face of a `lens_base_price` row: codes, finish and price. Never the cost. */
export function publicBaseCell(row: LensMatrixRow): LensMatrixBaseCell {
  const finish = parseLensFinish(row["finish"]);
  return {
    design_code: String(row["design_code"] ?? ""),
    material_code: String(row["material_code"] ?? ""),
    ...(finish ? { finish } : {}),
    price_cents: cents(row["price_cents"]),
  };
}

/**
 * A photochromic or AR option row without its lab cost (`cost_cents`,
 * UpgradeLensListOptionCost9): those tables are read whole, so the column has
 * to be dropped by name or it would leave on the public matrix. Pure.
 */
export function publicOptionRow(row: LensMatrixRow): LensMatrixRow {
  // Every lab-cost column, by name: the single one and the photochromics' per
  // category ones (UpgradeLensPhotoCostByCategory10). A new cost column must be added here.
  if (!Object.keys(row).some((k) => PRIVATE_COST_COLUMNS.has(k))) return row;
  const rest: LensMatrixRow = {};
  for (const [k, v] of Object.entries(row)) if (!PRIVATE_COST_COLUMNS.has(k)) rest[k] = v;
  return rest;
}

/** Lab-cost columns of the option tables: never on the public matrix. */
export const PRIVATE_COST_COLUMNS: ReadonlySet<string> = new Set(["cost_cents", "cost_sv_cents", "cost_bifocal_cents", "cost_prog_cents"]);

/** The master list, straight from the lens-config tables. */
export async function loadLensMatrix(pg: Knex): Promise<LensMatrixPayload> {
  // lens_treatment_price may not exist yet (before its migration); if the query
  // fails we answer [] so the storefront keeps its bundled fallback table.
  const treatmentPrices = pg("lens_treatment_price").whereNull("deleted_at").catch(() => [] as LensMatrixRow[]);

  const [designs, materials, baseRows, photos, ars, treatment_prices] = await Promise.all([
    pg("lens_design").whereNull("deleted_at").where({ is_active: true }).orderBy("sort", "asc"),
    pg("lens_material").whereNull("deleted_at").where({ is_active: true }).orderBy("sort", "asc"),
    pg("lens_base_price")
      .whereNull("deleted_at")
      .select("design_code", "material_code", "finish", "price_cents")
      // Before the finish migration the column is missing: same rows, no finish.
      .catch(() => pg("lens_base_price").whereNull("deleted_at").select("design_code", "material_code", "price_cents")),
    pg("lens_photo_option").whereNull("deleted_at").where({ is_active: true }).orderBy("sort", "asc"),
    pg("lens_ar_option").whereNull("deleted_at").where({ is_active: true }).orderBy("sort", "asc"),
    treatmentPrices,
  ]);

  return {
    designs: designs as LensMatrixRow[],
    materials: materials as LensMatrixRow[],
    base_prices: (baseRows as LensMatrixRow[]).map(publicBaseCell),
    photos: (photos as LensMatrixRow[]).map(publicOptionRow),
    ars: (ars as LensMatrixRow[]).map(publicOptionRow),
    treatment_prices: treatment_prices as LensMatrixRow[],
  };
}

const PHOTO_PRICE_COLUMNS: ReadonlyArray<[column: string, category: string]> = [
  ["price_sv_cents", "sv"],
  ["price_bifocal_cents", "bifocal"],
  ["price_prog_cents", "prog"],
];

/**
 * The same list with ONE store's variations applied, cell by cell, exactly as
 * the quote prices that store (`applyStoreLensBreakdown`): an exact override of
 * a base / photochromic / AR cell wins, otherwise the store's "% over the
 * master", otherwise the master. PURE.
 *
 * `treatment_prices` stay the master's: the quote keys a store's photochromic
 * variation by (photo_code, category), a dimension that matrix does not have,
 * so there is no honest per-cell answer for it here. The POS does not read it.
 */
export function applyStoreLensMatrix(matrix: LensMatrixPayload, storeRows: LensStorePriceLike[]): LensMatrixPayload {
  if (!storeRows?.length) return matrix;
  const categoryOf = new Map<string, string>();
  for (const d of matrix.designs) categoryOf.set(String(d["code"]), String(d["category"] ?? ""));

  const base_prices = matrix.base_prices.map((cell) => {
    const category = categoryOf.get(cell.design_code) ?? null;
    const finish = cell.finish ?? defaultLensFinish(category);
    const key = lensBaseKey(cell.design_code, cell.material_code, finish, category);
    return { ...cell, price_cents: applyStoreLensPrice(cell.price_cents, storeRows, { kind: "base", key }) };
  });

  const photos = matrix.photos.map((p) => {
    const out: LensMatrixRow = { ...p };
    for (const [column, category] of PHOTO_PRICE_COLUMNS) {
      // A category the list does not offer (null) stays unavailable: a store cannot price what the master has not.
      if (p[column] == null) continue;
      out[column] = applyStoreLensPrice(cents(p[column]), storeRows, { kind: "photo", key: lensPhotoKey(String(p["code"]), category) });
    }
    return out;
  });

  const ars = matrix.ars.map((a) => ({
    ...a,
    price_cents: applyStoreLensPrice(cents(a["price_cents"]), storeRows, { kind: "ar", key: lensArKey(String(a["code"])) }),
  }));

  return { ...matrix, base_prices, photos, ars };
}

/** The list a store sells from: master cells with that store's variations; the master itself without a store. */
export async function loadLensMatrixForStore(pg: Knex, establishmentId: string | null | undefined): Promise<LensMatrixPayload> {
  const [matrix, storeRows] = await Promise.all([loadLensMatrix(pg), loadStoreLensPricesPg(pg, establishmentId)]);
  return applyStoreLensMatrix(matrix, storeRows);
}

/**
 * Lens FINISH: a stock (finished, off-the-shelf) lens versus a surfaced /
 * digital one. The owner's lab prices the two differently for single vision
 * and bifocals, so `lens_base_price` holds one cell per (design, material,
 * finish). Progressives are always digital: they have a single, digital cell.
 *
 * Pure — no I/O. Shared by the quote (lib/lens-quote.ts), the POS line parser
 * (lib/pos.ts), the printed documents (lib/pos-documents.ts), the costing
 * lookup (lib/lens-cost.ts) and the pricing panel's keys (lib/pricing-overview.ts).
 */

export const LENS_FINISHES = ["stock", "digital"] as const;
export type LensFinish = (typeof LENS_FINISHES)[number];

/** Accepts only the two codes; anything else (including "") is null. */
export function parseLensFinish(value: unknown): LensFinish | null {
  return value === "stock" || value === "digital" ? value : null;
}

/** The finish a design is quoted with when the seller did not choose one. */
export function defaultLensFinish(category: string | null | undefined): LensFinish {
  return category === "prog" ? "digital" : "stock";
}

/**
 * A client asking "digital" for a progressive is fine (it is the design's only
 * cell); nothing else is coerced — asking "stock" for a progressive resolves to
 * "stock", finds no cell and ends as `finish_unavailable`, which is what the
 * seller should see rather than a silent switch to another price.
 */
export function resolveLensFinish(requested: LensFinish | null | undefined, category: string | null | undefined): LensFinish {
  return requested ?? defaultLensFinish(category);
}

/**
 * Does a `lens_base_price` row answer for this finish? A row read from a
 * database that has not run the finish migration carries no `finish` key at
 * all (undefined): it is the only cell of its (design, material) and answers
 * for any finish, exactly as it did before. Rows that carry the column match
 * exactly.
 */
export function cellMatchesFinish(row: { finish?: unknown }, finish: LensFinish): boolean {
  return row.finish === undefined || row.finish === finish;
}

/** The one cell of `rows` for a finish, or null. */
export function cellForFinish<T extends { finish?: unknown }>(rows: readonly T[], finish: LensFinish): T | null {
  return rows.find((r) => cellMatchesFinish(r, finish)) ?? null;
}

/** Thrown by the quote when the requested finish has no priced cell; the POS answers `finish_unavailable`. */
export class LensFinishError extends Error {
  readonly reason = "finish_unavailable" as const;
  constructor(public readonly design_code: string, public readonly material_code: string, public readonly finish: LensFinish) {
    super(`No ${finish} lens price for ${design_code}/${material_code}`);
  }
}

/**
 * The word appended to the lens name on receipts, the lab ticket and the sale
 * panel: the lab must know whether to pull a stock lens or surface one. Only
 * where the design admits both finishes — a progressive is digital by nature
 * and saying so would be noise.
 */
export function lensFinishLabel(finish: LensFinish): { es: string; en: string } {
  return finish === "digital" ? { es: "tallado digital", en: "digital surfaced" } : { es: "stock", en: "stock" };
}

/** `"Visión Sencilla (stock)"` / `"Single Vision (stock)"`; the label untouched for progressives. */
export function withFinishSuffix(
  label: { es: string; en: string } | null,
  finish: LensFinish | null | undefined,
  category: string | null | undefined
): { es: string; en: string } | null {
  if (!label || !finish || category === "prog") return label;
  const word = lensFinishLabel(finish);
  return { es: `${label.es} (${word.es})`, en: `${label.en} (${word.en})` };
}

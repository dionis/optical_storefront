/**
 * Retail pricing rules for frames and cases.
 *
 * The supplier (Capri Optics) is B2B and its wholesale prices are login-gated,
 * so they are NOT scraped — they come from the wholesale price sheets, captured
 * in src/data/wholesale-prices.json. This module turns a wholesale cost into the
 * selling price using the rules Daniel defined:
 *
 *   1. Round the wholesale cost UP to the next whole dollar.
 *   2. Frames:  rounded <= $4  -> x4
 *               rounded 5..15  -> x3
 *               rounded > $15   -> x2
 *   3. Cases:  x5   (on the rounded wholesale)
 *
 * Examples (verified against the sheet): wholesale 2.75 -> ceil 3 -> x4 = $12;
 * wholesale 0.69 case -> ceil 1 -> x5 = $5; wholesale 21 frame -> x2 = $42.
 */

export type PriceKind = "frame" | "case";

/** Selling price (whole dollars) from a wholesale cost, per the tiered rules. */
export function sellingPrice(wholesale: number, kind: PriceKind = "frame"): number {
  const up = Math.ceil(wholesale);
  if (kind === "case") return up * 5;
  if (up <= 4) return up * 4;
  if (up <= 15) return up * 3;
  return up * 2;
}

/** Normalize a model name / product title for matching ("GR 825" == "gr825"). */
export function normalizeModel(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

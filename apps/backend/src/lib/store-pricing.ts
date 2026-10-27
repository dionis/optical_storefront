/**
 * Prices per store: the pure rules. No container, no database — the module
 * (src/modules/store-pricing) stores the rules and the routes load them.
 *
 * Layers, from the bottom:
 *  1. Base: the variant's Medusa price (kept by price-sync) and the lens matrix.
 *  2. Global price (establishment_id null, mode "override"): the owner's own
 *     price for a product, imported from the Prices tab. It IS the base for the
 *     web and for every store.
 *  3. Store rules (owner or superadmin only, owner's decision):
 *     - general adjustment (scope "all"): a percentage applied to frame and
 *       lenses, or a fixed amount added ONCE per sale line;
 *     - exact price of a product in that store (scope "frame"/"case"): the
 *       final price of that component, never adjusted. A fixed amount then
 *       goes on the lenses instead, if there are any.
 *
 * Rules are immutable rows: changing one closes the current row (valid_to) and
 * creates another, so the history and scheduled changes come from one model.
 * Amounts are dollars; everything is rounded to cents and never below zero.
 */

export const RULE_SCOPES = ["all", "frame", "case"] as const;
export type RuleScope = (typeof RULE_SCOPES)[number];
export const RULE_MODES = ["percent", "delta", "override", "min"] as const;
export type RuleMode = (typeof RULE_MODES)[number];

/** A general adjustment can never take a price below this fraction of itself. */
export const MIN_PERCENT = -90;
export const MAX_PERCENT = 500;

export interface PriceRuleLike {
  establishment_id: string | null;
  scope: string;
  target: string | null;
  mode: string;
  value: number;
  valid_from: string | Date;
  valid_to: string | Date | null;
}

const toMs = (v: string | Date) => (v instanceof Date ? v.getTime() : new Date(v).getTime());
const cents = (v: number) => Math.max(0, Math.round(v * 100) / 100);

export function isActiveAt(rule: PriceRuleLike, now: Date): boolean {
  const t = now.getTime();
  return toMs(rule.valid_from) <= t && (rule.valid_to == null || toMs(rule.valid_to) > t);
}

/** The latest active rule matching, or null. */
function pick(rules: PriceRuleLike[], now: Date, match: (r: PriceRuleLike) => boolean): PriceRuleLike | null {
  let best: PriceRuleLike | null = null;
  for (const r of rules) {
    if (!match(r) || !isActiveAt(r, now)) continue;
    if (!best || toMs(r.valid_from) >= toMs(best.valid_from)) best = r;
  }
  return best;
}

/** Base price of a product after the owner's global price, if any. */
export function globalPrice(
  rules: PriceRuleLike[],
  scope: "frame" | "case",
  target: string,
  base: number,
  now = new Date()
): number {
  const r = pick(rules, now, (x) => x.establishment_id == null && x.scope === scope && x.target === target && x.mode === "override");
  return cents(r ? Number(r.value) : base);
}

/**
 * The owner's open global prices by product id — what price-sync must keep
 * instead of the wholesale-derived price. Latest active rule wins.
 */
export function globalPriceOverrides(rules: PriceRuleLike[], now = new Date()): Map<string, number> {
  const out = new Map<string, { at: number; value: number }>();
  for (const r of rules) {
    if (r.establishment_id != null || r.mode !== "override" || !r.target || !isActiveAt(r, now)) continue;
    if (r.scope !== "frame" && r.scope !== "case") continue;
    const at = toMs(r.valid_from);
    const prev = out.get(r.target);
    if (!prev || at >= prev.at) out.set(r.target, { at, value: cents(Number(r.value)) });
  }
  return new Map([...out].map(([k, v]) => [k, v.value]));
}

export interface StoreLineInput {
  establishmentId: string;
  scope: "frame" | "case";
  /** Medusa product id of the frame (or case): prices are per model, not per colour. */
  target: string;
  /** Medusa price of the frame, before any rule. */
  base: number;
  /** Lens add-on from the matrix, before store rules; 0 for frame-only. */
  lenses: number;
}

export interface StoreLinePrice {
  frame: number;
  lenses: number;
  total: number;
  /** What produced the frame part: the store's exact price, or base + adjustment. */
  frame_source: "store_exact" | "adjusted";
  adjustment: { mode: "percent" | "delta"; value: number } | null;
}

export function storeLinePrice(rules: PriceRuleLike[], input: StoreLineInput, now = new Date()): StoreLinePrice {
  const est = input.establishmentId;
  const base = globalPrice(rules, input.scope, input.target, input.base, now);
  const exact = pick(rules, now, (r) => r.establishment_id === est && r.scope === input.scope && r.target === input.target && r.mode === "override");
  const general = pick(rules, now, (r) => r.establishment_id === est && r.scope === "all" && (r.mode === "percent" || r.mode === "delta"));
  const adjustment = general ? { mode: general.mode as "percent" | "delta", value: Number(general.value) } : null;

  const pct = adjustment?.mode === "percent" ? 1 + adjustment.value / 100 : 1;
  let frame = exact ? Number(exact.value) : base * pct;
  let lenses = input.lenses * pct;
  if (adjustment?.mode === "delta") {
    // Once per line, on the first component that is not an exact price.
    if (!exact) frame += adjustment.value;
    else if (input.lenses > 0) lenses += adjustment.value;
  }
  frame = cents(frame);
  lenses = cents(lenses);
  return {
    frame,
    lenses,
    total: cents(frame + lenses),
    frame_source: exact ? "store_exact" : "adjusted",
    adjustment,
  };
}

export interface LineMinimum {
  /** Lowest price of the frame component, in dollars; null = none. */
  frame_min: number | null;
  /** Lowest price of the whole line as a % of its list price; null = none. */
  floor_pct: number | null;
}

/**
 * Minimum price of a sale line (HU-16). The store's own rule wins over the
 * owner's global one. A discount that takes the line below either needs the
 * approval of the owner or a superadmin.
 */
export function lineMinimum(
  rules: PriceRuleLike[],
  input: { establishmentId: string; scope: "frame" | "case"; target: string },
  now = new Date()
): LineMinimum {
  const of = (est: string | null, scope: string, target: string | null) =>
    pick(rules, now, (r) => r.mode === "min" && r.establishment_id === est && r.scope === scope && r.target === target);
  const frame = input.target
    ? of(input.establishmentId, input.scope, input.target) ?? of(null, input.scope, input.target)
    : null;
  const floor = of(input.establishmentId, "all", null) ?? of(null, "all", null);
  return {
    frame_min: frame ? cents(Number(frame.value)) : null,
    floor_pct: floor ? Number(floor.value) : null,
  };
}

/** True when a discounted line goes under its minimum. */
export function belowMinimum(min: LineMinimum, line: { list: number; frame: number; total: number }): boolean {
  if (min.frame_min !== null && line.frame < min.frame_min) return true;
  if (min.floor_pct !== null && line.total < cents((line.list * min.floor_pct) / 100)) return true;
  return false;
}

/** Validation for a minimum price; null value means "remove". */
export function minimumDenied(scope: string, target: unknown, value: unknown): string | null {
  if (scope !== "all" && scope !== "frame" && scope !== "case") return "bad_scope";
  if (scope !== "all" && (typeof target !== "string" || !target.trim() || target.length > 120)) return "bad_target";
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "bad_value";
  if (scope === "all" ? n > 100 : n > 100000) return "bad_value";
  return null;
}

/** Validation for a general adjustment; returns a reason code or null. */
export function adjustmentDenied(mode: string, value: unknown): string | null {
  if (mode === "none") return null;
  if (mode !== "percent" && mode !== "delta") return "bad_mode";
  const n = Number(value);
  if (!Number.isFinite(n)) return "bad_value";
  if (mode === "percent" && (n < MIN_PERCENT || n > MAX_PERCENT)) return "bad_value";
  if (mode === "delta" && Math.abs(n) > 100000) return "bad_value";
  return null;
}

/** Validation for an exact price; null price means "remove". */
export function exactPriceDenied(scope: string, target: unknown, price: unknown): string | null {
  if (scope !== "frame" && scope !== "case") return "bad_scope";
  if (typeof target !== "string" || !target.trim() || target.length > 120) return "bad_target";
  if (price === null) return null;
  const n = Number(price);
  if (!Number.isFinite(n) || n < 0 || n > 100000) return "bad_value";
  return null;
}

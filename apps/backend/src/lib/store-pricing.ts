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
export const RULE_MODES = ["percent", "delta", "override"] as const;
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

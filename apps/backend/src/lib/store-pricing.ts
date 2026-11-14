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
 *     - BRAND price in that store (v2, 7-nov-2026; scope "frame"/"case",
 *       target `brand:<slug>`, mode "override"): every model of that brand at
 *       that price in that store, unless the model has its own exact price.
 *       Same treatment as an exact price (no adjustment, no band).
 *
 *   Precedence of the frame part: model's exact price > brand price > store
 *   adjustment > band > master (docs/PRICE-MATRIX.md, v2).
 *     A general adjustment with NO store (establishment_id null) is the
 *     CHAIN's rule: every store without one of its own applies it, and so
 *     does the master price itself (`masterLinePrice`) — the master is what
 *     a store that inherits charges, not the bare Medusa base.
 *
 * Rules are immutable rows: changing one closes the current row (valid_to) and
 * creates another, so the history and scheduled changes come from one model.
 * Amounts are dollars; everything is rounded to cents and never below zero.
 *
 * On top of all of it sits the PRICE BAND (lib/pricing.ts): the floor and the
 * ceiling the owner holds a computed price between, chain-wide and bendable
 * store by store. It is the LAST thing applied to the frame component and it
 * never touches a price he typed for a model.
 */
import { applyPriceBandUsd, priceBandFor, type PriceBand } from "./pricing";

export const RULE_SCOPES = ["all", "frame", "case"] as const;
export type RuleScope = (typeof RULE_SCOPES)[number];
export const RULE_MODES = ["percent", "delta", "override", "min", "cost_multiple"] as const;
export type RuleMode = (typeof RULE_MODES)[number];

/** A general adjustment can never take a price below this fraction of itself. */
export const MIN_PERCENT = -90;
export const MAX_PERCENT = 500;

export interface PriceRuleLike {
  /** Who wrote it ("pricing-panel", "cost_multiple" = derived from the store's «N × costo» rule…). Optional. */
  source?: string | null;
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
 * True when the owner typed his own price for this model. `globalPrice` returns
 * a number either way, so this is the only way to tell "the base is $60 because
 * he said so" from "the base is $60 because a rule got there" — and the floor
 * and the ceiling must leave the first one exactly where he put it.
 */
export function hasGlobalPrice(
  rules: PriceRuleLike[],
  scope: "frame" | "case",
  target: string,
  now = new Date()
): boolean {
  if (!target) return false;
  return (
    pick(
      rules,
      now,
      (x) => x.establishment_id == null && x.scope === scope && x.target === target && x.mode === "override"
    ) !== null
  );
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

/** `target` of a brand price rule: `brand:<slug>`. */
export const BRAND_TARGET_PREFIX = "brand:";
export const brandTarget = (slug: string): string => `${BRAND_TARGET_PREFIX}${slug}`;
/** The brand slug of a `brand:<slug>` target; null for a product target. */
export const brandOfTarget = (target: string | null | undefined): string | null =>
  typeof target === "string" && target.startsWith(BRAND_TARGET_PREFIX) && target.length > BRAND_TARGET_PREFIX.length ? target.slice(BRAND_TARGET_PREFIX.length) : null;

/**
 * The open brand price of a store for a scope, or null. The latest active
 * `override` rule on `brand:<slug>` of THAT store (a brand price is always a
 * store's: there is no chain-wide one). Pure.
 */
export function brandPriceRule(
  rules: PriceRuleLike[],
  establishmentId: string,
  scope: "frame" | "case",
  brandSlug: string | null | undefined,
  now = new Date()
): PriceRuleLike | null {
  if (!brandSlug) return null;
  const target = brandTarget(brandSlug);
  return pick(rules, now, (r) => r.establishment_id === establishmentId && r.scope === scope && r.target === target && r.mode === "override");
}

export interface StoreLineInput {
  establishmentId: string;
  scope: "frame" | "case";
  /** Medusa product id of the frame (or case): prices are per model, not per colour. */
  target: string;
  /**
   * The model's brand slug (`metadata.brand_slug`), v2: a store's BRAND price
   * applies when the model has no exact price of its own. Absent = no brand
   * price is looked at (what every caller did before).
   */
  brand?: string | null;
  /** Medusa price of the frame, before any rule. */
  base: number;
  /** Lens add-on from the matrix, before store rules; 0 for frame-only. */
  lenses: number;
}

export interface StoreLinePrice {
  frame: number;
  lenses: number;
  total: number;
  /** What produced the frame part: the store's exact price, the store's brand price, or base + adjustment. */
  frame_source: "store_exact" | "brand" | "adjusted";
  adjustment: { mode: "percent" | "delta"; value: number } | null;
  /**
   * The floor or the ceiling that moved the frame, in dollars; null when the
   * band changed nothing (or was not applied — see `storeLinePrice`).
   */
  band: { from: number; to: number } | null;
}

/**
 * The adjustment that covers a whole component, most specific first. The
 * pricing panel writes "a rule for ALL frames" (scope "frame", no target) and
 * "a rule for ALL cases" (scope "case"); the older general adjustment (scope
 * "all") still covers both, and the owner's own rule (establishment_id null) is
 * the master every store falls back to.
 *
 *   store, scope  >  store, "all"  >  master, scope  >  master, "all"
 */
function generalAdjustment(
  rules: PriceRuleLike[],
  est: string | null,
  scope: "frame" | "case",
  now: Date
): PriceRuleLike | null {
  const of = (establishment: string | null, which: string) =>
    pick(rules, now, (r) =>
      r.establishment_id === establishment && r.scope === which && r.target == null && (r.mode === "percent" || r.mode === "delta")
    );
  // `est` null = the master itself: only the chain's rules.
  return (est ? of(est, scope) ?? of(est, "all") : null) ?? of(null, scope) ?? of(null, "all");
}

export interface MasterLinePrice {
  /** The chain's price of the frame (or case) component, in dollars. */
  frame: number;
  /**
   * What produced it: the owner's own price for the model (`owner`), the band
   * moving a computed price (`band`), the chain's general rule (`rule`), or
   * the bare base (`base`). Same precedence as a store cell's source.
   */
  frame_source: "owner" | "band" | "rule" | "base";
  adjustment: { mode: "percent" | "delta"; value: number } | null;
  band: { from: number; to: number } | null;
}

/**
 * THE MASTER price of a frame or case: what every store starts from before
 * its own rules, and what "Todas las tiendas" shows in Precios → Monturas.
 *
 *   owner's global price for the model      (his decision; no rule, no band)
 *   → Medusa base × the CHAIN's general rule (POST /pricing/frames/rule with
 *     no store: scope "frame"/"case", else the older "all")
 *   → the chain's floor and ceiling.
 *
 * It is `storeLinePrice` with no store: the same `generalAdjustment` a store
 * falls back to when it has no rule of its own, so a store that inherits and
 * the master column always show the same figure. Until 5-nov-2026 the master
 * was the bare base (+ band) while every store applied the chain rule, so the
 * master column disagreed with every store that simply inherited (QA note).
 * Pure.
 */
export function masterLinePrice(
  rules: PriceRuleLike[],
  input: { scope: "frame" | "case"; target: string; base: number },
  now = new Date(),
  band: PriceBand | null = priceBandFor(null)
): MasterLinePrice {
  if (hasGlobalPrice(rules, input.scope, input.target, now)) {
    return { frame: globalPrice(rules, input.scope, input.target, input.base, now), frame_source: "owner", adjustment: null, band: null };
  }
  const general = generalAdjustment(rules, null, input.scope, now);
  const adjustment = general ? { mode: general.mode as "percent" | "delta", value: Number(general.value) } : null;
  let frame = input.base;
  if (adjustment?.mode === "percent") frame = frame * (1 + adjustment.value / 100);
  if (adjustment?.mode === "delta") frame += adjustment.value;
  frame = cents(frame);
  const before = frame;
  frame = cents(applyPriceBandUsd(frame, band, input.scope));
  const moved = frame !== before;
  return {
    frame,
    frame_source: moved ? "band" : adjustment ? "rule" : "base",
    adjustment,
    band: moved ? { from: before, to: frame } : null,
  };
}

export function storeLinePrice(
  rules: PriceRuleLike[],
  input: StoreLineInput,
  now = new Date(),
  band: PriceBand | null = priceBandFor(input.establishmentId)
): StoreLinePrice {
  const est = input.establishmentId;
  const base = globalPrice(rules, input.scope, input.target, input.base, now);
  const own = input.target
    ? pick(rules, now, (r) => r.establishment_id === est && r.scope === input.scope && r.target === input.target && r.mode === "override")
    : null;
  // The model's own price beats the brand's; the brand's beats every rule below.
  const brandRule = own ? null : brandPriceRule(rules, est, input.scope, input.target ? input.brand : null, now);
  const exact = own ?? brandRule;
  const general = generalAdjustment(rules, est, input.scope, now);
  const adjustment = general ? { mode: general.mode as "percent" | "delta", value: Number(general.value) } : null;

  // A rule written for ALL FRAMES (or all cases) is about that component only:
  // the lens add-on has its own per-store percentage (the lens matrix' "% sobre
  // el maestro", lib/pricing-overview.ts). The legacy general adjustment
  // (scope "all") keeps covering frame AND lenses, as it always did.
  const coversLenses = general?.scope === "all";
  const pct = adjustment?.mode === "percent" ? 1 + adjustment.value / 100 : 1;
  let frame = exact ? Number(exact.value) : base * pct;
  let lenses = input.lenses * (coversLenses ? pct : 1);
  if (adjustment?.mode === "delta") {
    // Once per line, on the first component that is not an exact price.
    if (!exact) frame += adjustment.value;
    else if (coversLenses && input.lenses > 0) lenses += adjustment.value;
  }
  frame = cents(frame);
  lenses = cents(lenses);

  // ── The floor and the ceiling, last ──
  //
  // The band is the owner's answer to "what is the cheapest and the dearest
  // thing we are willing to put on the shelf", so it goes AFTER everything
  // that computes the frame's price and BEFORE the line is quoted or stored.
  //
  // Two things it must never touch, in the owner's own order of priority:
  //
  //  · A PRICE HE TYPED FOR A MODEL. That is his decision, and his decision
  //    beats the floor and the ceiling — both the store's exact price
  //    (`store_exact`) and his own global price for the model, which arrives
  //    here as the base. Hence `hasGlobalPrice`: the base being 60 because he
  //    said 60 is not the same thing as the base being 60 because of a rule.
  //  · THE LENS ADD-ON. The band is about frames and cases; the lens matrix
  //    has its own per-store prices and its own "% sobre el maestro" (see
  //    lib/pricing-overview.ts), and a $30 floor applied to a $12 lens add-on
  //    would quietly rewrite that whole table.
  const banded = !exact && !hasGlobalPrice(rules, input.scope, input.target, now);
  const frameBefore = frame;
  if (banded) frame = cents(applyPriceBandUsd(frame, band, input.scope));
  return {
    frame,
    lenses,
    total: cents(frame + lenses),
    frame_source: own ? "store_exact" : brandRule ? "brand" : "adjusted",
    adjustment,
    /** What the band did to the frame, so a quote can explain the figure. */
    band: banded && frame !== frameBefore ? { from: frameBefore, to: frame } : null,
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

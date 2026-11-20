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
 *
 * AFTER that conversion comes the PRICE BAND — the floor and the ceiling the
 * owner holds the result between (see `applyPriceBand` below). The conversion
 * answers "what is this worth as a multiple of its cost"; the band answers
 * "what is the cheapest and the dearest thing we are willing to put on the
 * shelf", which is a different question and the reason it is a separate layer.
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

// ── The price band: a floor and a ceiling over the converted price ──────────

/**
 * The owner's own words: «si el precio después de conversión es menor que 30,
 * podemos definir que se lleva hasta por ejemplo 60, un número fijo. Si el
 * precio después de conversión es muy alto, también poder reducirlo hasta un
 * monto que no sobrepase un umbral de, no sé, 100 dólares».
 *
 * Hence TWO numbers per side, not one:
 *
 *   floor   price <  `floor_below_cents`  ->  `floor_to_cents`
 *   ceiling price >  `cap_above_cents`    ->  `cap_to_cents`
 *
 * A floor of 30→60 is not "nothing under $30": a frame the conversion prices at
 * $8 is worth $60 on the shelf, and one number could never have said that.
 *
 * Each side is active only when BOTH of its numbers are set, so the owner can
 * define only the floor, only the ceiling, or both; `enabled` false keeps the
 * numbers and stops applying them (turning it off must not make him retype it).
 *
 * Cents, integers — the unit the panel already speaks for every cost.
 */
export interface PriceBand {
  floor_below_cents: number | null;
  floor_to_cents: number | null;
  cap_above_cents: number | null;
  cap_to_cents: number | null;
  /** Whether cases (estuches) are banded too. Default — and advice — is NO. */
  apply_to_cases: boolean;
  enabled: boolean;
}

/** A band with nothing set: what "no adjustment" is, and the shape of an empty form. */
export const EMPTY_PRICE_BAND: PriceBand = {
  floor_below_cents: null,
  floor_to_cents: null,
  cap_above_cents: null,
  cap_to_cents: null,
  apply_to_cases: false,
  enabled: true,
};

/** Where an effective band came from, in precedence order. */
export const PRICE_BAND_ORIGINS = ["store_variation", "chain_master", "none"] as const;
export type PriceBandOrigin = (typeof PRICE_BAND_ORIGINS)[number];

const intCents = (v: number | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

/** Normalise anything row-shaped into a `PriceBand`. Pure. */
export function toPriceBand(row: Partial<PriceBand> | null | undefined): PriceBand | null {
  if (!row) return null;
  return {
    floor_below_cents: intCents(row.floor_below_cents),
    floor_to_cents: intCents(row.floor_to_cents),
    cap_above_cents: intCents(row.cap_above_cents),
    cap_to_cents: intCents(row.cap_to_cents),
    apply_to_cases: row.apply_to_cases === true,
    enabled: row.enabled !== false,
  };
}

/** True when the band's floor would ever fire. */
export const hasFloor = (b: PriceBand | null): boolean =>
  Boolean(b && b.enabled && b.floor_below_cents !== null && b.floor_to_cents !== null);

/** True when the band's ceiling would ever fire. */
export const hasCap = (b: PriceBand | null): boolean =>
  Boolean(b && b.enabled && b.cap_above_cents !== null && b.cap_to_cents !== null);

/** True when the band does nothing at all (off, or both sides empty). */
export const bandIsNoop = (b: PriceBand | null): boolean => !hasFloor(b) && !hasCap(b);

/**
 * THE adjustment, in one pure function: the converted price, held between the
 * floor and the ceiling. Cents in, cents out.
 *
 * Three decisions are deliberate and the owner must not be surprised by any of
 * them:
 *
 *  1. CASES ARE OUT by default (`apply_to_cases` false). Today's conversion
 *     sells a $0.98 case at $5, and a 30→60 floor would put a plastic case on
 *     the shelf at $60 — 29 of the 30 cases in the supplier's list, all at
 *     once. The floor says "no FRAME leaves here for less than X"; a case is
 *     an accessory that goes with the frame, not a frame. It is a switch and
 *     not a hard exclusion because it is the owner's shop, but it is off until
 *     he turns it on and the panel spells out what turning it on would do.
 *
 *  2. A PRICE OF ZERO (or less) IS LEFT ALONE. Zero here means "this model has
 *     no price yet", and a floor would turn that hole into a $60 price tag.
 *
 *  3. FLOOR FIRST, THEN CEILING — both in the same pass, not one or the other.
 *     That is what makes the function IDEMPOTENT, which matters because
 *     price-sync re-applies it over the same catalogue every 4 hours: a floor
 *     to $60 under a ceiling at $50 settles on $50 in ONE pass and stays
 *     there, instead of ping-ponging between runs. `priceBandDenied` keeps the
 *     four numbers coherent (target above its floor threshold, ceiling target
 *     at or under its own threshold, floor target at or under the ceiling's),
 *     which is what guarantees the second pass changes nothing.
 */
export function applyPriceBand(
  priceCents: number,
  band: PriceBand | null | undefined,
  kind: PriceKind = "frame"
): number {
  const price = Number(priceCents);
  if (!Number.isFinite(price) || price <= 0) return priceCents;
  if (!band || !band.enabled) return price;
  if (kind === "case" && !band.apply_to_cases) return price;
  let out = price;
  if (band.floor_below_cents !== null && band.floor_to_cents !== null && out < band.floor_below_cents) {
    out = band.floor_to_cents;
  }
  if (band.cap_above_cents !== null && band.cap_to_cents !== null && out > band.cap_above_cents) {
    out = band.cap_to_cents;
  }
  return Math.round(out);
}

/** The same adjustment on a price in DOLLARS (what the price rules speak). */
export function applyPriceBandUsd(
  priceUsd: number,
  band: PriceBand | null | undefined,
  kind: PriceKind = "frame"
): number {
  const usd = Number(priceUsd);
  if (!Number.isFinite(usd)) return priceUsd;
  return applyPriceBand(Math.round(usd * 100), band, kind) / 100;
}

/**
 * The band that applies to a scope: the store's own, then the chain's, then
 * none. A variation REPLACES the master whole — it is never merged column by
 * column, because "its floor with the chain's ceiling" is not a rule anyone can
 * hold in their head when a price looks wrong at the counter.
 */
export function resolvePriceBand(
  master: PriceBand | null,
  variations: ReadonlyMap<string, PriceBand>,
  storeId: string | null | undefined
): { band: PriceBand | null; origin: PriceBandOrigin; inherited: boolean } {
  const own = storeId ? variations.get(storeId) ?? null : null;
  if (own) return { band: own, origin: "store_variation", inherited: false };
  if (master) return { band: master, origin: "chain_master", inherited: Boolean(storeId) };
  return { band: null, origin: "none", inherited: Boolean(storeId) };
}

/**
 * Validation of a band as the panel sends it (cents). Returns a `reason` code
 * or null. Beyond the obvious bounds it enforces the three inequalities that
 * make `applyPriceBand` idempotent and the rule readable:
 *
 *   floor_to   >= floor_below   (a "floor" that lowers the price is not a floor)
 *   cap_to     <= cap_above     (a "ceiling" that raises it is not a ceiling)
 *   floor_to   <= cap_to        (the two sides must not fight each other)
 *
 * Without the third one a 30→60 floor under a 50→50 ceiling would push a model
 * up to $60 on one run and down to $50 on the next, for ever.
 */
export function priceBandDenied(band: Partial<PriceBand> | null | undefined): string | null {
  if (!band) return "bad_band";
  const nums: Array<[keyof PriceBand, unknown]> = [
    ["floor_below_cents", band.floor_below_cents],
    ["floor_to_cents", band.floor_to_cents],
    ["cap_above_cents", band.cap_above_cents],
    ["cap_to_cents", band.cap_to_cents],
  ];
  for (const [, raw] of nums) {
    if (raw === null || raw === undefined) continue;
    const n = Number(raw);
    // Cents, integer, and bounded: a frame priced over $100,000 is a typo.
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 10_000_000) return "bad_band";
  }
  const b = toPriceBand(band) as PriceBand;
  // Each side needs BOTH numbers or NEITHER: a threshold with no target does
  // not say what to do, and a target with no threshold does not say when.
  if ((b.floor_below_cents === null) !== (b.floor_to_cents === null)) return "band_incomplete";
  if ((b.cap_above_cents === null) !== (b.cap_to_cents === null)) return "band_incomplete";
  if (b.floor_to_cents !== null && b.floor_below_cents !== null && b.floor_to_cents < b.floor_below_cents) {
    return "floor_below_threshold";
  }
  if (b.cap_to_cents !== null && b.cap_above_cents !== null && b.cap_to_cents > b.cap_above_cents) {
    return "cap_above_threshold";
  }
  if (b.floor_to_cents !== null && b.cap_to_cents !== null && b.floor_to_cents > b.cap_to_cents) {
    return "band_crossed";
  }
  return null;
}

// ── What a band would do to today's prices (the panel's impact preview) ─────

/** One model as the preview sees it: its converted price, before any band. */
export interface BandImpactItem {
  /** Normalised price-book key ("read2"), so a caller can exclude models by key. */
  key: string;
  /** Model as the supplier prints it ("READ 2") — what the example reads like. */
  model: string;
  kind: PriceKind;
  /** The price the conversion gives, in DOLLARS (the unit the catalogue holds). */
  price: number;
}

/** One concrete "READ 2: $8 → $60" the panel shows under the counts. */
export interface BandImpactExample {
  model: string;
  kind: PriceKind;
  from: number;
  to: number;
}

export interface BandImpact {
  /** Models considered (hand-priced ones are excluded and counted apart). */
  total: number;
  raised: number;
  lowered: number;
  unchanged: number;
  /** Models whose price the owner set by hand: the band never touches them. */
  owner_priced: number;
  /** Cases the band is NOT applied to because `apply_to_cases` is off. */
  cases_skipped: number;
  /** Cases the floor WOULD raise if `apply_to_cases` were turned on. */
  cases_would_raise: number;
  examples: { raised: BandImpactExample[]; lowered: BandImpactExample[] };
}

/** How many examples of each kind travel to the panel. */
export const BAND_EXAMPLES = 5;

/**
 * What a band would do to the catalogue, model by model. PURE — the route
 * feeds it the converted price book (src/lib/price-sync.ts) and the set of
 * models the owner priced by hand, and the panel shows the answer BEFORE the
 * owner saves. He has just lived through a rule change that moved 147 prices
 * at once; this is so that never happens blind again.
 *
 * `ownerPricedKeys` are normalised price-book keys (`normalizeModel`): those
 * models keep the price he typed, so they are counted and skipped.
 */
export function priceBandImpact(
  items: readonly BandImpactItem[],
  band: PriceBand | null,
  ownerPricedKeys: ReadonlySet<string> = new Set()
): BandImpact {
  const out: BandImpact = {
    total: 0,
    raised: 0,
    lowered: 0,
    unchanged: 0,
    owner_priced: 0,
    cases_skipped: 0,
    cases_would_raise: 0,
    examples: { raised: [], lowered: [] },
  };
  const casesOn = Boolean(band?.apply_to_cases);
  for (const item of items) {
    if (ownerPricedKeys.has(item.key)) {
      out.owner_priced++;
      continue;
    }
    out.total++;
    if (item.kind === "case" && !casesOn) {
      out.cases_skipped++;
      // What turning the switch on would cost him, so the warning carries a
      // number instead of an adjective.
      const asFrame = applyPriceBandUsd(item.price, band ? { ...band, apply_to_cases: true } : null, "case");
      if (asFrame > item.price) out.cases_would_raise++;
      out.unchanged++;
      continue;
    }
    const after = applyPriceBandUsd(item.price, band, item.kind);
    if (after > item.price) {
      out.raised++;
      if (out.examples.raised.length < BAND_EXAMPLES) {
        out.examples.raised.push({ model: item.model, kind: item.kind, from: item.price, to: after });
      }
    } else if (after < item.price) {
      out.lowered++;
      if (out.examples.lowered.length < BAND_EXAMPLES) {
        out.examples.lowered.push({ model: item.model, kind: item.kind, from: item.price, to: after });
      }
    } else {
      out.unchanged++;
    }
  }
  return out;
}

// ── Process cache, so the price math can stay synchronous ───────────────────

/**
 * `storeLinePrice` (src/lib/store-pricing.ts) is PURE and synchronous: it is
 * called per sale line, by the point of sale, the store catalogue and the
 * panel's preview alike. The band it has to apply lives in two tables, so —
 * exactly as `frameCostCents` does for what a model costs — the tables are
 * held in a short-lived process cache, refreshed by `ensurePriceBandCache`
 * (src/lib/store-pricing-data.ts) which `openRules` calls. Every path that
 * computes a price already loads the rules, so the cache is always warm by the
 * time the math runs.
 *
 * With an empty or stale cache the answer is NO BAND — the price the shop sold
 * at before this layer existed — never another store's band and never half of
 * one.
 */
const BAND_TTL_MS = 60_000;
const NO_VARIATIONS: ReadonlyMap<string, PriceBand> = new Map();
let bandCache: {
  at: number;
  master: PriceBand | null;
  variations: Map<string, PriceBand>;
  loaded: boolean;
} | null = null;

/** Replace the cache with this band (the loader, and the tests). */
export function setPriceBandCache(
  master: PriceBand | null,
  variations: ReadonlyMap<string, PriceBand> = NO_VARIATIONS
): void {
  bandCache = { at: Date.now(), master, variations: new Map(variations), loaded: true };
}

/** Drop the cache: after an edit, and between tests. */
export function clearPriceBandCache(): void {
  bandCache = null;
}

/** True once the tables have been read successfully at least once. */
export function priceBandsLoaded(): boolean {
  return bandCache?.loaded === true;
}

/** Milliseconds since the cache was filled, or null when it never was. */
export function priceBandCacheAge(): number | null {
  return bandCache ? Date.now() - bandCache.at : null;
}

/** True when the cache is older than its TTL (or was never filled). */
export function priceBandCacheStale(): boolean {
  const age = priceBandCacheAge();
  return age === null || age >= BAND_TTL_MS;
}

/**
 * The band that applies in a store (or chain-wide with no store), from the
 * cache. Synchronous, never throws, and null when nothing is loaded.
 */
export function priceBandFor(storeId?: string | null): PriceBand | null {
  if (!bandCache?.loaded) return null;
  return resolvePriceBand(bandCache.master, bandCache.variations, storeId).band;
}

import {
  applyStoreLensBreakdown,
  applyStoreLensPrice,
  costGroupOf,
  frameRuleOf,
  lensArKey,
  lensBaseKey,
  lensPhotoKey,
  lensPriceDenied,
  storeLensAdjustPct,
  type LensStorePriceLike,
} from "../src/lib/pricing-overview";
import { storeLinePrice, type PriceRuleLike } from "../src/lib/store-pricing";
import { isEnabled, disabledIds, toggleDenied, type CostToggleLike } from "../src/lib/store-cost-toggle";
import { AR_OPTIONS, DESIGNS, MATERIAL_CODES, PHOTO_OPTIONS, cents } from "../src/modules/lens-config/price-list-2026";

/**
 * The pricing panel's rules. The money a store charges at the counter comes out
 * of these functions, so every precedence decision the owner made is pinned
 * here: an exact price beats a rule, a rule beats the base, and a store's
 * variation beats the master only where the store actually set one.
 */

const NOW = new Date("2026-11-01T12:00:00Z");
const row = (over: Partial<LensStorePriceLike>): LensStorePriceLike => ({
  establishment_id: "est_2",
  item_kind: "base",
  item_key: "sv:cr39",
  value: 7000,
  ...over,
});

describe("applyStoreLensPrice (a store's own lens price)", () => {
  it("is the master when the store has no variation", () => {
    expect(applyStoreLensPrice(6000, [], { kind: "base", key: "sv:cr39" })).toBe(6000);
  });

  it("applies the store's percentage over the master", () => {
    const rows = [row({ item_kind: "adjust", item_key: "all", value: 10 })];
    expect(applyStoreLensPrice(6000, rows, { kind: "base", key: "sv:cr39" })).toBe(6600);
  });

  it("accepts a negative percentage and never goes below zero", () => {
    const rows = [row({ item_kind: "adjust", item_key: "all", value: -90 })];
    expect(applyStoreLensPrice(6000, rows, { kind: "base", key: "sv:cr39" })).toBe(600);
  });

  it("lets an exact cell override beat the percentage", () => {
    const rows = [
      row({ item_kind: "adjust", item_key: "all", value: 50 }),
      row({ item_kind: "base", item_key: "sv:cr39", value: 5500 }),
    ];
    expect(applyStoreLensPrice(6000, rows, { kind: "base", key: "sv:cr39" })).toBe(5500);
    // …and only for THAT cell: the rest still follows the percentage.
    expect(applyStoreLensPrice(9000, rows, { kind: "base", key: "sv:poly" })).toBe(13500);
  });

  it("keys photochromics by option and design category, and AR by code", () => {
    const rows = [row({ item_kind: "photo", item_key: lensPhotoKey("photo-grey", "prog"), value: 9500 })];
    expect(applyStoreLensPrice(9000, rows, { kind: "photo", key: lensPhotoKey("photo-grey", "prog") })).toBe(9500);
    expect(applyStoreLensPrice(8500, rows, { kind: "photo", key: lensPhotoKey("photo-grey", "sv") })).toBe(8500);
    expect(applyStoreLensPrice(6000, rows, { kind: "ar", key: lensArKey("ar-green-basic") })).toBe(6000);
  });

  it("rounds to whole cents", () => {
    const rows = [row({ item_kind: "adjust", item_key: "all", value: 7.5 })];
    expect(applyStoreLensPrice(6033, rows, { kind: "base", key: "x:y" })).toBe(6485);
  });

  it("reads the store's percentage back for the panel", () => {
    expect(storeLensAdjustPct([])).toBeNull();
    expect(storeLensAdjustPct([row({ item_kind: "adjust", item_key: "all", value: 12.345 })])).toBe(12.35);
  });
});

describe("applyStoreLensBreakdown (what the point of sale quotes)", () => {
  const breakdown = { lens_base_cents: 18000, photo_cents: 9000, ar_cents: 12000, total_cents: 39000, category: "prog" };
  const selection = { design_code: "prog-mid", material_code: "1.61", photo_code: "photo-grey", ar_code: "flawless" };

  it("returns the master untouched without variations", () => {
    expect(applyStoreLensBreakdown(breakdown, [], selection)).toEqual(breakdown);
  });

  it("applies the percentage to every component and re-adds the total", () => {
    const out = applyStoreLensBreakdown(breakdown, [row({ item_kind: "adjust", item_key: "all", value: 10 })], selection);
    expect(out.lens_base_cents).toBe(19800);
    expect(out.photo_cents).toBe(9900);
    expect(out.ar_cents).toBe(13200);
    expect(out.total_cents).toBe(42900);
  });

  it("mixes one exact cell with the percentage on the rest", () => {
    const rows = [
      row({ item_kind: "adjust", item_key: "all", value: 10 }),
      row({ item_kind: "ar", item_key: lensArKey("flawless"), value: 10000 }),
    ];
    const out = applyStoreLensBreakdown(breakdown, rows, selection);
    expect(out.ar_cents).toBe(10000);
    expect(out.lens_base_cents).toBe(19800);
    expect(out.total_cents).toBe(39700);
  });

  it("leaves a component the sale did not pick at zero", () => {
    const frameOnlyish = { ...breakdown, photo_cents: 0, ar_cents: 0, total_cents: 18000 };
    const out = applyStoreLensBreakdown(frameOnlyish, [row({ item_kind: "adjust", item_key: "all", value: 25 })], {
      design_code: "prog-mid",
      material_code: "1.61",
    });
    expect(out.photo_cents).toBe(0);
    expect(out.ar_cents).toBe(0);
    expect(out.total_cents).toBe(22500);
  });
});

describe("lensPriceDenied", () => {
  it("accepts a cell price and a removal", () => {
    expect(lensPriceDenied("base", "sv:cr39", 120)).toBeNull();
    expect(lensPriceDenied("ar", "flawless", null)).toBeNull();
  });

  it("refuses an unknown kind, an empty key and an impossible amount", () => {
    expect(lensPriceDenied("nope", "x", 1)).toBe("bad_kind");
    expect(lensPriceDenied("base", "", 1)).toBe("bad_key");
    expect(lensPriceDenied("base", "sv:cr39", -1)).toBe("bad_value");
    expect(lensPriceDenied("base", "sv:cr39", 100001)).toBe("bad_value");
  });

  it("only takes the reserved key for the percentage, inside its range", () => {
    expect(lensPriceDenied("adjust", "all", 35)).toBeNull();
    expect(lensPriceDenied("adjust", "sv:cr39", 35)).toBe("bad_key");
    expect(lensPriceDenied("adjust", "all", 501)).toBe("bad_value");
    expect(lensPriceDenied("adjust", "all", -91)).toBe("bad_value");
  });
});

describe("frameRuleOf (the rule for ALL frames)", () => {
  const rule = (over: Partial<PriceRuleLike>): PriceRuleLike => ({
    establishment_id: "est_2",
    scope: "frame",
    target: null,
    mode: "percent",
    value: 35,
    valid_from: "2026-10-01T00:00:00Z",
    valid_to: null,
    ...over,
  });

  it("finds the store's own rule", () => {
    expect(frameRuleOf([rule({})], "est_2", "frame", NOW)?.value).toBe(35);
  });

  it("ignores a rule of another store, another scope or with a target", () => {
    expect(frameRuleOf([rule({ establishment_id: "est_9" })], "est_2", "frame", NOW)).toBeNull();
    expect(frameRuleOf([rule({ scope: "case" })], "est_2", "frame", NOW)).toBeNull();
    expect(frameRuleOf([rule({ target: "prod_1" })], "est_2", "frame", NOW)).toBeNull();
  });

  it("prefers the scope's own rule over the catch-all, and the latest of two", () => {
    const rules = [rule({ scope: "all", value: 10 }), rule({ value: 35 })];
    expect(frameRuleOf(rules, "est_2", "frame", NOW)?.value).toBe(35);
    const newer = [rule({ value: 35 }), rule({ value: 40, valid_from: "2026-10-20T00:00:00Z" })];
    expect(frameRuleOf(newer, "est_2", "frame", NOW)?.value).toBe(40);
  });

  it("skips a closed rule", () => {
    expect(frameRuleOf([rule({ valid_to: "2026-10-15T00:00:00Z" })], "est_2", "frame", NOW)).toBeNull();
  });

  it("reads the master with a null establishment", () => {
    expect(frameRuleOf([rule({ establishment_id: null, value: 20 })], null, "frame", NOW)?.value).toBe(20);
  });
});

describe("precedence: override beats rule beats base", () => {
  const rule = (over: Partial<PriceRuleLike>): PriceRuleLike => ({
    establishment_id: "est_2",
    scope: "frame",
    target: null,
    mode: "percent",
    value: 35,
    valid_from: "2026-10-01T00:00:00Z",
    valid_to: null,
    ...over,
  });
  const line = { establishmentId: "est_2", scope: "frame" as const, target: "prod_1", base: 100, lenses: 50 };

  it("charges the Medusa price with no rules at all", () => {
    expect(storeLinePrice([], line, NOW)).toMatchObject({ frame: 100, lenses: 50, total: 150 });
  });

  it("applies a rule written for ALL frames to the frame only", () => {
    const out = storeLinePrice([rule({})], line, NOW);
    expect(out).toMatchObject({ frame: 135, lenses: 50, total: 185, frame_source: "adjusted" });
  });

  it("falls back to the master's rule when the store has none", () => {
    const out = storeLinePrice([rule({ establishment_id: null, value: 20 })], line, NOW);
    expect(out.frame).toBe(120);
  });

  it("lets the store's own rule beat the master's", () => {
    const rules = [rule({ establishment_id: null, value: 20 }), rule({ value: 50 })];
    expect(storeLinePrice(rules, line, NOW).frame).toBe(150);
  });

  it("lets one model's exact price beat the rule", () => {
    const rules = [rule({}), rule({ target: "prod_1", mode: "override", value: 89 })];
    const out = storeLinePrice(rules, line, NOW);
    expect(out).toMatchObject({ frame: 89, lenses: 50, total: 139, frame_source: "store_exact" });
  });

  it("starts the rule from the owner's global price, not the catalog's", () => {
    const rules = [rule({}), rule({ establishment_id: null, target: "prod_1", mode: "override", value: 200 })];
    expect(storeLinePrice(rules, line, NOW).frame).toBe(270);
  });

  it("keeps the legacy general adjustment covering the lenses too", () => {
    const out = storeLinePrice([rule({ scope: "all", value: 10 })], line, NOW);
    expect(out).toMatchObject({ frame: 110, lenses: 55, total: 165 });
  });

  it("prices cases with their own rule", () => {
    const caseLine = { ...line, scope: "case" as const, lenses: 0 };
    const rules = [rule({ value: 35 }), rule({ scope: "case", value: 400 })];
    expect(storeLinePrice(rules, caseLine, NOW).frame).toBe(500);
  });
});

describe("per-store cost switches", () => {
  const toggles: CostToggleLike[] = [
    { establishment_id: "est_2", ref_kind: "rule", ref_id: "crule_1", enabled: false },
    { establishment_id: "est_2", ref_kind: "cost", ref_id: "cst_9", enabled: false },
    { establishment_id: "est_3", ref_kind: "rule", ref_id: "crule_1", enabled: true },
  ];

  it("is enabled when no row says otherwise", () => {
    expect(isEnabled("crule_2", "est_2", toggles)).toBe(true);
    expect(isEnabled("crule_1", "est_3", toggles)).toBe(true);
    expect(isEnabled("crule_1", "est_2", [])).toBe(true);
  });

  it("is disabled only for the store that switched it off", () => {
    expect(isEnabled("crule_1", "est_2", toggles)).toBe(false);
    expect(isEnabled("crule_1", "est_9", toggles)).toBe(true);
  });

  it("keeps the two kinds apart", () => {
    expect(isEnabled("cst_9", "est_2", toggles, "cost")).toBe(false);
    expect(isEnabled("cst_9", "est_2", toggles, "rule")).toBe(true);
  });

  it("is always enabled for the master (no store)", () => {
    expect(isEnabled("crule_1", null, toggles)).toBe(true);
  });

  it("lists what a store switched off", () => {
    expect(disabledIds("est_2", toggles, "rule")).toEqual(["crule_1"]);
    expect(disabledIds("est_2", toggles, "cost")).toEqual(["cst_9"]);
    expect(disabledIds(null, toggles)).toEqual([]);
  });

  it("validates a switch as the panel sends it", () => {
    expect(toggleDenied("rule", "crule_1", true)).toBeNull();
    expect(toggleDenied("other", "crule_1", true)).toBe("bad_kind");
    expect(toggleDenied("rule", "", true)).toBe("bad_ref");
    expect(toggleDenied("rule", "crule_1", "yes")).toBe("bad_value");
  });
});

describe("cost groups of the panel's accordions", () => {
  it("puts every kind in one group", () => {
    expect(costGroupOf("frame_brand")).toBe("frames");
    expect(costGroupOf("frame_sku")).toBe("frames");
    expect(costGroupOf("lens_design")).toBe("lenses");
    expect(costGroupOf("lens_ar")).toBe("lenses");
    expect(costGroupOf("order_percent")).toBe("percent");
    expect(costGroupOf("order_fixed")).toBe("order");
    expect(costGroupOf("shipping")).toBe("order");
  });
});

describe("the master the panel shows is still the owner's 2026 list", () => {
  it("keys every matrix cell the way the store variations do", () => {
    for (const design of DESIGNS) {
      for (const material of MATERIAL_CODES) {
        expect(lensBaseKey(design.code, material)).toBe(`${design.code}:${material}`);
      }
    }
  });

  it("quotes the master cell untouched when a store has no variation", () => {
    for (const design of DESIGNS) {
      for (const material of MATERIAL_CODES) {
        const master = cents(design.prices[material]) as number;
        expect(applyStoreLensPrice(master, [], { kind: "base", key: lensBaseKey(design.code, material) })).toBe(master);
      }
    }
  });

  it("keeps every photochromic and AR price reachable by its key", () => {
    for (const p of PHOTO_OPTIONS) {
      for (const cat of ["sv", "bifocal", "prog"] as const) {
        const master = cents(p[cat]);
        if (master == null) continue;
        expect(applyStoreLensPrice(master, [], { kind: "photo", key: lensPhotoKey(p.code, cat) })).toBe(master);
      }
    }
    for (const a of AR_OPTIONS) {
      const master = cents(a.price) as number;
      expect(applyStoreLensPrice(master, [], { kind: "ar", key: lensArKey(a.code) })).toBe(master);
    }
  });
});

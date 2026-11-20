import {
  adjustmentDenied,
  exactPriceDenied,
  globalPrice,
  globalPriceOverrides,
  masterLinePrice,
  storeLinePrice,
  type PriceRuleLike,
} from "../src/lib/store-pricing";
import { familyOfMode, pairPreviousValues, type PriceRuleRow } from "../src/lib/store-pricing-data";

const NOW = new Date("2026-10-27T12:00:00Z");
const rule = (over: Partial<PriceRuleLike>): PriceRuleLike => ({
  establishment_id: "est_2",
  scope: "all",
  target: null,
  mode: "percent",
  value: 10,
  valid_from: "2026-10-01T00:00:00Z",
  valid_to: null,
  ...over,
});
const line = { establishmentId: "est_2", scope: "frame" as const, target: "SKU-1", base: 100, lenses: 50 };

describe("globalPrice", () => {
  it("is the Medusa price when the owner set none", () => {
    expect(globalPrice([], "frame", "SKU-1", 99.5, NOW)).toBe(99.5);
  });

  it("is the owner's global price when there is one", () => {
    const r = rule({ establishment_id: null, scope: "frame", target: "SKU-1", mode: "override", value: 120 });
    expect(globalPrice([r], "frame", "SKU-1", 99.5, NOW)).toBe(120);
  });

  it("ignores a store's exact price (that is not the base)", () => {
    const r = rule({ scope: "frame", target: "SKU-1", mode: "override", value: 1 });
    expect(globalPrice([r], "frame", "SKU-1", 99.5, NOW)).toBe(99.5);
  });
});

describe("globalPriceOverrides (what price-sync keeps)", () => {
  it("lists only the owner's open global prices, latest first", () => {
    const rules = [
      rule({ establishment_id: null, scope: "frame", target: "prod_1", mode: "override", value: 80, valid_from: "2026-10-01T00:00:00Z" }),
      rule({ establishment_id: null, scope: "frame", target: "prod_1", mode: "override", value: 95, valid_from: "2026-10-20T00:00:00Z" }),
      rule({ establishment_id: null, scope: "case", target: "prod_2", mode: "override", value: 12 }),
      rule({ establishment_id: "est_2", scope: "frame", target: "prod_3", mode: "override", value: 1 }),
      rule({ establishment_id: null, scope: "frame", target: "prod_4", mode: "override", value: 9, valid_to: "2026-10-02T00:00:00Z" }),
    ];
    expect([...globalPriceOverrides(rules, NOW)]).toEqual([["prod_1", 95], ["prod_2", 12]]);
  });
});

describe("storeLinePrice", () => {
  it("without rules the store sells at base", () => {
    expect(storeLinePrice([], line, NOW)).toMatchObject({ frame: 100, lenses: 50, total: 150, adjustment: null });
  });

  it("a percentage applies to frame and lenses", () => {
    expect(storeLinePrice([rule({ mode: "percent", value: 10 })], line, NOW)).toMatchObject({ frame: 110, lenses: 55, total: 165 });
  });

  it("a fixed amount is added once per line", () => {
    expect(storeLinePrice([rule({ mode: "delta", value: 20 })], line, NOW)).toMatchObject({ frame: 120, lenses: 50, total: 170 });
  });

  it("an exact price is final: no percentage on the frame, lenses still adjusted", () => {
    const rules = [rule({ mode: "percent", value: 10 }), rule({ scope: "frame", target: "SKU-1", mode: "override", value: 90 })];
    expect(storeLinePrice(rules, line, NOW)).toMatchObject({ frame: 90, lenses: 55, total: 145, frame_source: "store_exact" });
  });

  it("with an exact frame price a fixed amount goes on the lenses", () => {
    const rules = [rule({ mode: "delta", value: 20 }), rule({ scope: "frame", target: "SKU-1", mode: "override", value: 90 })];
    expect(storeLinePrice(rules, line, NOW)).toMatchObject({ frame: 90, lenses: 70, total: 160 });
  });

  it("…and nowhere when the line has no lenses (the exact price stands)", () => {
    const rules = [rule({ mode: "delta", value: 20 }), rule({ scope: "frame", target: "SKU-1", mode: "override", value: 90 })];
    expect(storeLinePrice(rules, { ...line, lenses: 0 }, NOW)).toMatchObject({ frame: 90, lenses: 0, total: 90 });
  });

  it("builds on the owner's global price, not on the raw Medusa price", () => {
    const rules = [rule({ establishment_id: null, scope: "frame", target: "SKU-1", mode: "override", value: 200 }), rule({ mode: "percent", value: 10 })];
    expect(storeLinePrice(rules, line, NOW).frame).toBe(220);
  });

  it("only uses the rules of its own store", () => {
    expect(storeLinePrice([rule({ establishment_id: "est_3", value: 50 })], line, NOW).total).toBe(150);
  });

  it("ignores closed and future rules, and takes the latest active one", () => {
    const rules = [
      rule({ value: 5, valid_from: "2026-09-01T00:00:00Z", valid_to: "2026-10-01T00:00:00Z" }),
      rule({ value: 10, valid_from: "2026-10-01T00:00:00Z" }),
      rule({ value: 99, valid_from: "2026-12-01T00:00:00Z" }),
    ];
    expect(storeLinePrice(rules, line, NOW).frame).toBe(110);
  });

  it("rounds to cents and never goes below zero", () => {
    expect(storeLinePrice([rule({ mode: "percent", value: 3.333 })], { ...line, base: 9.99, lenses: 0 }, NOW).frame).toBe(10.32);
    expect(storeLinePrice([rule({ mode: "delta", value: -500 })], line, NOW).frame).toBe(0);
  });
});

describe("masterLinePrice — the chain's price every store starts from (QA note, 5-nov-2026)", () => {
  const chainRule = rule({ establishment_id: null, scope: "frame", mode: "percent", value: 10 });
  const master = { scope: "frame" as const, target: "SKU-1", base: 100 };

  it("is the bare base when the chain has no rule", () => {
    expect(masterLinePrice([], master, NOW, null)).toEqual({ frame: 100, frame_source: "base", adjustment: null, band: null });
  });

  it("applies the CHAIN's general rule (+10 % written with no store) and says so", () => {
    expect(masterLinePrice([chainRule], master, NOW, null)).toMatchObject({ frame: 110, frame_source: "rule", adjustment: { mode: "percent", value: 10 } });
    expect(masterLinePrice([rule({ establishment_id: null, scope: "all", mode: "delta", value: 5 })], master, NOW, null)).toMatchObject({ frame: 105, frame_source: "rule" });
    // The scope's own rule beats the legacy "all".
    const both = [rule({ establishment_id: null, scope: "all", mode: "percent", value: 50 }), chainRule];
    expect(masterLinePrice(both, master, NOW, null).frame).toBe(110);
  });

  it("is what a store that inherits charges — the master column and the inheriting till agree", () => {
    const m = masterLinePrice([chainRule], master, NOW, null);
    const inheriting = storeLinePrice([chainRule], { ...line, lenses: 0 }, NOW, null);
    expect(inheriting.frame).toBe(m.frame);
    expect(inheriting.adjustment).toEqual(m.adjustment);
  });

  it("never applies a STORE's rule: that belongs to that store alone", () => {
    expect(masterLinePrice([rule({ establishment_id: "est_2", scope: "frame", mode: "percent", value: 40 })], master, NOW, null)).toMatchObject({ frame: 100, frame_source: "base" });
  });

  it("the owner's own price for the model wins and is left alone (no rule, no band)", () => {
    const own = rule({ establishment_id: null, scope: "frame", target: "SKU-1", mode: "override", value: 60 });
    const band = { floor_below_cents: 7000, floor_to_cents: 7000, cap_above_cents: null, cap_to_cents: null, apply_to_cases: false, enabled: true };
    expect(masterLinePrice([own, chainRule], master, NOW, band)).toEqual({ frame: 60, frame_source: "owner", adjustment: null, band: null });
  });

  it("the chain's floor and ceiling come last, after the rule, and are tagged band", () => {
    const band = { floor_below_cents: 12000, floor_to_cents: 12000, cap_above_cents: null, cap_to_cents: null, apply_to_cases: false, enabled: true };
    expect(masterLinePrice([chainRule], master, NOW, band)).toMatchObject({ frame: 120, frame_source: "band", band: { from: 110, to: 120 } });
  });

  it("a case follows the case rule, not the frames'", () => {
    const rules = [chainRule, rule({ establishment_id: null, scope: "case", mode: "delta", value: 2 })];
    expect(masterLinePrice(rules, { scope: "case", target: "CASE-1", base: 5 }, NOW, null)).toMatchObject({ frame: 7, frame_source: "rule" });
    expect(masterLinePrice([chainRule], { scope: "case", target: "CASE-1", base: 5 }, NOW, null)).toMatchObject({ frame: 5, frame_source: "base" });
  });
});

describe("validation", () => {
  it("adjustments: none, percent within range, finite fixed amount", () => {
    expect(adjustmentDenied("none", undefined)).toBeNull();
    expect(adjustmentDenied("percent", 15)).toBeNull();
    expect(adjustmentDenied("percent", -95)).toBe("bad_value");
    expect(adjustmentDenied("delta", "abc")).toBe("bad_value");
    expect(adjustmentDenied("override", 1)).toBe("bad_mode");
  });

  it("exact prices: frame/case, a target, a non-negative price or null to remove", () => {
    expect(exactPriceDenied("frame", "SKU-1", 80)).toBeNull();
    expect(exactPriceDenied("frame", "SKU-1", null)).toBeNull();
    expect(exactPriceDenied("lens", "SKU-1", 80)).toBe("bad_scope");
    expect(exactPriceDenied("frame", " ", 80)).toBe("bad_target");
    expect(exactPriceDenied("frame", "SKU-1", -1)).toBe("bad_value");
  });
});

// ── HU-15: the history's "before → after" ────────────────────────────────────


const hist = (over: Partial<PriceRuleRow>): PriceRuleRow => ({
  id: "r0",
  establishment_id: "est_2",
  scope: "frame",
  target: "prod_1",
  mode: "override",
  value: 90,
  valid_from: "2026-10-01T00:00:00Z",
  valid_to: null,
  source: "panel",
  created_by: "usr_a",
  closed_by: null,
  ...over,
});

describe("pairPreviousValues (who changed what, before → after)", () => {
  it("pairs a rule with the one closed at the instant it opened", () => {
    const rows = [
      hist({ id: "r2", value: 80, valid_from: "2026-10-20T10:00:00Z" }),
      hist({ id: "r1", value: 90, valid_from: "2026-10-01T00:00:00Z", valid_to: "2026-10-20T10:00:00Z", closed_by: "usr_b" }),
    ];
    const [after, before] = pairPreviousValues(rows);
    expect(after).toMatchObject({ id: "r2", previous_rule_id: "r1", previous_value: 90, previous_mode: "override", replaced_by: null, family: "price" });
    expect(before).toMatchObject({ id: "r1", previous_rule_id: null, previous_value: null, replaced_by: "r2" });
  });

  it("tolerates a few milliseconds between close and open, not more", () => {
    const close = [
      hist({ id: "n", valid_from: "2026-10-20T10:00:00.900Z" }),
      hist({ id: "o", valid_to: "2026-10-20T10:00:00.000Z" }),
    ];
    expect(pairPreviousValues(close)[0].previous_rule_id).toBe("o");
    const apart = [
      hist({ id: "n", valid_from: "2026-10-20T10:00:10Z" }),
      hist({ id: "o", valid_to: "2026-10-20T10:00:00Z" }),
    ];
    expect(pairPreviousValues(apart)[0].previous_rule_id).toBeNull();
  });

  it("a rule removed (closed, nothing opened) has no successor", () => {
    const rows = [hist({ id: "r1", valid_to: "2026-10-20T10:00:00Z", closed_by: "usr_b" })];
    expect(pairPreviousValues(rows)[0]).toMatchObject({ replaced_by: null, previous_rule_id: null });
  });

  it("never pairs across stores, scopes, targets or families", () => {
    const at = "2026-10-20T10:00:00Z";
    const rows = [
      hist({ id: "new", valid_from: at }),
      hist({ id: "other_store", establishment_id: "est_3", valid_to: at }),
      hist({ id: "other_target", target: "prod_2", valid_to: at }),
      hist({ id: "case", scope: "case", valid_to: at }),
      hist({ id: "minimum", mode: "min", valid_to: at }),
      hist({ id: "chain", establishment_id: null, valid_to: at }),
    ];
    const out = pairPreviousValues(rows);
    expect(out[0].previous_rule_id).toBeNull();
    expect(out.slice(1).every((r) => r.replaced_by === null)).toBe(true);
  });

  it("an adjustment switching from percent to a fixed amount is one family", () => {
    const at = "2026-10-20T10:00:00Z";
    const rows = [
      hist({ id: "d", target: null, mode: "delta", value: 20, valid_from: at }),
      hist({ id: "p", target: null, mode: "percent", value: 10, valid_to: at }),
    ];
    expect(pairPreviousValues(rows)[0]).toMatchObject({ previous_rule_id: "p", previous_mode: "percent", previous_value: 10, family: "adjustment" });
  });

  it("keeps the input order and each closed rule is claimed once", () => {
    const at = "2026-10-20T10:00:00Z";
    const rows = [
      hist({ id: "n1", valid_from: at }),
      hist({ id: "n2", valid_from: at, value: 70 }),
      hist({ id: "o", valid_to: at }),
    ];
    const out = pairPreviousValues(rows);
    expect(out.map((r) => r.id)).toEqual(["n1", "n2", "o"]);
    expect(out.filter((r) => r.previous_rule_id === "o")).toHaveLength(1);
    expect(out[2].replaced_by).toBe("n1");
  });

  it("knows the three families and nothing else", () => {
    expect(familyOfMode("percent")).toBe("adjustment");
    expect(familyOfMode("delta")).toBe("adjustment");
    expect(familyOfMode("override")).toBe("price");
    expect(familyOfMode("min")).toBe("minimum");
    expect(familyOfMode("weird")).toBeNull();
  });
});

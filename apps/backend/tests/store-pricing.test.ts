import {
  adjustmentDenied,
  brandRuleDenied,
  exactPriceDenied,
  globalPrice,
  globalPriceOverrides,
  storeLinePrice,
  type PriceRuleLike,
} from "../src/lib/store-pricing";

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

describe("una regla por MARCA y por tienda (petición del dueño)", () => {
  const peachtree = { ...line, brand: "peachtree" };
  const brandRule = (over: Partial<PriceRuleLike>) =>
    rule({ scope: "brand", target: "peachtree", mode: "override", value: 45, ...over });

  it("un precio fijo de marca vale para todas sus monturas", () => {
    expect(storeLinePrice([brandRule({})], peachtree, NOW)).toMatchObject({
      frame: 45,
      lenses: 50,
      total: 95,
      frame_source: "brand_price",
    });
  });

  it("no toca a las monturas de otra marca ni a los estuches", () => {
    const rules = [brandRule({})];
    expect(storeLinePrice(rules, { ...line, brand: "di-caprio" }, NOW)).toMatchObject({ frame: 100, frame_source: "adjusted" });
    expect(storeLinePrice(rules, { ...line, scope: "case", brand: "peachtree" }, NOW)).toMatchObject({ frame: 100 });
  });

  it("el precio que el dueño puso a UN modelo manda sobre el de su marca", () => {
    const rules = [brandRule({}), rule({ scope: "frame", target: "SKU-1", mode: "override", value: 70 })];
    expect(storeLinePrice(rules, peachtree, NOW)).toMatchObject({ frame: 70, frame_source: "store_exact" });
  });

  it("la regla de la tienda manda sobre la del maestro", () => {
    const rules = [brandRule({ establishment_id: null, value: 90 }), brandRule({ value: 45 })];
    expect(storeLinePrice(rules, peachtree, NOW)).toMatchObject({ frame: 45 });
    // Sin regla propia, la tienda hereda la del maestro.
    expect(storeLinePrice([brandRule({ establishment_id: null, value: 90 })], peachtree, NOW)).toMatchObject({ frame: 90 });
  });

  it("una marca también admite el ajuste de siempre, y gana a la regla general", () => {
    const rules = [
      rule({ scope: "frame", mode: "percent", value: 100 }), // todas las monturas: x2
      brandRule({ mode: "percent", value: 10 }), // Peachtree: +10 %
    ];
    expect(storeLinePrice(rules, peachtree, NOW)).toMatchObject({ frame: 110, adjustment: { mode: "percent", value: 10 } });
    expect(storeLinePrice(rules, { ...line, brand: "grande" }, NOW)).toMatchObject({ frame: 200 });
  });

  it("una regla de marca cerrada ya no se aplica", () => {
    expect(storeLinePrice([brandRule({ valid_to: "2026-10-02T00:00:00Z" })], peachtree, NOW)).toMatchObject({ frame: 100 });
  });

  it("sin marca en la línea, las reglas de marca son invisibles", () => {
    expect(storeLinePrice([brandRule({})], line, NOW)).toMatchObject({ frame: 100, frame_source: "adjusted" });
  });

  it("valida el precio fijo y el ajuste", () => {
    expect(brandRuleDenied("override", 45)).toBeNull();
    expect(brandRuleDenied("override", -1)).toBe("bad_value");
    expect(brandRuleDenied("override", "x")).toBe("bad_value");
    expect(brandRuleDenied("percent", 10)).toBeNull();
    expect(brandRuleDenied("none", null)).toBeNull();
    expect(brandRuleDenied("rebaja", 10)).toBe("bad_mode");
  });
});

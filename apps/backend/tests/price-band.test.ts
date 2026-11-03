import {
  applyPriceBand,
  applyPriceBandUsd,
  bandIsNoop,
  clearPriceBandCache,
  EMPTY_PRICE_BAND,
  hasCap,
  hasFloor,
  priceBandDenied,
  priceBandFor,
  priceBandImpact,
  resolvePriceBand,
  sellingPrice,
  setPriceBandCache,
  toPriceBand,
  type PriceBand,
} from "../src/lib/pricing";
import { convertedPriceBook } from "../src/lib/price-sync";
import { storeLinePrice, type PriceRuleLike } from "../src/lib/store-pricing";

/**
 * The floor and the ceiling of a selling price, in the owner's own words:
 * «si el precio después de conversión es menor que 30, podemos definir que se
 * lleva hasta por ejemplo 60, un número fijo. Si el precio después de
 * conversión es muy alto, también poder reducirlo hasta un monto que no
 * sobrepase un umbral de, no sé, 100 dólares. Esto se debe poder hacer, por
 * ejemplo el dueño lo hace una vez para todas las tiendas».
 *
 * Six things here are money, not code style:
 *
 *   · the precedence is the STORE's band → the chain's → no band at all;
 *   · only the floor, only the ceiling and both have to work, and turning the
 *     band off must not lose the numbers;
 *   · a price the OWNER typed for a model is never moved — not by the floor,
 *     not by the ceiling, in any store;
 *   · ESTUCHES stay out unless he says otherwise (a $0.98 case sells at $5
 *     today, and a 30→60 floor would put it on the shelf at $60);
 *   · applying the band twice gives the same price as applying it once — the
 *     4-hourly job re-applies it over the whole catalogue;
 *   · and the impact preview counts the SAME models the job would move.
 */

const A = "est_01";
const B = "est_02";

const band = (over: Partial<PriceBand> = {}): PriceBand => ({
  ...EMPTY_PRICE_BAND,
  floor_below_cents: 3000,
  floor_to_cents: 6000,
  cap_above_cents: 10000,
  cap_to_cents: 10000,
  ...over,
});
const floorOnly = band({ cap_above_cents: null, cap_to_cents: null });
const capOnly = band({ floor_below_cents: null, floor_to_cents: null });

const NOW = new Date("2026-11-03T12:00:00Z");
const rule = (over: Partial<PriceRuleLike>): PriceRuleLike => ({
  establishment_id: B,
  scope: "frame",
  target: "prod_1",
  mode: "percent",
  value: 0,
  valid_from: "2026-10-01T00:00:00Z",
  valid_to: null,
  ...over,
});
const line = { establishmentId: B, scope: "frame" as const, target: "prod_1", base: 8, lenses: 0 };

afterEach(() => clearPriceBandCache());

describe("applyPriceBand — the two sides", () => {
  it("lifts a price under the floor to the fixed figure, not to the threshold", () => {
    // The whole point of two numbers: $8 is not worth $30, it is worth $60.
    expect(applyPriceBand(800, floorOnly)).toBe(6000);
  });

  it("leaves a price on the threshold alone (below, not at)", () => {
    expect(applyPriceBand(3000, floorOnly)).toBe(3000);
  });

  it("brings a price over the ceiling down to the cap", () => {
    expect(applyPriceBand(15000, capOnly)).toBe(10000);
  });

  it("works with only the floor, only the ceiling, and both", () => {
    expect(applyPriceBand(15000, floorOnly)).toBe(15000);
    expect(applyPriceBand(800, capOnly)).toBe(800);
    expect(applyPriceBand(800, band())).toBe(6000);
    expect(applyPriceBand(15000, band())).toBe(10000);
    expect(applyPriceBand(5000, band())).toBe(5000);
  });

  it("does nothing when it is switched off, and keeps the numbers", () => {
    const off = band({ enabled: false });
    expect(applyPriceBand(800, off)).toBe(800);
    expect(applyPriceBand(15000, off)).toBe(15000);
    expect(off.floor_to_cents).toBe(6000);
    expect(bandIsNoop(off)).toBe(true);
    expect(hasFloor(off)).toBe(false);
    expect(hasCap(off)).toBe(false);
  });

  it("does nothing with no band at all", () => {
    expect(applyPriceBand(800, null)).toBe(800);
    expect(applyPriceBand(800, EMPTY_PRICE_BAND)).toBe(800);
  });

  it("leaves a model with NO price alone: a hole is not a cheap price", () => {
    expect(applyPriceBand(0, band())).toBe(0);
    expect(applyPriceBand(-5, band())).toBe(-5);
  });

  it("speaks dollars too, for the price rules", () => {
    expect(applyPriceBandUsd(8, floorOnly)).toBe(60);
    expect(applyPriceBandUsd(150, capOnly)).toBe(100);
    expect(applyPriceBandUsd(49.5, band())).toBe(49.5);
  });
});

describe("applyPriceBand — estuches", () => {
  const caseBand = band({ cap_above_cents: null, cap_to_cents: null });

  it("leaves a case alone by default: a $0.98 case sells at $5, not at $60", () => {
    // sellingPrice itself: ceil(0.98) = 1, x5 = $5.
    expect(sellingPrice(0.98, "case")).toBe(5);
    expect(applyPriceBandUsd(5, caseBand, "case")).toBe(5);
  });

  it("applies to a case only when the owner turns the switch on", () => {
    expect(applyPriceBandUsd(5, { ...caseBand, apply_to_cases: true }, "case")).toBe(60);
  });

  it("the switch does not change what happens to frames", () => {
    expect(applyPriceBandUsd(8, { ...caseBand, apply_to_cases: true })).toBe(60);
    expect(applyPriceBandUsd(8, caseBand)).toBe(60);
  });
});

describe("applyPriceBand — idempotent (the job runs every 4 h)", () => {
  const twice = (price: number, b: PriceBand) => applyPriceBand(applyPriceBand(price, b), b);

  it("a floored price stays floored", () => {
    expect(twice(800, floorOnly)).toBe(applyPriceBand(800, floorOnly));
  });

  it("a capped price stays capped", () => {
    expect(twice(15000, capOnly)).toBe(applyPriceBand(15000, capOnly));
  });

  it("a floor that lands over the ceiling settles in ONE pass", () => {
    // Floor to $60 under a ceiling at $50: one pass gives $50 and the next
    // changes nothing, instead of ping-ponging 60 / 50 / 60 between runs.
    const crossed = band({ floor_below_cents: 3000, floor_to_cents: 6000, cap_above_cents: 5000, cap_to_cents: 5000 });
    expect(applyPriceBand(800, crossed)).toBe(5000);
    expect(twice(800, crossed)).toBe(5000);
  });

  it("every converted price in the real price book is stable on the second pass", () => {
    const b = band();
    for (const item of convertedPriceBook()) {
      const once = applyPriceBandUsd(item.price, b, item.kind);
      expect(applyPriceBandUsd(once, b, item.kind)).toBe(once);
    }
  });
});

describe("resolvePriceBand — store → chain → nothing", () => {
  const master = band({ floor_to_cents: 6000 });
  const own = band({ floor_to_cents: 7000 });

  it("a store with a band of its own uses it", () => {
    const got = resolvePriceBand(master, new Map([[B, own]]), B);
    expect(got).toMatchObject({ origin: "store_variation", inherited: false });
    expect(got.band?.floor_to_cents).toBe(7000);
  });

  it("a store without one inherits the chain's and is marked inherited", () => {
    const got = resolvePriceBand(master, new Map([[B, own]]), A);
    expect(got).toMatchObject({ origin: "chain_master", inherited: true });
    expect(got.band?.floor_to_cents).toBe(6000);
  });

  it("asking chain-wide gives the master and is NOT inherited", () => {
    expect(resolvePriceBand(master, new Map(), null)).toMatchObject({ origin: "chain_master", inherited: false });
  });

  it("with no master and no variation there is no adjustment at all", () => {
    const got = resolvePriceBand(null, new Map(), B);
    expect(got).toMatchObject({ band: null, origin: "none" });
    expect(applyPriceBand(800, got.band)).toBe(800);
  });

  it("one store's band never answers for another", () => {
    const only = new Map([[B, own]]);
    expect(resolvePriceBand(null, only, A).band).toBeNull();
    expect(resolvePriceBand(null, only, B).band).toBe(own);
  });
});

describe("priceBandFor — the process cache the price math reads", () => {
  it("answers nothing before the tables have been read", () => {
    expect(priceBandFor(B)).toBeNull();
  });

  it("answers the store's band, then the chain's", () => {
    setPriceBandCache(band({ floor_to_cents: 6000 }), new Map([[B, band({ floor_to_cents: 7000 })]]));
    expect(priceBandFor(B)?.floor_to_cents).toBe(7000);
    expect(priceBandFor(A)?.floor_to_cents).toBe(6000);
    expect(priceBandFor(null)?.floor_to_cents).toBe(6000);
  });

  it("goes back to no band when it is dropped after a write", () => {
    setPriceBandCache(band(), new Map());
    clearPriceBandCache();
    expect(priceBandFor(null)).toBeNull();
  });
});

describe("storeLinePrice — where the band lands", () => {
  it("lifts the frame of a cheap model and says so", () => {
    const got = storeLinePrice([], line, NOW, floorOnly);
    expect(got).toMatchObject({ frame: 60, total: 60, band: { from: 8, to: 60 } });
  });

  it("applies after the store's percentage, not before", () => {
    // $8 + 50 % = $12, still under $30 → $60. Not $8 → $60 → $90.
    const rules = [rule({ scope: "frame", target: null, mode: "percent", value: 50 })];
    expect(storeLinePrice(rules, line, NOW, floorOnly)).toMatchObject({ frame: 60 });
  });

  it("never touches the LENS add-on", () => {
    const got = storeLinePrice([], { ...line, base: 8, lenses: 12 }, NOW, floorOnly);
    expect(got).toMatchObject({ frame: 60, lenses: 12, total: 72 });
  });

  it("leaves the store's exact price exactly where the owner put it", () => {
    const rules = [rule({ scope: "frame", target: "prod_1", mode: "override", value: 12 })];
    const got = storeLinePrice(rules, line, NOW, floorOnly);
    expect(got).toMatchObject({ frame: 12, frame_source: "store_exact", band: null });
  });

  it("leaves the owner's own GLOBAL price for a model alone, in every store", () => {
    const rules = [rule({ establishment_id: null, scope: "frame", target: "prod_1", mode: "override", value: 12 })];
    expect(storeLinePrice(rules, line, NOW, floorOnly)).toMatchObject({ frame: 12, band: null });
    expect(storeLinePrice(rules, { ...line, establishmentId: A }, NOW, floorOnly)).toMatchObject({ frame: 12, band: null });
  });

  it("a ceiling brings an expensive model down", () => {
    expect(storeLinePrice([], { ...line, base: 150 }, NOW, capOnly)).toMatchObject({ frame: 100, band: { from: 150, to: 100 } });
  });

  it("leaves a case alone unless the switch is on", () => {
    const caseLine = { ...line, scope: "case" as const, base: 5 };
    expect(storeLinePrice([], caseLine, NOW, floorOnly)).toMatchObject({ frame: 5, band: null });
    expect(storeLinePrice([], caseLine, NOW, { ...floorOnly, apply_to_cases: true })).toMatchObject({ frame: 60 });
  });

  it("a frame the customer brought (no model, no base) is not given a price", () => {
    // The point of sale quotes the lenses alone on `target: ""` with base 0.
    const own = { establishmentId: B, scope: "frame" as const, target: "", base: 0, lenses: 40 };
    expect(storeLinePrice([], own, NOW, floorOnly)).toMatchObject({ frame: 0, lenses: 40, total: 40 });
  });

  it("takes the band from the cache when the caller passes none (the POS path)", () => {
    setPriceBandCache(null, new Map([[B, floorOnly]]));
    expect(storeLinePrice([], line, NOW)).toMatchObject({ frame: 60 });
    expect(storeLinePrice([], { ...line, establishmentId: A }, NOW)).toMatchObject({ frame: 8 });
  });

  it("without a cache behaves exactly as the shop did before the band existed", () => {
    expect(storeLinePrice([], line, NOW)).toMatchObject({ frame: 8, band: null });
  });
});

describe("priceBandDenied", () => {
  const ok = (over: Partial<PriceBand>) => priceBandDenied(toPriceBand({ ...EMPTY_PRICE_BAND, ...over }));

  it("accepts only the floor, only the ceiling, both and neither", () => {
    expect(ok({ floor_below_cents: 3000, floor_to_cents: 6000 })).toBeNull();
    expect(ok({ cap_above_cents: 10000, cap_to_cents: 10000 })).toBeNull();
    expect(priceBandDenied(band())).toBeNull();
    expect(ok({})).toBeNull();
  });

  it("refuses half a side: a threshold with no target says nothing to do", () => {
    expect(ok({ floor_below_cents: 3000 })).toBe("band_incomplete");
    expect(ok({ floor_to_cents: 6000 })).toBe("band_incomplete");
    expect(ok({ cap_above_cents: 10000 })).toBe("band_incomplete");
    expect(ok({ cap_to_cents: 10000 })).toBe("band_incomplete");
  });

  it("refuses a floor that lowers the price and a ceiling that raises it", () => {
    expect(ok({ floor_below_cents: 6000, floor_to_cents: 3000 })).toBe("floor_below_threshold");
    expect(ok({ cap_above_cents: 5000, cap_to_cents: 9000 })).toBe("cap_above_threshold");
  });

  it("refuses a floor that would push a price over the ceiling", () => {
    expect(ok({ floor_below_cents: 3000, floor_to_cents: 6000, cap_above_cents: 5000, cap_to_cents: 5000 })).toBe("band_crossed");
  });

  it("refuses anything that is not a whole number of cents above zero", () => {
    expect(ok({ floor_below_cents: 0, floor_to_cents: 6000 })).toBe("bad_band");
    expect(priceBandDenied({ ...EMPTY_PRICE_BAND, floor_below_cents: 30.5, floor_to_cents: 6000 })).toBe("bad_band");
    expect(priceBandDenied({ ...EMPTY_PRICE_BAND, floor_below_cents: Number.NaN, floor_to_cents: 6000 })).toBe("bad_band");
    expect(ok({ cap_above_cents: 99_999_999, cap_to_cents: 10000 })).toBe("bad_band");
    expect(priceBandDenied(null)).toBe("bad_band");
  });
});

describe("priceBandImpact — what the owner sees before he saves", () => {
  const items = convertedPriceBook();

  it("counts what a 30→60 floor and a $100 ceiling do to TODAY's catalogue", () => {
    const got = priceBandImpact(items, band());
    // 611 models in the supplier's price book: 581 frames and 30 cases.
    expect(got.total).toBe(611);
    expect(got.raised).toBe(285);
    expect(got.lowered).toBe(22);
    expect(got.raised + got.lowered + got.unchanged).toBe(got.total);
    expect(got.cases_skipped).toBe(30);
    // The number that justifies leaving the estuches out by default.
    expect(got.cases_would_raise).toBe(29);
  });

  it("gives concrete examples, the way the panel reads them out", () => {
    const got = priceBandImpact(items, band());
    expect(got.examples.raised.length).toBeGreaterThan(0);
    for (const ex of got.examples.raised) expect(ex.to).toBeGreaterThan(ex.from);
    for (const ex of got.examples.lowered) expect(ex.to).toBeLessThan(ex.from);
    // «READ 2: $8 → $60» — the $1.80 frame of the owner's own example.
    const read2 = priceBandImpact(
      items.filter((i) => i.model === "READ 2"),
      band()
    );
    expect(read2.examples.raised).toEqual([{ model: "READ 2", kind: "frame", from: 8, to: 60 }]);
  });

  it("switching the estuches on moves them too, and says how many", () => {
    const got = priceBandImpact(items, band({ apply_to_cases: true }));
    expect(got.cases_skipped).toBe(0);
    expect(got.raised).toBe(285 + 29);
  });

  it("leaves out the models the owner priced by hand, and counts them apart", () => {
    const got = priceBandImpact(items, band(), new Set(["read2"]));
    expect(got.owner_priced).toBe(1);
    expect(got.total).toBe(610);
    expect(got.raised).toBe(284);
  });

  it("an empty or switched-off band moves nothing", () => {
    for (const b of [null, EMPTY_PRICE_BAND, band({ enabled: false })]) {
      const got = priceBandImpact(items, b);
      expect(got.raised).toBe(0);
      expect(got.lowered).toBe(0);
      expect(got.unchanged).toBe(got.total);
    }
  });
});

describe("convertedPriceBook — one definition of «el precio después de conversión»", () => {
  it("is the wholesale cost through the margin rule, cases included", () => {
    const byModel = new Map(convertedPriceBook().map((i) => [i.model, i]));
    const read2 = byModel.get("READ 2");
    expect(read2).toMatchObject({ kind: "frame", price: sellingPrice(1.8, "frame") });
    expect(read2?.price).toBe(8);
    const anyCase = convertedPriceBook().find((i) => i.kind === "case");
    expect(anyCase).toBeDefined();
  });
});

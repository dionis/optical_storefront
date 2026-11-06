import {
  buildAcrossRows,
  redactAcrossCosts,
  type AcrossCosts,
  type AcrossProduct,
  type AcrossStore,
} from "../src/lib/pricing-across";
import { indexFrameCostVariations, type FrameCostRow } from "../src/lib/frame-cost";
import { clearPriceBandCache, EMPTY_PRICE_BAND, setPriceBandCache } from "../src/lib/pricing";
import { storeLinePrice, type PriceRuleLike } from "../src/lib/store-pricing";

/**
 * HU-13 — one model, its price in every store. What matters here:
 *
 *   · every cell is what THAT store's till charges (`storeLinePrice`), with
 *     the tag that says why (exact / band / adjusted / base);
 *   · a store that hides the model still gets its figure, flagged `exposed:
 *     false` — hidden is not the same as free;
 *   · the cost (the chain's and each store's own) leaves only for a reader
 *     with cost privileges, and is REMOVED, not nulled, for anyone else.
 */

const A = "est_01";
const B = "est_02";
const NOW = new Date("2026-11-05T12:00:00Z");

const rule = (over: Partial<PriceRuleLike>): PriceRuleLike => ({
  establishment_id: A,
  scope: "frame",
  target: null,
  mode: "percent",
  value: 10,
  valid_from: "2026-10-01T00:00:00Z",
  valid_to: null,
  ...over,
});

const product = (over: Partial<AcrossProduct> = {}): AcrossProduct => ({
  product_id: "prod_1",
  title: "Yandi Square",
  thumbnail: "https://cdn/x.jpg",
  brand: "dicaprio",
  skus: ["DC406", "DC406-BLK"],
  base: 100,
  ...over,
});

const store = (over: Partial<AcrossStore> = {}): AcrossStore => ({
  id: A,
  code: "Op1",
  name: "El Rancho 39",
  color: "#B5651D",
  assortment: [],
  ...over,
});

const stores = [store(), store({ id: B, code: "Op2", name: "El Rancho 41", color: "#C2185B" })];

afterEach(() => clearPriceBandCache());

describe("buildAcrossRows — the price per store", () => {
  it("one column per store, each the till's figure with its source", () => {
    const rules = [
      rule({ establishment_id: A, mode: "percent", value: 10 }),
      rule({ establishment_id: B, scope: "frame", target: "prod_1", mode: "override", value: 95 }),
    ];
    const [row] = buildAcrossRows([product()], stores, rules, null, NOW);
    expect(row).toMatchObject({
      product_id: "prod_1",
      title: "Yandi Square",
      brand: "dicaprio",
      sku: "DC406",
      skus: ["DC406", "DC406-BLK"],
      is_case: false,
      base_cents: 10000,
      master_price_cents: 10000,
      master_source: "base",
    });
    expect(row.stores).toHaveLength(2);
    expect(row.stores[0]).toMatchObject({ establishment_id: A, code: "Op1", color: "#B5651D", price_cents: 11000, source: "adjusted", exposed: true });
    expect(row.stores[1]).toMatchObject({ establishment_id: B, code: "Op2", price_cents: 9500, source: "exact", exposed: true });
    // The very same number the till would quote — never a second formula.
    expect(row.stores[0].price_cents).toBe(Math.round(storeLinePrice(rules, { establishmentId: A, scope: "frame", target: "prod_1", base: 100, lenses: 0 }, NOW).frame * 100));
  });

  it("a store with no rule of its own sells at the master, tagged base", () => {
    const [row] = buildAcrossRows([product()], stores, [], null, NOW);
    expect(row.stores.map((s) => [s.price_cents, s.source])).toEqual([[10000, "base"], [10000, "base"]]);
  });

  it("the owner's global price is the master and every store builds on it", () => {
    const rules = [rule({ establishment_id: null, scope: "frame", target: "prod_1", mode: "override", value: 80 }), rule({ establishment_id: B, mode: "percent", value: 50 })];
    const [row] = buildAcrossRows([product()], stores, rules, null, NOW);
    expect(row.master_price_cents).toBe(8000);
    expect(row.master_source).toBe("owner");
    expect(row.stores[0].price_cents).toBe(8000);
    expect(row.stores[1].price_cents).toBe(12000);
  });

  it("the floor moves a converted price and the cell says so", () => {
    setPriceBandCache({ ...EMPTY_PRICE_BAND, floor_below_cents: 3000, floor_to_cents: 6000 });
    const [row] = buildAcrossRows([product({ base: 8 })], stores, [], null, NOW);
    expect(row.master_price_cents).toBe(6000);
    expect(row.master_source).toBe("band");
    expect(row.stores[0]).toMatchObject({ price_cents: 6000, source: "band" });
  });

  it("a model without a Medusa price has no figure anywhere — never 0", () => {
    const [row] = buildAcrossRows([product({ base: null })], stores, [rule({ value: 10 })], null, NOW);
    expect(row.base_cents).toBeNull();
    expect(row.master_price_cents).toBeNull();
    for (const s of row.stores) expect(s.price_cents).toBeNull();
  });

  it("a case is priced as a case (its own rule, not the frames')", () => {
    const rules = [rule({ scope: "frame", mode: "percent", value: 10 }), rule({ scope: "case", mode: "delta", value: 2 })];
    const [row] = buildAcrossRows([product({ product_id: "case_1", brand: "case", skus: ["CASE SC-2"], base: 5 })], [stores[0]], rules, null, NOW);
    expect(row.is_case).toBe(true);
    expect(row.stores[0].price_cents).toBe(700);
  });

  it("falls back to the title as SKU when no colour has one", () => {
    const [row] = buildAcrossRows([product({ skus: [] })], stores, [], null, NOW);
    expect(row.sku).toBe("Yandi Square");
    expect(row.skus).toEqual([]);
  });
});

describe("buildAcrossRows — exposure", () => {
  it("a model hidden by its own rule or by its brand is flagged, with its price still there", () => {
    const hidden = [
      store({ id: A, assortment: [{ scope: "product", target: "prod_1", exposed: false }] }),
      store({ id: B, assortment: [{ scope: "brand", target: "dicaprio", exposed: false }] }),
      store({ id: "est_03", assortment: [{ scope: "brand", target: "dicaprio", exposed: false }, { scope: "product", target: "prod_1", exposed: true }] }),
    ];
    const [row] = buildAcrossRows([product()], hidden, [rule({ value: 10 })], null, NOW);
    expect(row.stores.map((s) => s.exposed)).toEqual([false, false, true]);
    expect(row.stores[0].price_cents).toBe(11000);
  });
});

describe("buildAcrossRows — the cost, and who gets it", () => {
  const master = (over: Partial<FrameCostRow> = {}): FrameCostRow => ({
    sku: "DC406",
    model: "DC406",
    book_cents: 8999,
    cost_cents: 2099,
    source: "supplier_list",
    updated_at: null,
    updated_by: null,
    ...over,
  });
  const costs: AcrossCosts = {
    rows: new Map([["DC406", master()]]),
    variations: indexFrameCostVariations([{ establishment_id: B, sku: "DC406", cost_cents: 2500, updated_at: null, updated_by: null }]),
  };

  it("writes the chain's cost on the row and each store's own in its cell", () => {
    const [row] = buildAcrossRows([product()], stores, [], costs, NOW);
    expect(row.cost_cents).toBe(2099);
    expect(row.stores[0].cost_cents).toBe(2099);
    expect(row.stores[1].cost_cents).toBe(2500);
  });

  it("a model no layer knows reads as unknown, not 0", () => {
    const [row] = buildAcrossRows([product({ skus: ["NO SUCH MODEL"] })], stores, [], costs, NOW);
    expect(row.cost_cents).toBeNull();
    expect(row.stores[0].cost_cents).toBeNull();
  });

  it("without cost privileges no cost key is written at all", () => {
    const [row] = buildAcrossRows([product()], stores, [], null, NOW);
    expect("cost_cents" in row).toBe(false);
    for (const s of row.stores) expect("cost_cents" in s).toBe(false);
  });

  it("redactAcrossCosts strips the key from the row and from every cell", () => {
    const rows = buildAcrossRows([product()], stores, [], costs, NOW);
    const [kept] = redactAcrossCosts(rows, true);
    expect(kept.cost_cents).toBe(2099);
    const [redacted] = redactAcrossCosts(rows, false);
    expect("cost_cents" in redacted).toBe(false);
    for (const s of redacted.stores) expect("cost_cents" in s).toBe(false);
    // …and nothing else moved.
    expect(redacted.stores.map((s) => s.price_cents)).toEqual(kept.stores.map((s) => s.price_cents));
  });
});

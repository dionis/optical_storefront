import { readFileSync } from "fs";
import { join } from "path";
import { computeCostSheet, type CostOrderLike } from "../src/lib/costing";
import {
  catalogSellingPrices,
  clearFrameCostCache,
  frameCostCents,
  frameCostCentsFor,
  frameCostStoreRows,
  frameCostStoreView,
  frameCostVariationAudit,
  frameCostVariationFrom,
  indexFrameCostVariations,
  resolveFrameCost,
  setFrameCostCache,
  summarizeFrameCosts,
  withCatalogPrice,
  type CatalogModel,
  type FrameCostRow,
  type FrameCostVariationRow,
} from "../src/lib/frame-cost";
import type { PriceRuleLike } from "../src/lib/store-pricing";
import { frameCostsSheetHeaders, frameCostsSheetRows } from "../src/lib/gsheet-sync";
import type { EstablishmentRow } from "../src/lib/establishments";
import { capriCostCents } from "../src/modules/store-pricing/capri-price-list-2026";

/**
 * The owner's sentence, both halves: «los costos se aplican a todas las
 * tiendas, pero cada tienda maneja sus costos por separado».
 *
 * Four things here are money, not code style:
 *
 *   · the precedence is store → master → supplier list → UNKNOWN, and the
 *     unknown is NOT zero (a zero turns a case into a 100 % margin);
 *   · removing a store's variation goes back to the master, not to nothing;
 *   · a sale of store A is never costed with store B's figure;
 *   · the process cache that keeps the math synchronous does not let one
 *     store's figure leak into another's.
 */

const A = "est_01";
const B = "est_02";

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

const variation = (over: Partial<FrameCostVariationRow> = {}): FrameCostVariationRow => ({
  establishment_id: A,
  sku: "DC406",
  cost_cents: 2500,
  updated_at: "2026-11-01T00:00:00.000Z",
  updated_by: "usr_1",
  ...over,
});

const mapOf = (rows: FrameCostRow[]) => new Map(rows.map((r) => [r.sku, r]));

afterEach(() => clearFrameCostCache());

// ── The precedence ───────────────────────────────────────────────────────────

describe("store → master → supplier list → unknown", () => {
  it("gives the store its own figure when it has one", () => {
    const rows = mapOf([master()]);
    const vars = indexFrameCostVariations([variation({ cost_cents: 2500 })]);
    expect(frameCostCentsFor(rows, vars, "DC406", A)).toBe(2500);
    expect(resolveFrameCost(rows, vars, "DC406", A)).toMatchObject({
      cost_cents: 2500,
      origin: "store_variation",
      master_cost_cents: 2099,
      master_source: "supplier_list",
      inherited: false,
    });
  });

  it("falls back to the owner's master edit, then to the supplier's list", () => {
    const edited = mapOf([master({ cost_cents: 1800, source: "owner_edit" })]);
    const empty = indexFrameCostVariations([]);
    expect(frameCostCentsFor(edited, empty, "DC406", A)).toBe(1800);
    expect(resolveFrameCost(edited, empty, "DC406", A)).toMatchObject({ origin: "owner_edit", inherited: true });

    // Nothing stored at all: the list compiled into the build still answers.
    expect(frameCostCentsFor(new Map(), empty, "DC406", A)).toBe(capriCostCents("DC406"));
    expect(resolveFrameCost(new Map(), empty, "DC406", A)).toMatchObject({ origin: "supplier_list", inherited: true });
  });

  it("answers UNKNOWN — not zero — when no layer knows the model", () => {
    const empty = indexFrameCostVariations([]);
    for (const sku of ["GRANDE CASE", "NO SUCH MODEL", ""]) {
      expect(frameCostCentsFor(new Map(), empty, sku, A)).toBeNull();
      expect(frameCostCentsFor(new Map(), empty, sku, A)).not.toBe(0);
      expect(frameCostCentsFor(new Map(), empty, sku, null)).toBeNull();
      expect(resolveFrameCost(new Map(), empty, sku, A)).toBeNull();
    }
  });

  it("keeps a store's variation for a model the master does not carry", () => {
    const vars = indexFrameCostVariations([variation({ sku: "NEWMODEL", cost_cents: 3300 })]);
    expect(frameCostCentsFor(new Map(), vars, "NEWMODEL", A)).toBe(3300);
    // …and that model is still unknown for the chain and for every other store.
    expect(frameCostCentsFor(new Map(), vars, "NEWMODEL", null)).toBeNull();
    expect(frameCostCentsFor(new Map(), vars, "NEWMODEL", B)).toBeNull();
    expect(resolveFrameCost(new Map(), vars, "NEWMODEL", A)).toMatchObject({
      origin: "store_variation",
      master_cost_cents: null,
      master_source: null,
    });
  });

  it("asked WITHOUT a store, answers the master even where a store varies it", () => {
    const rows = mapOf([master()]);
    const vars = indexFrameCostVariations([variation({ cost_cents: 2500 })]);
    expect(frameCostCentsFor(rows, vars, "DC406", null)).toBe(2099);
    expect(frameCostCentsFor(rows, vars, "DC406", undefined)).toBe(2099);
    expect(resolveFrameCost(rows, vars, "DC406", null)).toMatchObject({ origin: "supplier_list", inherited: false });
  });

  it("finds a variation however the SKU is spelled, like the master does", () => {
    // The catalogue writes "ML 8" where the supplier prints "ML8", and the four
    // "YC…" frames and "DI CAPRIO CASE" need `capriKeyOf`.
    const vars = indexFrameCostVariations([
      variation({ sku: "ML8", cost_cents: 1234 }),
      variation({ sku: "YC21102", cost_cents: 2345 }),
    ]);
    expect(frameCostVariationFrom(vars, "ML 8", A)?.cost_cents).toBe(1234);
    expect(frameCostVariationFrom(vars, "ml-8", A)?.cost_cents).toBe(1234);
    expect(frameCostVariationFrom(vars, "YC 21102", A)?.cost_cents).toBe(2345);
    expect(frameCostVariationFrom(vars, "DC406", A)).toBeNull();
    expect(frameCostVariationFrom(vars, "ML 8", null)).toBeNull();
  });
});

// ── Removing a variation goes back to the master ─────────────────────────────

describe("removing a store's variation", () => {
  it("returns the model to the master, never to nothing and never to zero", () => {
    const rows = mapOf([master({ cost_cents: 1800, source: "owner_edit" })]);
    const withOwn = indexFrameCostVariations([variation({ cost_cents: 2500 })]);
    expect(frameCostCentsFor(rows, withOwn, "DC406", A)).toBe(2500);

    // The route DELETES the row; the absence of a row IS "follow the chain".
    const after = indexFrameCostVariations([]);
    expect(frameCostCentsFor(rows, after, "DC406", A)).toBe(1800);
    expect(resolveFrameCost(rows, after, "DC406", A)).toMatchObject({
      cost_cents: 1800,
      origin: "owner_edit",
      inherited: true,
    });
  });

  it("audits the removal as the store inheriting again", () => {
    expect(frameCostVariationAudit(variation())).toEqual({
      sku: "DC406",
      cost_cents: 2500,
      store: A,
      origin: "store_variation",
    });
    expect(frameCostVariationAudit(null)).toBeNull();
  });
});

// ── A sale of store A is not costed with store B's figure ────────────────────

describe("the cost of a sale belongs to its store", () => {
  const items = [{ title: "DC406", quantity: 1, sku: "DC406", brand_slug: "di-caprio" }];
  const sale = (storeId: string | null): CostOrderLike => ({ total: 100, establishment_id: storeId, items });

  beforeEach(() => {
    // A pays 25.00, B inherits the chain's 20.99.
    setFrameCostCache([master({ cost_cents: 2099 })], [variation({ establishment_id: A, cost_cents: 2500 })]);
  });

  it("charges each store what IT pays", () => {
    expect(computeCostSheet(sale(A), []).materials_total).toBe(25);
    expect(computeCostSheet(sale(B), []).materials_total).toBe(20.99);
    // Without a store (a web order, a chain-wide projection): the master.
    expect(computeCostSheet(sale(null), []).materials_total).toBe(20.99);
  });

  it("never lets a store read another store's figure", () => {
    setFrameCostCache(
      [master({ cost_cents: 2099 })],
      [
        variation({ establishment_id: A, cost_cents: 2500 }),
        variation({ establishment_id: B, cost_cents: 1500 }),
      ]
    );
    expect(computeCostSheet(sale(A), []).materials_total).toBe(25);
    expect(computeCostSheet(sale(B), []).materials_total).toBe(15);
    // A store nobody typed anything for still reads the chain's figure.
    expect(computeCostSheet(sale("est_09"), []).materials_total).toBe(20.99);
  });

  it("marks a store's typed 0 as undefined instead of a free frame", () => {
    setFrameCostCache([master({ cost_cents: 2099 })], [variation({ establishment_id: A, cost_cents: 0 })]);
    const sheet = computeCostSheet(sale(A), []);
    expect(sheet.lines.find((l) => l.key.startsWith("frame:"))).toMatchObject({ subtotal: 0, undefined_cost: true });
    // …and the chain is unaffected by that store's zero.
    expect(computeCostSheet(sale(null), []).materials_total).toBe(20.99);
  });

  it("still charges the cost once per unit for the store's figure", () => {
    const two: CostOrderLike = {
      total: 400,
      establishment_id: A,
      items: [{ title: "DC406", quantity: 2, sku: "DC406", brand_slug: "di-caprio" }],
    };
    expect(computeCostSheet(two, []).materials_total).toBe(50);
  });
});

// ── The process cache keeps the stores apart ─────────────────────────────────

describe("the per-store cost cache", () => {
  it("answers nothing until the tables have been read, for every store alike", () => {
    clearFrameCostCache();
    expect(frameCostCents("DC406")).toBeNull();
    expect(frameCostCents("DC406", A)).toBeNull();
  });

  it("holds one bucket per store and does not mix them", () => {
    setFrameCostCache(
      [master({ cost_cents: 2099 })],
      [
        variation({ establishment_id: A, cost_cents: 2500 }),
        variation({ establishment_id: B, sku: "ML8", cost_cents: 900 }),
      ]
    );
    expect(frameCostCents("DC406", A)).toBe(2500);
    expect(frameCostCents("DC406", B)).toBe(2099); // B varies ML8, not DC406
    expect(frameCostCents("DC406")).toBe(2099);
    expect(frameCostCents("ML 8", B)).toBe(900);
    expect(frameCostCents("ML 8", A)).toBe(capriCostCents("ML8"));
    expect(frameCostCents("GRANDE CASE", A)).toBeNull();
  });

  it("is cleared whole, so a store does not keep answering after an edit", () => {
    setFrameCostCache([master()], [variation()]);
    clearFrameCostCache();
    expect(frameCostCents("DC406", A)).toBeNull();
  });

  it("keeps working for every store when only the master is loaded", () => {
    setFrameCostCache([master({ cost_cents: 2099 })]);
    expect(frameCostCents("DC406", A)).toBe(2099);
    expect(frameCostCents("DC406", B)).toBe(2099);
  });
});

// ── What the route returns ───────────────────────────────────────────────────

describe("the panel's per-store payload", () => {
  const rows = [master({ cost_cents: 2099 }), master({ sku: "ML8", model: "ML 8", cost_cents: 1500, source: "owner_edit" })];
  const vars = indexFrameCostVariations([variation({ cost_cents: 2500 })]);

  it("carries the effective figure, the master and whether the row is inherited", () => {
    const view = frameCostStoreRows(rows, vars, A).map(frameCostStoreView);
    expect(Object.keys(view[0])).toEqual([
      "sku",
      "model",
      "book_cents",
      "cost_cents",
      "origin",
      "source",
      "master_cost_cents",
      "inherited",
      "updated_at",
    ]);
    expect(view.find((r) => r.sku === "DC406")).toMatchObject({
      cost_cents: 2500,
      origin: "store_variation",
      source: "supplier_list",
      master_cost_cents: 2099,
      inherited: false,
    });
    expect(view.find((r) => r.sku === "ML8")).toMatchObject({
      cost_cents: 1500,
      origin: "owner_edit",
      master_cost_cents: 1500,
      inherited: true,
    });
  });

  it("with no store asked about, is the master view plus four fields", () => {
    const view = frameCostStoreRows(rows, vars, null).map(frameCostStoreView);
    for (const r of view) {
      expect(r.origin).toBe(r.source);
      expect(r.master_cost_cents).toBe(r.cost_cents);
      expect(r.inherited).toBe(false);
    }
    expect(view.find((r) => r.sku === "DC406")).toMatchObject({ cost_cents: 2099 });
  });

  it("lists a model only the store varies, and only for that store", () => {
    const extra = indexFrameCostVariations([variation({ sku: "NEWMODEL", cost_cents: 3300 })]);
    expect(frameCostStoreRows(rows, extra, A).map((r) => r.sku)).toContain("NEWMODEL");
    expect(frameCostStoreRows(rows, extra, B).map((r) => r.sku)).not.toContain("NEWMODEL");
    expect(frameCostStoreRows(rows, extra, null).map((r) => r.sku)).not.toContain("NEWMODEL");
  });

  it("counts the coverage of the STORE, and how many costs it manages apart", () => {
    const catalog: CatalogModel[] = [
      { product_id: "p1", sku: "DC406", title: "DC406", brand_slug: "di-caprio", is_case: false, price_cents: 9900 },
      { product_id: "p2", sku: "GRANDE CASE", title: "Grande case", brand_slug: "grande", is_case: true, price_cents: 500 },
    ];
    // The store alone knows what the case costs it; the chain does not.
    const vars2 = indexFrameCostVariations([variation({ sku: "GRANDECASE", cost_cents: 300 })]);
    expect(summarizeFrameCosts([master()], catalog, vars2, A)).toMatchObject({
      store_variations: 1,
      catalog_models: 2,
      with_cost: 2,
      without_cost: 0,
    });
    expect(summarizeFrameCosts([master()], catalog, vars2, B)).toMatchObject({
      store_variations: 0,
      with_cost: 1,
      without_cost: 1,
    });
    const chain = summarizeFrameCosts([master()], catalog, vars2, null);
    expect(chain).toMatchObject({ store_variations: 0, with_cost: 1, without_cost: 1 });
    expect(chain.missing).toEqual([{ sku: "GRANDE CASE", title: "Grande case", brand_slug: "grande" }]);
  });
});

// ── Cost next to price (price_cents on each cost row) ────────────────────────

describe("catalogSellingPrices / withCatalogPrice", () => {
  const catalog: CatalogModel[] = [
    { product_id: "p1", sku: "DC 406", title: "DC406", brand_slug: "di-caprio", is_case: false, price_cents: 9900 },
    { product_id: "p2", sku: "GRANDE CASE", title: "Grande case", brand_slug: "grande", is_case: true, price_cents: 500 },
    { product_id: "p3", sku: "ML 8", title: "ML 8", brand_slug: "mileniall", is_case: false, price_cents: null },
  ];
  const rule = (over: Partial<PriceRuleLike>): PriceRuleLike => ({ establishment_id: null, scope: "frame", target: null, mode: "override", value: 0, valid_from: "2026-01-01T00:00:00Z", valid_to: null, ...over });

  it("with no store, is the Medusa base unless the owner typed a global price; a model without price is left out", () => {
    const prices = catalogSellingPrices(catalog, [], null);
    expect(prices.get("DC406")).toEqual({ product_id: "p1", price_cents: 9900 });
    expect(prices.get("GRANDECASE")).toEqual({ product_id: "p2", price_cents: 500 });
    expect(prices.has("ML8")).toBe(false);
    const own = catalogSellingPrices(catalog, [rule({ target: "p1", value: 120 })], null);
    expect(own.get("DC406")).toEqual({ product_id: "p1", price_cents: 12000 });
  });

  it("with a store, is that store's price: its exact price, else base + its adjustment", () => {
    const rules = [rule({ establishment_id: A, scope: "frame", target: null, mode: "percent", value: 10 }), rule({ establishment_id: B, scope: "frame", target: "p1", value: 80 })];
    expect(catalogSellingPrices(catalog, rules, A).get("DC406")).toEqual({ product_id: "p1", price_cents: 10890 });
    expect(catalogSellingPrices(catalog, rules, B).get("DC406")).toEqual({ product_id: "p1", price_cents: 8000 });
    // A rule for all frames leaves the case alone.
    expect(catalogSellingPrices(catalog, rules, A).get("GRANDECASE")).toEqual({ product_id: "p2", price_cents: 500 });
  });

  it("withCatalogPrice appends price_cents and product_id after the existing fields, null when the catalogue has no price", () => {
    const rows = frameCostStoreRows([master({ cost_cents: 2099 }), master({ sku: "ML8", model: "ML 8", cost_cents: 1500 })], indexFrameCostVariations([]), null).map(frameCostStoreView);
    const out = withCatalogPrice(rows, catalogSellingPrices(catalog, [], null));
    expect(Object.keys(out[0]).slice(0, 9)).toEqual(Object.keys(rows[0]));
    expect(out.find((r) => r.sku === "DC406")).toMatchObject({ cost_cents: 2099, price_cents: 9900, product_id: "p1" });
    expect(out.find((r) => r.sku === "ML8")).toMatchObject({ cost_cents: 1500, price_cents: null, product_id: null });
  });
});

// ── The owner's sheet: one column per store ──────────────────────────────────

describe("the «Costos monturas» tab", () => {
  const stores = [
    { id: A, code: "EST-01", name: "Rancho", is_active: true },
    { id: B, code: "EST-02", name: "Centro", is_active: true },
  ] as unknown as EstablishmentRow[];
  const catalog: CatalogModel[] = [
    { product_id: "p1", sku: "DC406", title: "DC406", brand_slug: "di-caprio", is_case: false, price_cents: 9900 },
  ];

  it("adds a column per store and leaves it EMPTY where the store inherits", () => {
    const vars = indexFrameCostVariations([variation({ establishment_id: A, cost_cents: 2500 })]);
    const rows = frameCostsSheetRows([master({ cost_cents: 2099 })], catalog, stores, vars);
    const headers = rows[3];
    expect(headers).toEqual(frameCostsSheetHeaders(stores));
    expect(headers.slice(-2)).toEqual(["Costo EST-01", "Costo EST-02"]);
    const body = rows[4];
    // The master column is untouched; the store's own figure sits next to it.
    expect(body[3]).toBe(20.99);
    expect(body.slice(-2)).toEqual([25, ""]);
    // One row per model, not one per (model, store).
    expect(rows.filter((r, i) => i > 3 && r.length).length).toBe(1);
  });

  it("is exactly the old tab when there are no stores", () => {
    const rows = frameCostsSheetRows([master()], catalog);
    expect(rows[3]).toEqual(frameCostsSheetHeaders());
    expect(rows[3]).toHaveLength(9);
    expect(rows[4]).toHaveLength(9);
  });

  it("says in the note how many costs the stores manage apart", () => {
    const vars = indexFrameCostVariations([
      variation({ establishment_id: A }),
      variation({ establishment_id: B, sku: "ML8" }),
    ]);
    expect(String(frameCostsSheetRows([master()], catalog, stores, vars)[1][0])).toContain("2 costos propios");
    expect(String(frameCostsSheetRows([master()], catalog, stores, indexFrameCostVariations([variation()]))[1][0])).toContain(
      "1 costo propio"
    );
  });

  it("keeps the store columns when the catalogue could not be read", () => {
    const vars = indexFrameCostVariations([variation({ establishment_id: B, cost_cents: 1500 })]);
    const rows = frameCostsSheetRows([master()], [], stores, vars);
    expect(rows[4]).toHaveLength(frameCostsSheetHeaders(stores).length);
    expect(rows[4].slice(-2)).toEqual(["", 15]);
  });
});

// ── The migration ────────────────────────────────────────────────────────────

describe("the per-store cost table", () => {
  const sql = readFileSync(
    join(__dirname, "..", "src", "modules", "store-pricing", "migrations", "CreateStoreFrameCostVariation5.ts"),
    "utf8"
  );

  it("is idempotent: every statement tolerates a second run", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS store_frame_cost_variation");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_store_frame_cost_variation");
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_store_frame_cost_variation_store"');
  });

  it("keeps ONE live variation per (store, SKU)", () => {
    expect(sql).toMatch(/uq_store_frame_cost_variation[\s\S]*\(establishment_id, sku\)[\s\S]*WHERE deleted_at IS NULL/);
  });

  it("seeds nothing, so every store starts out inheriting", () => {
    expect(sql).not.toMatch(/INSERT\s+INTO/i);
  });
});

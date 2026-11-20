import { computeCostSheet, condenseLines, type CostOrderLike, type CostRule } from "../src/lib/costing";
import {
  clearFrameCostCache,
  frameCostCents,
  frameCostCentsFrom,
  frameCostDenied,
  frameCostKeyOf,
  frameCostRowFrom,
  frameCostView,
  setFrameCostCache,
  summarizeFrameCosts,
  type CatalogModel,
  type FrameCostRow,
} from "../src/lib/frame-cost";
import { FRAME_COSTS_HEADERS, frameCostsSheetRows } from "../src/lib/gsheet-sync";
import { frameCostId, frameCostSeedStatements, sqlInt, sqlText } from "../src/modules/store-pricing/frame-cost-seed";
import { CAPRI_PRICE_LIST, capriCostCents, capriKeyOf } from "../src/modules/store-pricing/capri-price-list-2026";

/**
 * The supplier's cost of a frame (Capri Optics' "Discount Price List July
 * 2026") now lives in `store_frame_cost` and is what every margin starts from.
 * Two things here are money, not code style:
 *
 *   · a cost the OWNER typed is never overwritten by the list;
 *   · a model nobody knows the cost of reads as UNKNOWN, never as 0 — a 0
 *     turns a case into a 100 % margin.
 */

const row = (over: Partial<FrameCostRow> = {}): FrameCostRow => ({
  sku: "DC406",
  model: "DC406",
  book_cents: 8999,
  cost_cents: 2099,
  source: "supplier_list",
  updated_at: null,
  updated_by: null,
  ...over,
});

const mapOf = (rows: FrameCostRow[]) => new Map(rows.map((r) => [r.sku, r]));

afterEach(() => clearFrameCostCache());

// ── The seed ─────────────────────────────────────────────────────────────────

describe("seeding store_frame_cost", () => {
  const statements = frameCostSeedStatements();

  it("writes every row of the supplier's list, once", () => {
    const keys = new Set(CAPRI_PRICE_LIST.map((r) => r.key));
    expect(keys.size).toBe(CAPRI_PRICE_LIST.length); // no duplicate key in the list
    const values = statements.join("\n").match(/\('frc_/g) ?? [];
    expect(values.length).toBe(CAPRI_PRICE_LIST.length);
    expect(CAPRI_PRICE_LIST.length).toBe(609);
  });

  it("never overwrites a row the owner edited", () => {
    for (const sql of statements) {
      expect(sql).toContain("ON CONFLICT (sku) WHERE deleted_at IS NULL DO UPDATE SET");
      // The guard: Postgres applies no row when the stored one is the owner's.
      expect(sql).toContain("WHERE store_frame_cost.source = 'supplier_list'");
      // …and the upsert must not touch who owns the row or who last changed it.
      const doUpdate = sql.slice(sql.indexOf("DO UPDATE SET"));
      expect(doUpdate).not.toMatch(/\bsource\s*=\s*EXCLUDED/);
      expect(doUpdate).not.toMatch(/\bupdated_by\s*=/);
    }
  });

  it("is idempotent: the same list produces the same statements, with stable ids", () => {
    expect(frameCostSeedStatements()).toEqual(statements);
    expect(frameCostId("CASESC2WCLIP")).toBe("frc_CASESC2WCLIP");
    // A deterministic id is what stops a second run creating a twin row.
    const ids = statements.join("\n").match(/'frc_[A-Z0-9]+'/g) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("drops a duplicate key instead of letting one INSERT hit a row twice", () => {
    const twice = [
      { model: "DC406", key: "DC406", book_cents: 8999, cost_cents: 2099 },
      { model: "DC406 (again)", key: "DC406", book_cents: 1, cost_cents: 1 },
    ];
    const sql = frameCostSeedStatements(twice).join("\n");
    expect((sql.match(/\('frc_/g) ?? []).length).toBe(1);
    expect(sql).not.toContain("DC406 (again)");
  });

  it("escapes a quote in a model name and rounds the cents", () => {
    expect(sqlText("CASE O'HARA")).toBe("'CASE O''HARA'");
    expect(sqlText(null)).toBe("NULL");
    expect(sqlInt(1699.6)).toBe("1700");
    expect(sqlInt(Number.NaN)).toBe("0");
  });
});

// ── The keys the plain normalisation misses ──────────────────────────────────

describe("capriKeyOf / frameCostKeyOf", () => {
  it("resolves the four YC… frames the catalogue prefixes", () => {
    for (const [sku, key] of [
      ["YC21102", "21102"],
      ["YC21186", "21186"],
      ["YC28017", "28017"],
      ["YC39061", "39061"],
    ] as const) {
      expect(capriKeyOf(sku)).toBe(key);
      expect(frameCostKeyOf(sku)).toBe(key);
      expect(capriCostCents(sku)).toBe(1995);
    }
  });

  it("resolves DI CAPRIO CASE onto the truncated DI CAPRIO CAS of the PDF", () => {
    expect(frameCostKeyOf("DI CAPRIO CASE")).toBe("DICAPRIOCAS");
    expect(frameCostKeyOf("di caprio case")).toBe("DICAPRIOCAS");
    expect(capriCostCents("DI CAPRIO CASE")).toBe(125);
  });

  it("strips spaces and punctuation like the catalogue writes them", () => {
    expect(frameCostKeyOf("ML 8")).toBe("ML8");
    expect(frameCostKeyOf("CASE SC-2 W/CLIP")).toBe("CASESC2WCLIP");
  });

  it("prefers a stored row spelled as the catalogue writes it over the supplier's key", () => {
    // An owner's edit saved under the catalogue spelling must still be found.
    const rows = mapOf([row({ sku: "YC21102", cost_cents: 2500, source: "owner_edit" })]);
    expect(frameCostCentsFrom(rows, "YC21102")).toBe(2500);
  });
});

// ── Unknown is not zero ──────────────────────────────────────────────────────

describe("a model with no cost", () => {
  it("answers null, never 0 — the two cases Capri does not list", () => {
    for (const sku of ["GRANDE CASE", "SIMPLYLITE CASE"]) {
      expect(capriCostCents(sku)).toBeNull();
      expect(frameCostCentsFrom(new Map(), sku)).toBeNull();
      expect(frameCostCentsFrom(new Map(), sku)).not.toBe(0);
    }
  });

  it("leaves the sale's frame line at 'cost undefined' instead of a free frame", () => {
    const order: CostOrderLike = { total: 100, items: [{ title: "Grande case", quantity: 1, sku: "GRANDE CASE", brand_slug: "grande" }] };
    const sheet = computeCostSheet(order, [], null, null, null, () => null);
    const frame = sheet.lines.find((l) => l.key.startsWith("frame:"));
    expect(frame).toMatchObject({ subtotal: 0, undefined_cost: true });
    expect(sheet.materials_total).toBe(0);
    // Which is what the panel reports as `missing_cost` — a 100 % margin that
    // nobody claims is real.
    expect(sheet.margin).toBe(100);
  });

  it("falls back to the supplier's list for a key the table does not carry yet", () => {
    expect(frameCostCentsFrom(new Map(), "DC406")).toBe(2099);
  });
});

// ── The frame's cost in a sale ───────────────────────────────────────────────

describe("the frame cost of a sale", () => {
  const rule = (kind: CostRule["kind"], match_key: string, amount: number): CostRule => ({
    kind,
    match_key,
    label: `${kind} ${match_key}`,
    amount,
    unit: "fixed",
    active: true,
    sort_order: 0,
    notes: null,
  });
  const order: CostOrderLike = {
    total: 200,
    items: [{ title: "DC406", quantity: 1, sku: "DC406", brand_slug: "di-caprio", lens: { design_code: "sv" } }],
  };

  it("comes from the supplier and REPLACES the brand rule — one line, not two", () => {
    const rules = [rule("frame_brand", "di-caprio", 20), rule("lens_design", "sv", 10)];
    const sheet = computeCostSheet(order, rules, null, null, null, () => 1699);
    const frames = sheet.lines.filter((l) => l.key.startsWith("frame:"));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ amount: 16.99, subtotal: 16.99, source: "supplier", undefined_cost: false });
    // 16.99 of frame + 10 of lens: the rule's 20 is NOT added on top.
    expect(sheet.materials_total).toBe(26.99);
  });

  it("also replaces a per-SKU rule, and keeps the concept the panel groups by", () => {
    const rules = [rule("frame_sku", "DC406", 30)];
    const sheet = computeCostSheet(order, rules, null, null, null, () => 1699);
    expect(sheet.materials_total).toBe(16.99);
    expect(condenseLines(sheet.lines).map((c) => c.key)).toContain("frame_sku:DC406");
  });

  it("keeps the brand concept when only a brand rule exists, so the breakdown does not explode", () => {
    const rules = [rule("frame_brand", "di-caprio", 20)];
    const sheet = computeCostSheet(order, rules, null, null, null, () => 1699);
    expect(condenseLines(sheet.lines).map((c) => c.key)).toContain("frame_brand:di-caprio");
  });

  it("uses the rule when the supplier knows nothing about the model", () => {
    const rules = [rule("frame_brand", "di-caprio", 20)];
    const sheet = computeCostSheet(order, rules, null, null, null, () => null);
    expect(sheet.materials_total).toBe(20);
    expect(sheet.lines.filter((l) => l.key.startsWith("frame:"))).toHaveLength(1);
  });

  it("flags an owner's cost of 0 instead of passing it off as a free frame", () => {
    const sheet = computeCostSheet(order, [], null, null, null, () => 0);
    expect(sheet.lines.find((l) => l.key.startsWith("frame:"))).toMatchObject({ subtotal: 0, undefined_cost: true });
  });

  it("charges the cost once per unit", () => {
    const two: CostOrderLike = { total: 400, items: [{ title: "DC406", quantity: 2, sku: "DC406", brand_slug: "di-caprio" }] };
    const sheet = computeCostSheet(two, [], null, null, null, () => 1699);
    expect(sheet.materials_total).toBe(33.98);
  });
});

// ── The process cache the pure math reads through ────────────────────────────

describe("the frame-cost cache", () => {
  it("answers nothing until the table has been read, so the rules keep deciding", () => {
    clearFrameCostCache();
    expect(frameCostCents("DC406")).toBeNull();
  });

  it("answers the owner's figure once the table is loaded, and the list's for the rest", () => {
    setFrameCostCache([row({ sku: "DC406", cost_cents: 2500, source: "owner_edit" })]);
    expect(frameCostCents("DC406")).toBe(2500);
    // Not in the loaded rows but in the compiled list.
    expect(frameCostCents("ML 8")).toBe(capriCostCents("ML8"));
    expect(frameCostCents("GRANDE CASE")).toBeNull();
  });

  it("is what computeCostSheet uses by default", () => {
    setFrameCostCache([row({ sku: "DC406", cost_cents: 2500, source: "owner_edit" })]);
    const sheet = computeCostSheet({ total: 100, items: [{ quantity: 1, sku: "DC406", brand_slug: "di-caprio" }] }, []);
    expect(sheet.materials_total).toBe(25);
  });
});

// ── What the routes return ───────────────────────────────────────────────────

describe("the panel's payload", () => {
  it("carries exactly the six fields of the contract", () => {
    expect(Object.keys(frameCostView(row({ updated_by: "usr_1" })))).toEqual([
      "sku",
      "model",
      "book_cents",
      "cost_cents",
      "source",
      "updated_at",
    ]);
  });

  it("counts how much of the catalogue has a real cost, and names what does not", () => {
    const catalog: CatalogModel[] = [
      { product_id: "p1", sku: "DC406", title: "DC406", brand_slug: "di-caprio", is_case: false, price_cents: 9900 },
      { product_id: "p2", sku: "ML 8", title: "ML 8", brand_slug: "millennial", is_case: false, price_cents: 7900 },
      { product_id: "p3", sku: "GRANDE CASE", title: "Grande case", brand_slug: "grande", is_case: true, price_cents: 500 },
    ];
    const summary = summarizeFrameCosts([row({ source: "owner_edit" }), row({ sku: "ML8", model: "ML 8" })], catalog);
    expect(summary).toMatchObject({
      rows: 2,
      supplier_rows: 1,
      owner_edited: 1,
      catalog_models: 3,
      with_cost: 2,
      without_cost: 1,
    });
    expect(summary.missing).toEqual([{ sku: "GRANDE CASE", title: "Grande case", brand_slug: "grande" }]);
  });

  it("refuses an edit that is not a whole number of cents", () => {
    expect(frameCostDenied("DC406", 1699)).toBeNull();
    expect(frameCostDenied("DC406", null)).toBeNull();
    expect(frameCostDenied("DC406", 0)).toBeNull();
    expect(frameCostDenied("DC406", 16.99)).toBe("bad_cost");
    expect(frameCostDenied("DC406", -1)).toBe("bad_cost");
    expect(frameCostDenied("DC406", 1_000_001)).toBe("bad_cost");
    expect(frameCostDenied("", 1699)).toBe("bad_sku");
    expect(frameCostDenied("---", 1699)).toBe("bad_sku");
    expect(frameCostDenied(42, 1699)).toBe("bad_sku");
  });

  it("reads a row as the supplier's when the table has none of its own", () => {
    expect(frameCostRowFrom(new Map(), "DC406")).toMatchObject({ sku: "DC406", source: "supplier_list", cost_cents: 2099 });
    expect(frameCostRowFrom(new Map(), "NO SUCH MODEL")).toBeNull();
  });
});

// ── The owner's sheet ────────────────────────────────────────────────────────

describe("the Costos monturas tab", () => {
  const catalog: CatalogModel[] = [
    { product_id: "p1", sku: "DC406", title: "DC406", brand_slug: "di-caprio", is_case: false, price_cents: 9900 },
    { product_id: "p2", sku: "GRANDE CASE", title: "Grande case", brand_slug: "grande", is_case: true, price_cents: 500 },
  ];

  it("puts cost, price and margin next to each model", () => {
    const rows = frameCostsSheetRows([row()], catalog);
    expect(rows[3]).toEqual(FRAME_COSTS_HEADERS);
    const dc = rows.find((r) => r[1] === "DC406");
    // 99.00 − 20.99 = 78.01, i.e. 78.8 % of the price.
    expect(dc?.slice(3, 8)).toEqual([20.99, 99, 78.01, 78.8, "Lista del proveedor"]);
  });

  it("leaves a model without cost EMPTY, never 0, and says so", () => {
    const rows = frameCostsSheetRows([row()], catalog);
    const grande = rows.find((r) => r[1] === "GRANDE CASE");
    expect(grande?.slice(3, 8)).toEqual(["", 5, "", "", "Sin costo"]);
  });

  it("marks what the owner edited, and still lists the costs when the catalogue is unreadable", () => {
    const rows = frameCostsSheetRows([row({ source: "owner_edit", updated_at: "2026-11-01T10:00:00.000Z" })], []);
    const dc = rows.find((r) => r[1] === "DC406");
    expect(dc?.[7]).toBe("Editado por el dueño");
    expect(dc?.[8]).toBe("2026-11-01");
  });
});

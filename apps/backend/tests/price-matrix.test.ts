import {
  applyLensMatrixDiscounts,
  applyPct,
  buildFrameRows,
  buildImportPlan,
  buildLensGroups,
  buildTreatmentGroups,
  changeAsCellWrite,
  cleanTreatment,
  deriveTreatmentCode,
  discountOf,
  groupFrameRows,
  indexImportRows,
  indexItemDiscounts,
  linePromoPcts,
  NO_PROMO,
  parseCellValue,
  planCellWrite,
  productDiscountOf,
  promoLinePct,
  promoStoreLine,
  redactMatrixCosts,
  storeSheetPrices,
  toMatrixProduct,
  withBrandExposure,
  type ImportIndex,
  type MatrixGroup,
  type MatrixProduct,
  type MatrixRow,
  type MatrixStore,
} from "../src/lib/price-matrix";
import type { FrameCostRow } from "../src/lib/frame-cost";
import type { LensMatrixPayload } from "../src/lib/lens-matrix";
import { publicOptionRow } from "../src/lib/lens-matrix";
import { belowMinimum, type PriceRuleLike } from "../src/lib/store-pricing";
import { discountLine, discountNeedsApproval } from "../src/lib/pos";
import { clearPriceBandCache, EMPTY_PRICE_BAND, setPriceBandCache } from "../src/lib/pricing";

/**
 * «Productos y precios» (docs/PRICE-MATRIX.md): the pure half. What matters:
 *
 *   · every store cell is the till's figure (`storeLinePrice` /
 *     `applyStoreLensPrice`) with the tag that says why;
 *   · the discount is a % off rounded to the cent PER PART, applied before the
 *     seller's discount, which then works on the reduced price;
 *   · a cell write is dispatched to the right writer, clearing included;
 *   · an import plan touches only what it names and refuses what it cannot find;
 *   · the cost never leaves for a reader without cost access.
 */

const A = "est_A";
const B = "est_B";
const NOW = new Date("2026-11-06T12:00:00Z");
const stores: MatrixStore[] = [
  { id: A, code: "Op1", name: "Katy", color: "#2e7d32" },
  { id: B, code: "Op2", name: "Rancho", color: "#c2185b" },
];

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

const product = (over: Partial<MatrixProduct> = {}): MatrixProduct => ({
  product_id: "prod_1",
  title: "DC407",
  thumbnail: "https://cdn/x.jpg",
  status: "published",
  brand_slug: "di-caprio",
  brand_name: "Di Caprio",
  skus: ["DC407", "DC407-BLK"],
  base_cents: 6000,
  is_case: false,
  price_scope: "frame",
  first_seen_at: null,
  ...over,
});

afterEach(() => clearPriceBandCache());

// ── The discount ─────────────────────────────────────────────────────────────

describe("applyPct", () => {
  it("takes the percentage off and rounds to the cent", () => {
    expect(applyPct(6000, 10)).toBe(5400);
    expect(applyPct(1999, 15)).toBe(1699); // 1699.15
    expect(applyPct(1001, 12.5)).toBe(876); // 875.875
    expect(applyPct(999, 33.33)).toBe(666); // 666.03
  });

  it("treats null, 0 and negatives as no discount and holds the cap", () => {
    expect(applyPct(6000, null)).toBe(6000);
    expect(applyPct(6000, 0)).toBe(6000);
    expect(applyPct(6000, -5)).toBe(6000);
    expect(applyPct(6000, 95)).toBe(600); // held at 90 %
    expect(applyPct(-10, 10)).toBe(0);
  });
});

describe("discount index", () => {
  const index = indexItemDiscounts([
    { establishment_id: A, item_kind: "frame", item_key: "prod_1", pct: 10 },
    { establishment_id: A, item_kind: "case", item_key: "prod_2", pct: 5.555 },
    { establishment_id: A, item_kind: "lens", item_key: "sv:cr39", pct: 0 },
    { establishment_id: B, item_kind: "ar", item_key: "ar-green", pct: 20 },
  ]);

  it("keeps live percentages by store, rounded to two decimals, and drops zeros", () => {
    expect(discountOf(index, A, "frame", "prod_1")).toBe(10);
    expect(discountOf(index, A, "case", "prod_2")).toBe(5.56);
    expect(discountOf(index, A, "lens", "sv:cr39")).toBeNull();
    expect(discountOf(index, B, "frame", "prod_1")).toBeNull();
    expect(discountOf(index, null, "frame", "prod_1")).toBeNull();
  });

  it("finds a product's discount whichever section it was typed in", () => {
    expect(productDiscountOf(index, A, "prod_1")).toBe(10);
    expect(productDiscountOf(index, A, "prod_2")).toBe(5.56);
    expect(productDiscountOf(index, A, null)).toBeNull();
  });
});

// ── Rows ─────────────────────────────────────────────────────────────────────

describe("frames section", () => {
  const costs = {
    rows: new Map<string, FrameCostRow>([
      ["DC407", { sku: "DC407", model: "DC407", book_cents: 3300, cost_cents: 1650, source: "supplier_list", updated_at: null, updated_by: null }],
    ]),
    variations: new Map(),
  };

  it("gives each store the till's price and says why", () => {
    const rules = [
      rule({ establishment_id: A, scope: "frame", target: "prod_1", mode: "override", value: 55 }),
      rule({ establishment_id: B, scope: "frame", target: null, mode: "percent", value: 10 }),
    ];
    const discounts = indexItemDiscounts([{ establishment_id: A, item_kind: "frame", item_key: "prod_1", pct: 10 }]);
    const [row] = buildFrameRows([product()], stores, rules, discounts, new Map(), costs, NOW);
    expect(row.kind).toBe("frame");
    expect(row.key).toBe("prod_1");
    expect(row.sku).toBe("DC407");
    expect(row.cost_cents).toBe(1650);
    expect(row.cost_source).toBe("supplier_list");
    expect(row.stores[A]).toEqual({ price_cents: 5500, source: "store_exact", exact: true, discount_pct: 10, final_cents: 4950, exposed: true });
    expect(row.stores[B]).toEqual({ price_cents: 6600, source: "rule", exact: false, discount_pct: null, final_cents: 6600, exposed: true });
  });

  it("tags the band, the owner's chain price and the bare base", () => {
    setPriceBandCache({ ...EMPTY_PRICE_BAND, floor_below_cents: 3000, floor_to_cents: 4500 });
    const [banded] = buildFrameRows([product({ base_cents: 1200 })], [stores[0]], [], new Map(), new Map(), null, NOW);
    expect(banded.stores[A].source).toBe("band");
    expect(banded.stores[A].price_cents).toBe(4500);
    clearPriceBandCache();
    const owner = [rule({ establishment_id: null, scope: "frame", target: "prod_1", mode: "override", value: 70 })];
    const [master] = buildFrameRows([product()], [stores[0]], owner, new Map(), new Map(), null, NOW);
    expect(master.stores[A]).toMatchObject({ price_cents: 7000, source: "master", exact: false });
    expect(master.master_cents).toBe(7000);
    const [bare] = buildFrameRows([product()], [stores[0]], [], new Map(), new Map(), null, NOW);
    expect(bare.stores[A]).toMatchObject({ price_cents: 6000, source: "base" });
  });

  it("flags a model a store hides, and has no price without a Medusa price", () => {
    const assortment = new Map([[B, [{ scope: "brand", target: "di-caprio", exposed: false }]]]);
    const [row] = buildFrameRows([product({ base_cents: null })], stores, [], new Map(), assortment, null, NOW);
    expect(row.stores[A]).toMatchObject({ price_cents: null, final_cents: null, exposed: true });
    expect(row.stores[B].exposed).toBe(false);
  });

  it("writes no cost key at all without cost access, and redaction removes them", () => {
    const [plain] = buildFrameRows([product()], stores, [], new Map(), new Map(), null, NOW);
    expect("cost_cents" in plain).toBe(false);
    const [full] = buildFrameRows([product()], stores, [], new Map(), new Map(), costs, NOW);
    const groups: MatrixGroup[] = [{ key: "g", label: "G", kind: "brand", rows: [full] }];
    const redacted = redactMatrixCosts(groups, false)[0].rows[0];
    expect("cost_cents" in redacted).toBe(false);
    expect("cost_source" in redacted).toBe(false);
    expect(redactMatrixCosts(groups, true)[0].rows[0].cost_cents).toBe(1650);
  });

  it("groups by brand with the known name, rows by title", () => {
    const products = [product({ product_id: "p2", title: "DC500" }), product({ product_id: "p1", title: "DC100" }), product({ product_id: "p3", title: "FX1", brand_slug: "flexure", brand_name: "" })];
    const rows = buildFrameRows(products, stores, [], new Map(), new Map(), null, NOW);
    const groups = groupFrameRows(rows, products, new Map([["di-caprio", "Di Caprio"], ["flexure", "Flexure"]]));
    expect(groups.map((g) => [g.key, g.label, g.kind])).toEqual([
      ["di-caprio", "Di Caprio", "brand"],
      ["flexure", "Flexure", "brand"],
    ]);
    expect(groups[0].rows.map((r) => r.title)).toEqual(["DC100", "DC500"]);
  });

  it("brand groups carry each store's brand rule and how many models it sells", () => {
    const products = [product({ product_id: "p1" }), product({ product_id: "p2", title: "DC500" })];
    const assortment = new Map([
      [A, [{ scope: "product", target: "p2", exposed: false }]],
      [B, [{ scope: "brand", target: "di-caprio", exposed: false }]],
    ]);
    const rows = buildFrameRows(products, stores, [], new Map(), assortment, null, NOW);
    const [g] = withBrandExposure(groupFrameRows(rows, products, new Map()), stores, assortment);
    expect(g.stores).toEqual({ [A]: { brand_rule: null, exposed_rows: 1 }, [B]: { brand_rule: false, exposed_rows: 0 } });
  });

  it("classifies cases by brand, metadata.kind or case rules, and keeps the till's price scope", () => {
    const raw = { product_id: "p", title: "X", thumbnail: null, status: "published", skus: [], base_cents: 500 };
    expect(toMatrixProduct({ ...raw, metadata: { brand_slug: "case" } }, new Set()).is_case).toBe(true);
    // The catalogue's word makes it a case for the till too (lib/pos-data.ts uses the same test).
    expect(toMatrixProduct({ ...raw, metadata: { brand_slug: "case" } }, new Set()).price_scope).toBe("case");
    expect(toMatrixProduct({ ...raw, metadata: { brand_slug: "di-caprio", kind: "case" } }, new Set()).price_scope).toBe("case");
    expect(toMatrixProduct({ ...raw, metadata: { brand_slug: "di-caprio" } }, new Set()).price_scope).toBe("frame");
    expect(toMatrixProduct({ ...raw, metadata: { brand_slug: "di-caprio", kind: "case" } }, new Set()).is_case).toBe(true);
    const ruled = toMatrixProduct({ ...raw, metadata: { brand_slug: "di-caprio" } }, new Set(["p"]));
    expect([ruled.is_case, ruled.price_scope]).toEqual([true, "case"]);
    expect(toMatrixProduct({ ...raw, metadata: { collection_slug: "Flexure", brand: "Flexure" } }, new Set())).toMatchObject({ brand_slug: "flexure", brand_name: "Flexure", is_case: false });
  });
});

describe("lenses section", () => {
  const input = {
    designs: [
      { code: "sv", label_es: "Visión sencilla", label_en: "Single vision", category: "sv" },
      { code: "prog-mid", label_es: "Progresivo", label_en: "Progressive", category: "prog" },
    ],
    materials: [
      { code: "cr39", label_es: "CR-39", label_en: "CR-39" },
      { code: "poly", label_es: "Policarbonato", label_en: "Polycarbonate" },
    ],
    cells: [
      { design_code: "sv", material_code: "poly", finish: "stock" as const, price_cents: 5000, cost_cents: null },
      { design_code: "sv", material_code: "cr39", finish: "digital" as const, price_cents: 6000, cost_cents: 1500 },
      { design_code: "sv", material_code: "cr39", finish: "stock" as const, price_cents: 4000, cost_cents: 800 },
      { design_code: "prog-mid", material_code: "cr39", finish: "digital" as const, price_cents: 15000, cost_cents: null },
    ],
    storeRows: new Map([
      [A, [{ establishment_id: A, item_kind: "base", item_key: "sv:cr39", value: 3500 }]],
      [B, [{ establishment_id: B, item_kind: "adjust", item_key: "all", value: 10 }]],
    ]),
  };

  it("one group per design, one row per cell keyed like the store's own price", () => {
    const discounts = indexItemDiscounts([{ establishment_id: A, item_kind: "lens", item_key: "sv:cr39", pct: 20 }]);
    const groups = buildLensGroups(input, stores, discounts, true);
    expect(groups.map((g) => [g.key, g.kind])).toEqual([
      ["sv", "design"],
      ["prog-mid", "design"],
    ]);
    expect(groups[0].rows.map((r) => [r.key, r.title])).toEqual([
      ["sv:cr39", "CR-39 · stock"],
      ["sv:cr39:digital", "CR-39 · digital"],
      ["sv:poly", "Policarbonato · stock"],
      // Not priced yet as digital: an empty row so the owner can switch it on.
      ["sv:poly:digital", "Policarbonato · digital"],
    ]);
    const off = groups[0].rows[3];
    expect(off).toMatchObject({ available: false, master_cents: null, cost_cents: null, finish: "digital", material_code: "poly" });
    expect(off.stores[A]).toMatchObject({ price_cents: null, final_cents: null, exact: false });
    // A progressive is digital only: no extra row.
    expect(groups[1].rows.map((r) => r.key)).toEqual(["prog-mid:cr39"]);
    // A progressive's only cell keeps the short key (`lensBaseKey`).
    expect(groups[1].rows[0].key).toBe("prog-mid:cr39");
    const stock = groups[0].rows[0];
    expect(stock.cost_cents).toBe(800);
    expect(stock.stores[A]).toEqual({ price_cents: 3500, source: "store_exact", exact: true, discount_pct: 20, final_cents: 2800, exposed: true });
    expect(stock.stores[B]).toMatchObject({ price_cents: 4400, source: "rule", exact: false });
    expect(groups[0].rows[1].stores[A]).toMatchObject({ price_cents: 6000, source: "master" });
  });

  it("has no cost key without cost access", () => {
    const groups = buildLensGroups(input, stores, new Map(), false);
    expect("cost_cents" in groups[0].rows[0]).toBe(false);
  });
});

describe("treatments section", () => {
  const photos = [
    { code: "photo-grey", label_es: "Fotocromático gris", label_en: "Photochromic grey", price_sv_cents: 3000, price_bifocal_cents: null, price_prog_cents: 4000 },
  ];
  const ars = [
    { code: "ar-green", label_es: "AR Green", label_en: "AR Green", ar_group: "all", price_cents: 2500 },
    { code: "ar-plus", label_es: "AR Plus", label_en: "AR Plus", ar_group: "sv", price_cents: 1800 },
  ];

  it("photochromics per category offered, ARs per option, with the option's cost", () => {
    const discounts = indexItemDiscounts([{ establishment_id: B, item_kind: "photo", item_key: "photo-grey:prog", pct: 25 }]);
    const [photo, ar] = buildTreatmentGroups(
      {
        photos,
        ars,
        photoCosts: new Map([["photo-grey", 900]]),
        arCosts: new Map(),
        storeRows: new Map([[A, [{ establishment_id: A, item_kind: "ar", item_key: "ar-plus", value: 2000 }]]]),
        photoByMaterial: false,
      },
      stores,
      discounts,
      true
    );
    expect([photo.key, ar.key]).toEqual(["photo", "ar"]);
    expect(photo.rows.map((r) => r.key)).toEqual(["photo-grey:sv", "photo-grey:prog"]); // no bifocal: not offered
    expect(photo.rows.every((r) => r.cost_cents === 900)).toBe(true);
    expect(photo.rows[1].stores[B]).toMatchObject({ price_cents: 4000, discount_pct: 25, final_cents: 3000 });
    expect(ar.rows.map((r) => [r.key, r.by_material, r.cost_cents])).toEqual([
      ["ar-green", true, null],
      ["ar-plus", false, null],
    ]);
    expect(ar.rows[1].stores[A]).toMatchObject({ price_cents: 2000, source: "store_exact", exact: true });
  });
});

// ── Writing one cell ─────────────────────────────────────────────────────────

describe("parseCellValue", () => {
  it("dollars to cents, percentages as they are, blanks clear", () => {
    expect(parseCellValue("price", 54)).toEqual({ value: 5400 });
    expect(parseCellValue("cost", "16.50")).toEqual({ value: 1650 });
    expect(parseCellValue("price", "$19.99")).toEqual({ value: 1999 });
    expect(parseCellValue("discount", "12.5%")).toEqual({ value: 12.5 });
    expect(parseCellValue("discount", 0)).toEqual({ value: null });
    for (const blank of [null, undefined, "", "  "]) expect(parseCellValue("price", blank)).toEqual({ value: null });
  });

  it("refuses what is not a figure and a discount out of range", () => {
    expect(parseCellValue("price", "abc")).toEqual({ reason: "bad_value" });
    expect(parseCellValue("price", -1)).toEqual({ reason: "bad_value" });
    expect(parseCellValue("price", 100001)).toEqual({ reason: "bad_value" });
    expect(parseCellValue("cost", true)).toEqual({ reason: "bad_value" });
    expect(parseCellValue("discount", 91)).toEqual({ reason: "discount_range" });
    expect(parseCellValue("discount", -1)).toEqual({ reason: "discount_range" });
  });
});

describe("planCellWrite", () => {
  const ok = (input: Parameters<typeof planCellWrite>[0]) => {
    const r = planCellWrite(input);
    if ("reason" in r) throw new Error(r.reason);
    return r.op;
  };

  it("dispatches each kind and field to its writer", () => {
    expect(ok({ kind: "frame", key: "prod_1", field: "cost", store: null, value: 16.5 })).toEqual({ op: "frame_cost", kind: "frame", productId: "prod_1", cents: 1650 });
    expect(ok({ kind: "case", key: "prod_9", field: "price", store: A, value: 5 })).toEqual({ op: "frame_price", kind: "case", productId: "prod_9", storeId: A, usd: 5 });
    expect(ok({ kind: "lens", key: "sv:cr39", field: "cost", store: "", value: 8 })).toEqual({ op: "lens_cost", kind: "lens", storeKind: "base", key: "sv:cr39", cents: 800 });
    expect(ok({ kind: "photo", key: "photo-grey:sv", field: "price", store: A, value: 30 })).toEqual({ op: "lens_price", kind: "photo", storeKind: "photo", key: "photo-grey:sv", storeId: A, cents: 3000 });
    expect(ok({ kind: "ar", key: "ar-green", field: "discount", store: B, value: 15 })).toEqual({ op: "discount", kind: "ar", key: "ar-green", storeId: B, pct: 15 });
  });

  it("clearing: price back to the rule, discount to none, cost back to the list", () => {
    expect(ok({ kind: "frame", key: "prod_1", field: "price", store: A, value: null })).toMatchObject({ op: "frame_price", usd: null });
    expect(ok({ kind: "frame", key: "prod_1", field: "discount", store: A, value: "" })).toMatchObject({ op: "discount", pct: null });
    expect(ok({ kind: "frame", key: "prod_1", field: "discount", store: A, value: 0 })).toMatchObject({ op: "discount", pct: null });
    expect(ok({ kind: "frame", key: "prod_1", field: "cost", store: undefined, value: null })).toMatchObject({ op: "frame_cost", cents: null });
    expect(ok({ kind: "lens", key: "sv:cr39", field: "price", store: A, value: null })).toMatchObject({ op: "lens_price", cents: null });
  });

  it("answers the contract's reasons", () => {
    const reason = (input: Parameters<typeof planCellWrite>[0]) => (planCellWrite(input) as { reason?: string }).reason;
    expect(reason({ kind: "glasses", key: "x", field: "price", store: A, value: 1 })).toBe("bad_kind");
    expect(reason({ kind: "frame", key: "x", field: "margin", store: A, value: 1 })).toBe("bad_field");
    expect(reason({ kind: "frame", key: "x", field: "price", store: null, value: 1 })).toBe("store_required");
    expect(reason({ kind: "frame", key: "x", field: "discount", store: "", value: 1 })).toBe("store_required");
    expect(reason({ kind: "frame", key: "x", field: "cost", store: A, value: 1 })).toBe("store_not_allowed");
    expect(reason({ kind: "frame", key: "x", field: "price", store: A, value: "nope" })).toBe("bad_value");
    expect(reason({ kind: "frame", key: "x", field: "discount", store: A, value: 95 })).toBe("discount_range");
    expect(reason({ kind: "lens", key: "cr39", field: "price", store: A, value: 1 })).toBe("unknown_item");
    expect(reason({ kind: "photo", key: "photo-grey:kids", field: "price", store: A, value: 1 })).toBe("unknown_item");
    expect(reason({ kind: "ar", key: "a:b", field: "price", store: A, value: 1 })).toBe("unknown_item");
    expect(reason({ kind: "frame", key: "", field: "price", store: A, value: 1 })).toBe("unknown_item");
  });
});

// ── The till ─────────────────────────────────────────────────────────────────

describe("a sale line with the owner's promotion", () => {
  const lens = { lens_base_cents: 4000, photo_cents: 3000, ar_cents: 2500 };
  const input = { establishmentId: A, scope: "frame" as const, target: "prod_1", base: 60, lens };

  it("discounts each part on its own, rounded to the cent", () => {
    const pcts = { frame_pct: 10, lens_pct: 15, photo_pct: null, ar_pct: 33.33 };
    const line = promoStoreLine([], input, pcts, NOW);
    // frame 60 → 54; lens 40 → 34, photo 30, AR 25 → 16.67
    expect(line.frame).toBe(54);
    expect(line.lenses).toBe(80.67);
    expect(line.promo).toEqual({ frame_pct: 10, lens_pct: 15, photo_pct: null, ar_pct: 33.33, before_cents: 15500 });
    expect(promoLinePct(line.promo, line.frame + line.lenses)).toBe(13.1); // 20.33 off 155.00
  });

  it("applies after the store's own price and before its legacy store-wide adjustment on lenses", () => {
    const rules = [rule({ scope: "all", mode: "percent", value: 10 })];
    const line = promoStoreLine(rules, input, { ...NO_PROMO, frame_pct: 50, lens_pct: 50 }, NOW);
    // frame 60 × 1.10 = 66 → 33; lenses (20 + 30 + 25) × 1.10 = 82.50
    expect(line.frame).toBe(33);
    expect(line.lenses).toBe(82.5);
    expect(line.promo?.before_cents).toBe(6600 + 10450);
  });

  it("is a no-op without discounts", () => {
    const line = promoStoreLine([], input, NO_PROMO, NOW);
    expect([line.frame, line.lenses, line.promo]).toEqual([60, 95, null]);
    expect(line.before.frame_source).toBe("adjusted");
  });

  it("the seller's discount, its limit and the minimum work on the reduced price", () => {
    const line = promoStoreLine([], input, { ...NO_PROMO, frame_pct: 10 }, NOW);
    const list = line.frame + line.lenses; // 54 + 95 = 149
    const sold = discountLine({ frame: line.frame, lenses: line.lenses }, 10);
    expect(sold).toEqual({ frame: 48.6, lenses: 85.5, total: 134.1 });
    // A 10 % sale discount is a 10 % discount on the promotion price, not on 155.
    expect(discountNeedsApproval({ isAdmin: false, pct: 10, limitPct: 10, belowMinimum: false })).toBe(false);
    // The floor (% of list) is measured against the reduced list.
    expect(belowMinimum({ frame_min: null, floor_pct: 90 }, { list, frame: sold.frame, total: sold.total })).toBe(false);
    expect(belowMinimum({ frame_min: 50, floor_pct: null }, { list, frame: sold.frame, total: sold.total })).toBe(true);
  });

  it("the customer's own frame: only the lens parts", () => {
    const line = promoStoreLine([], { ...input, target: "", base: 0 }, { ...NO_PROMO, frame_pct: 50, lens_pct: 50 }, NOW);
    expect(line.frame).toBe(0);
    expect(line.lenses).toBe(75);
    expect(line.promo).toMatchObject({ frame_pct: null, lens_pct: 50, before_cents: 9500 });
  });

  it("finds each part's discount by the keys the store prices use", () => {
    const index = indexItemDiscounts([
      { establishment_id: A, item_kind: "frame", item_key: "prod_1", pct: 10 },
      { establishment_id: A, item_kind: "lens", item_key: "sv:poly:digital", pct: 5 },
      { establishment_id: A, item_kind: "photo", item_key: "photo-grey:sv", pct: 7 },
      { establishment_id: A, item_kind: "ar", item_key: "ar-green", pct: 9 },
    ]);
    const selection = { design_code: "sv", material_code: "poly", photo_code: "photo-grey", ar_code: "ar-green" };
    expect(linePromoPcts(index, A, { productId: "prod_1", selection, category: "sv", finish: "digital" })).toEqual({ frame_pct: 10, lens_pct: 5, photo_pct: 7, ar_pct: 9 });
    expect(linePromoPcts(index, A, { productId: "prod_1", selection, category: "sv", finish: "stock" }).lens_pct).toBeNull();
    expect(linePromoPcts(index, A, { productId: "prod_1", selection: { design_code: "frame-only" }, category: null, finish: null })).toEqual({ frame_pct: 10, lens_pct: null, photo_pct: null, ar_pct: null });
  });
});

describe("the till's lens list with the discounts", () => {
  const matrix: LensMatrixPayload = {
    designs: [{ code: "sv", category: "sv" }],
    materials: [{ code: "cr39" }],
    base_prices: [
      { design_code: "sv", material_code: "cr39", finish: "stock", price_cents: 4000 },
      { design_code: "sv", material_code: "cr39", finish: "digital", price_cents: 6000 },
    ],
    photos: [{ code: "photo-grey", price_sv_cents: 3000, price_bifocal_cents: null, price_prog_cents: 4000 }],
    ars: [{ code: "ar-green", price_cents: 2500 }],
    treatment_prices: [],
  };

  it("reduces the discounted cells and says what they were", () => {
    const index = indexItemDiscounts([
      { establishment_id: A, item_kind: "lens", item_key: "sv:cr39", pct: 25 },
      { establishment_id: A, item_kind: "photo", item_key: "photo-grey:prog", pct: 50 },
      { establishment_id: A, item_kind: "ar", item_key: "ar-green", pct: 10 },
    ]);
    const out = applyLensMatrixDiscounts(matrix, index, A);
    expect(out.base_prices[0]).toEqual({ design_code: "sv", material_code: "cr39", finish: "stock", price_cents: 3000, price_before_cents: 4000, discount_pct: 25 });
    expect(out.base_prices[1]).toBe(matrix.base_prices[1]);
    expect(out.photos[0]).toMatchObject({ price_sv_cents: 3000, price_prog_cents: 2000, price_before: { prog: 4000 }, discount_pct: { prog: 50 } });
    expect(out.ars[0]).toMatchObject({ price_cents: 2250, price_before_cents: 2500, discount_pct: 10 });
  });

  it("returns the very same payload for a store without discounts or without a store", () => {
    expect(applyLensMatrixDiscounts(matrix, new Map(), A)).toBe(matrix);
    expect(applyLensMatrixDiscounts(matrix, indexItemDiscounts([{ establishment_id: B, item_kind: "ar", item_key: "ar-green", pct: 10 }]), A)).toBe(matrix);
    expect(applyLensMatrixDiscounts(matrix, new Map(), null)).toBe(matrix);
  });

  it("never serves an option's lab cost on the public list", () => {
    expect(publicOptionRow({ code: "ar-green", price_cents: 2500, cost_cents: 700 })).toEqual({ code: "ar-green", price_cents: 2500 });
  });
});

// ── Import ───────────────────────────────────────────────────────────────────

describe("buildImportPlan", () => {
  const frameRow: MatrixRow = {
    kind: "frame",
    key: "prod_1",
    product_id: "prod_1",
    sku: "DC407",
    skus: ["DC407", "DC407-BLK"],
    title: "DC407",
    cost_cents: 1650,
    cost_source: "supplier_list",
    stores: {
      [A]: { price_cents: 6000, source: "store_exact", exact: true, discount_pct: 10, final_cents: 5400, exposed: true },
      [B]: { price_cents: 6000, source: "base", exact: false, discount_pct: null, final_cents: 6000, exposed: true },
    },
  };
  const lensRow: MatrixRow = {
    kind: "lens",
    key: "prog-mid:cr39",
    title: "CR-39 · digital",
    cost_cents: null,
    stores: { [A]: { price_cents: 15000, source: "master", exact: false, discount_pct: null, final_cents: 15000, exposed: true } },
  };
  const arRow: MatrixRow = {
    kind: "ar",
    key: "ar-green",
    title: "AR Green",
    cost_cents: 300,
    stores: { [A]: { price_cents: 2500, source: "master", exact: false, discount_pct: null, final_cents: 2500, exposed: true } },
  };
  const into = { products: new Map<string, MatrixRow>(), lenses: new Map<string, MatrixRow>(), treatments: new Map<string, MatrixRow>() };
  indexImportRows(
    [
      { key: "di-caprio", label: "Di Caprio", kind: "brand", rows: [frameRow] },
      { key: "prog-mid", label: "Progresivo", kind: "design", rows: [lensRow] },
      { key: "ar", label: "Antirreflejo", kind: "treatment", rows: [arRow] },
    ],
    into
  );
  const index: ImportIndex = { ...into, stores };
  const canonical = (k: string) => (k === "prog-mid:cr39:digital" ? "prog-mid:cr39" : k);

  it("plans only the cells it names, against what is stored today", () => {
    const plan = buildImportPlan(
      [
        { section: "frames", sku: "dc-407", cost: 18, stores: { Op1: { price: null }, op2: { price: 55, discount: 5 } } },
        { section: "lenses", key: "prog-mid:cr39:digital", cost: 8, stores: { Op1: { price: 140 } } },
        { section: "treatments", key: "ar-green", stores: { Op1: { discount: 0 } } },
      ],
      index,
      canonical
    );
    expect(plan.errors).toEqual([]);
    expect(plan.changes.map((c) => [c.row, c.kind, c.field, c.store_code, c.before, c.after])).toEqual([
      [0, "frame", "cost", null, 16.5, 18],
      [0, "frame", "price", "Op1", 60, null],
      [0, "frame", "price", "Op2", 60, 55],
      [0, "frame", "discount", "Op2", null, 5],
      [1, "lens", "cost", null, null, 8],
      [1, "lens", "price", "Op1", 150, 140],
    ]);
    // Op1's discount on the frame was absent from the row: untouched. AR discount 0 = already none.
    expect(plan.counts).toMatchObject({ rows: 3, changes: 6, errors: 0, cost: 2, price: 3, discount: 1, unchanged: 1 });
    expect(plan.changes[1].key).toBe("prod_1");
    expect(plan.changes[4].key).toBe("prog-mid:cr39");
  });

  it("re-importing what is stored changes nothing", () => {
    const plan = buildImportPlan(
      [{ section: "frames", sku: "DC407", cost: 16.5, stores: { Op1: { price: 60, discount: 10 }, Op2: { price: null, discount: null } } }],
      index
    );
    expect(plan.changes).toEqual([]);
    expect(plan.counts.unchanged).toBe(5);
  });

  it("re-importing the exported book (effective price in every cell, fixed or not) changes nothing", () => {
    // Op2 is not fixed (source base, 60): the book carries 60 there too.
    const plan = buildImportPlan([{ section: "frames", sku: "DC407", cost: 16.5, stores: { Op1: { price: 60, discount: 10 }, Op2: { price: 60, discount: null } } }], index);
    expect(plan.changes).toEqual([]);
    expect(plan.counts.unchanged).toBe(5);
    // A different figure in that cell is a change (it becomes the store's own price).
    expect(buildImportPlan([{ section: "frames", sku: "DC407", stores: { Op2: { price: 61 } } }], index).changes).toHaveLength(1);
  });

  it("a frame's cost cleared only when the owner typed it; a lens cost cleared when set", () => {
    expect(buildImportPlan([{ section: "frames", sku: "DC407", cost: null }], index).changes).toEqual([]);
    const owned = { ...frameRow, cost_source: "owner_edit" };
    const ownIndex: ImportIndex = { ...index, products: new Map([["DC407", owned]]) };
    expect(buildImportPlan([{ section: "frames", sku: "DC407", cost: null }], ownIndex).changes[0]).toMatchObject({ field: "cost", before: 16.5, after: null });
    expect(buildImportPlan([{ section: "treatments", key: "ar-green", cost: "" }], index).changes[0]).toMatchObject({ field: "cost", before: 3, after: null });
  });

  it("reports unknown SKUs, keys and store codes, and bad values, row by row", () => {
    const plan = buildImportPlan(
      [
        { section: "frames", sku: "NOPE1" },
        { section: "lenses", key: "sv:unobtainium" },
        { section: "frames", sku: "DC407", stores: { Op9: { price: 1 } } },
        { section: "frames", sku: "DC407", cost: "abc", stores: { Op1: { discount: 120 } } },
        { section: "glasses", key: "x" },
        "not a row",
      ],
      index
    );
    expect(plan.errors).toEqual([
      { row: 0, reason: "unknown_item", detail: "NOPE1" },
      { row: 1, reason: "unknown_item", detail: "sv:unobtainium" },
      { row: 2, reason: "store_not_found", detail: "Op9" },
      { row: 3, reason: "bad_value", detail: "cost" },
      { row: 3, reason: "discount_range", detail: "Op1.discount" },
      { row: 4, reason: "bad_section", detail: "glasses" },
      { row: 5, reason: "bad_row", detail: null },
    ]);
    expect(plan.changes).toEqual([]);
  });

  it("a planned change becomes the same cell write the screen sends", () => {
    const plan = buildImportPlan([{ section: "frames", sku: "DC407", stores: { Op2: { price: 55 } } }], index);
    const write = changeAsCellWrite(plan.changes[0]);
    expect(write).toEqual({ kind: "frame", key: "prod_1", field: "price", store: B, value: 55 });
    expect(planCellWrite(write)).toEqual({ op: { op: "frame_price", kind: "frame", productId: "prod_1", storeId: B, usd: 55 } });
  });
});

// ── New treatments ───────────────────────────────────────────────────────────

describe("treatments: code and validation", () => {
  it("derives a code from the label with the family's prefix, unique", () => {
    expect(deriveTreatmentCode("ar", "AR Green Plus", new Set())).toBe("ar-green-plus");
    expect(deriveTreatmentCode("ar", "Blue Cut", new Set())).toBe("ar-blue-cut");
    expect(deriveTreatmentCode("photo", "Fotocromático Azul", new Set())).toBe("photo-fotocromatico-azul");
    expect(deriveTreatmentCode("photo", "Trans Gen 8", new Set())).toBe("trans-gen-8");
    expect(deriveTreatmentCode("ar", "Blue Cut", new Set(["ar-blue-cut", "ar-blue-cut-2"]))).toBe("ar-blue-cut-3");
    expect(deriveTreatmentCode("ar", "!!!", new Set())).toBe("ar");
  });

  it("validates the body", () => {
    const ar = cleanTreatment({ type: "ar", label_es: "AR Plus", label_en: "", cost: 4, prices: 25 });
    expect(ar).toEqual({ treatment: { type: "ar", label_es: "AR Plus", label_en: "AR Plus", code: null, cost_cents: 400, ar_group: "all", prices: { ar: 2500 } } });
    const photo = cleanTreatment({ type: "photo", label_en: "Grey", prices: { sv: 30, bifocal: null, prog: "40" } });
    expect(photo).toMatchObject({ treatment: { label_es: "Grey", cost_cents: null, prices: { sv: 3000, bifocal: null, prog: 4000 } } });
    expect(cleanTreatment({ type: "tint", label_es: "x", prices: 1 })).toEqual({ reason: "bad_type" });
    expect(cleanTreatment({ type: "ar", label_es: "", label_en: "", prices: 1 })).toEqual({ reason: "bad_label" });
    expect(cleanTreatment({ type: "ar", label_es: "x", prices: null })).toEqual({ reason: "bad_value" });
    expect(cleanTreatment({ type: "photo", label_es: "x", prices: { sv: null } })).toEqual({ reason: "bad_value" });
    expect(cleanTreatment({ type: "ar", label_es: "x", prices: 1, ar_group: "kids" })).toEqual({ reason: "bad_value" });
    expect(cleanTreatment({ type: "ar", label_es: "x", prices: 1, code: "Bad Code!" })).toEqual({ reason: "bad_value" });
  });
});

// ── The sheet ────────────────────────────────────────────────────────────────

describe("storeSheetPrices", () => {
  it("each store's till price and discount per model", () => {
    const rules = [rule({ establishment_id: B, scope: "frame", target: "prod_1", mode: "override", value: 50 })];
    const discounts = indexItemDiscounts([{ establishment_id: A, item_kind: "frame", item_key: "prod_1", pct: 15 }]);
    const out = storeSheetPrices([{ product_id: "prod_1", price_cents: 6000 }, { product_id: "prod_2", price_cents: null }], [A, B], rules, discounts, NOW);
    expect(out.get("prod_1")?.get(A)).toEqual({ price_cents: 6000, discount_pct: 15 });
    expect(out.get("prod_1")?.get(B)).toEqual({ price_cents: 5000, discount_pct: null });
    expect(out.get("prod_2")?.get(A)).toEqual({ price_cents: null, discount_pct: null });
  });
});

describe("first_seen_at on frame rows", () => {
  it("comes from the product metadata so the screen can mark new models", () => {
    const p = toMatrixProduct(
      { product_id: "prod_n", title: "DC900", thumbnail: null, status: "published", metadata: { brand_slug: "di-caprio", first_seen_at: "2026-11-06T10:00:00.000Z" }, skus: ["DC900"], base_cents: 5000 },
      new Set()
    );
    expect(p.first_seen_at).toBe("2026-11-06T10:00:00.000Z");
    const q = toMatrixProduct({ ...{ product_id: "prod_o", title: "DC1", thumbnail: null, status: "published", metadata: {}, skus: ["DC1"], base_cents: 5000 } }, new Set());
    expect(q.first_seen_at).toBeNull();
  });
});

/**
 * «Productos y precios» — regressions found by the end-to-end QA of 6/7-nov-2026
 * (docs/QA-E2E-2026-11-05.md, section «Productos y precios (6-nov)»):
 *
 *  - D1  the row's SKU was the first variant by id (any colour), so the cost of
 *        half the models read as missing — `modelSkuOf`.
 *  - D2  brandless cases grouped under «—» with a brand switch that wrote a rule
 *        no product follows — one «Estuches» group, no switch.
 *  - D6  a «tallado digital» cell not priced yet had no row: the merged screen
 *        could not switch the finish on — `available: false` rows; the price
 *        creates the master cell, a cost waits for it.
 *  - D10 a case the till priced as a frame (band) in a store where it had no
 *        case rule while the matrix showed its case price — `storePriceScope`.
 *  - D5  a discontinued (draft) model stayed sellable at the POS — `isDiscontinued`.
 */
jest.mock("../src/lib/lens-price-write", () => ({ writeLensMaster: jest.fn(async () => null) }));
jest.mock("../src/lib/audit", () => ({ ...jest.requireActual("../src/lib/audit"), recordAudit: jest.fn(async () => undefined) }));
jest.mock("../src/lib/pricing-overview", () => ({
  ...jest.requireActual("../src/lib/pricing-overview"),
  upsertStoreLensPrice: jest.fn(async () => null),
}));

import {
  buildFrameRows,
  buildLensGroups,
  CASES_LABEL,
  groupFrameRows,
  indexItemDiscounts,
  metadataSaysCase,
  modelSkuOf,
  planCellWrite,
  storePriceScope,
  toMatrixProduct,
  withBrandExposure,
  type CellOp,
  type MatrixProduct,
  type MatrixRow,
} from "../src/lib/price-matrix";
import { executeCellOp } from "../src/lib/price-matrix-data";
import { isDiscontinued } from "../src/lib/pos-data";
import { writeLensMaster } from "../src/lib/lens-price-write";
import { upsertStoreLensPrice } from "../src/lib/pricing-overview";
import { recordAudit } from "../src/lib/audit";
import type { FrameCostRow } from "../src/lib/frame-cost";

const A = "est_A";
const B = "est_B";
const stores = [
  { id: A, code: "Op1", name: "Katy", color: "#7C3AED" },
  { id: B, code: "Op2", name: "Houston", color: "#DC2626" },
];
const noDiscounts = indexItemDiscounts([]);

beforeEach(() => jest.clearAllMocks());

const product = (over: Partial<MatrixProduct>): MatrixProduct => ({
  product_id: "p1",
  title: "AGO 1023",
  thumbnail: null,
  status: "published",
  brand_slug: "ago",
  brand_name: "Ago",
  skus: [],
  base_cents: 15000,
  is_case: false,
  price_scope: "frame",
  first_seen_at: null,
  ...over,
});

describe("modelSkuOf (D1)", () => {
  it("prefers the colour whose SKU spells the model, wherever it sits in the list", () => {
    expect(modelSkuOf({ title: "AGO 1023", skus: ["AGO 1023-02-black-gold", "AGO 1023", "AGO 1023-03-navy-silver"] })).toBe("AGO 1023");
  });

  it("else the first SKU a cost row knows, else the shortest", () => {
    const rows = new Map<string, FrameCostRow>([["XY9", { sku: "XY9", model: "XY 9", book_cents: 0, cost_cents: 900, source: "supplier_list", updated_at: null, updated_by: null }]]);
    expect(modelSkuOf({ title: "Model Nine", skus: ["XY9-red", "XY9"] }, rows)).toBe("XY9");
    expect(modelSkuOf({ title: "Model Nine", skus: ["QQ1-long-colour", "QQ1-red"] })).toBe("QQ1-red");
    expect(modelSkuOf({ title: "Solo", skus: [] })).toBe("Solo");
  });

  it("the frame row carries that SKU and finds its cost", () => {
    const rows = new Map<string, FrameCostRow>([["AGO1023", { sku: "AGO1023", model: "AGO 1023", book_cents: 16900, cost_cents: 7495, source: "supplier_list", updated_at: null, updated_by: null }]]);
    const p = product({ skus: ["AGO 1023-02-black-gold", "AGO 1023"] });
    const [row] = buildFrameRows([p], stores, [], noDiscounts, new Map(), { rows, variations: new Map() });
    expect(row.sku).toBe("AGO 1023");
    expect(row.cost_cents).toBe(7495);
  });
});

describe("brandless cases (D2)", () => {
  it("go to ONE «Estuches» group, without the per-store brand switch", () => {
    const products = [product({ product_id: "c1", title: "CASE C-24", brand_slug: "", is_case: true, price_scope: "case" }), product({ product_id: "c2", title: "CASE QA", brand_slug: "case", is_case: true, price_scope: "case" })];
    const rows = buildFrameRows(products, stores, [], noDiscounts, new Map(), null);
    const groups = withBrandExposure(groupFrameRows(rows, products, new Map()), stores, new Map());
    expect(groups.map((g) => [g.key, g.label, g.rows.length])).toEqual([["case", CASES_LABEL, 2]]);
    expect(groups[0].stores).toBeUndefined();
  });

  it("a real brand group keeps its switch", () => {
    const products = [product({})];
    const rows = buildFrameRows(products, stores, [], noDiscounts, new Map(), null);
    const [g] = withBrandExposure(groupFrameRows(rows, products, new Map()), stores, new Map());
    expect(g.stores).toEqual({ [A]: { brand_rule: null, exposed_rows: 1 }, [B]: { brand_rule: null, exposed_rows: 1 } });
  });
});

describe("case price scope, matrix = till (D10)", () => {
  it("the catalogue's word makes it a case; a case rule counts only in the store that sees it", () => {
    expect(metadataSaysCase({ kind: "case" })).toBe(true);
    expect(metadataSaysCase({ brand_slug: "cases" })).toBe(true);
    expect(metadataSaysCase({ brand_slug: "di-caprio" })).toBe(false);
    const rules = [{ scope: "case", target: "p1", establishment_id: A }];
    expect(storePriceScope(rules, A, "p1", false)).toBe("case");
    expect(storePriceScope(rules, B, "p1", false)).toBe("frame");
    expect(storePriceScope([{ scope: "case", target: "p1", establishment_id: null }], B, "p1", false)).toBe("case");
    expect(storePriceScope([], B, "p1", true)).toBe("case");
  });

  it("a manual case priced only in Op1 shows its base (not the frame band) in Op2", () => {
    const raw = { product_id: "c9", title: "CASE QA-1", thumbnail: null, status: "published", skus: ["CASEQA1"], base_cents: 1000, metadata: { kind: "case", brand_slug: "case" } };
    const p = toMatrixProduct(raw, new Set(["c9"]));
    const rules = [{ id: "r1", establishment_id: A, scope: "case", target: "c9", mode: "override", value: 12, valid_from: "2026-01-01T00:00:00Z", valid_to: null }] as never;
    const [row] = buildFrameRows([p], stores, rules, noDiscounts, new Map(), null);
    expect(row.stores[A]).toMatchObject({ price_cents: 1200, source: "store_exact" });
    expect(row.stores[B]).toMatchObject({ price_cents: 1000, exact: false });
  });
});

describe("unpriced «tallado digital» cells (D6)", () => {
  const input = {
    designs: [{ code: "sv", label_es: "Visión sencilla", label_en: "Single vision", category: "sv" }],
    materials: [{ code: "poly", label_es: "Policarbonato", label_en: "Polycarbonate" }],
    cells: [{ design_code: "sv", material_code: "poly", finish: "stock" as const, price_cents: 9000, cost_cents: null }],
    storeRows: new Map(),
  };
  const off = (): MatrixRow => buildLensGroups(input, stores, noDiscounts, true)[0].rows.find((r) => r.available === false) as MatrixRow;
  const op = (field: string, value: unknown, store: string | null = A): CellOp => {
    const r = planCellWrite({ kind: "lens", key: "sv:poly:digital", field, store, value });
    if ("reason" in r) throw new Error(r.reason);
    return r.op;
  };
  const c = {} as never;

  it("typing a price creates the master digital cell (not a store price), audited", async () => {
    expect(await executeCellOp(c, op("price", 120), off(), "u")).toBeNull();
    expect(writeLensMaster).toHaveBeenCalledWith(c, "base", "sv:poly:digital", "price", 12000);
    expect(upsertStoreLensPrice).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(c, expect.objectContaining({ action: "price.change", entity: "lens_price", entityId: "base:sv:poly:digital" }));
  });

  it("clearing an unpriced cell writes nothing; a cost waits for the price", async () => {
    expect(await executeCellOp(c, op("price", null), off(), "u")).toBeNull();
    expect(await executeCellOp(c, op("cost", 40, null), off(), "u")).toBe("price_first");
    expect(writeLensMaster).not.toHaveBeenCalled();
  });

  it("a discount on it is an ordinary item discount (kept for when it is priced)", () => {
    const r = planCellWrite({ kind: "lens", key: "sv:poly:digital", field: "discount", store: A, value: 10 });
    expect(r).toEqual({ op: { op: "discount", kind: "lens", key: "sv:poly:digital", storeId: A, pct: 10 } });
  });
});

describe("discontinued models at the till (D5)", () => {
  it("only a published model is for sale; an unknown status (old reader) is not blocked", () => {
    expect(isDiscontinued("published")).toBe(false);
    expect(isDiscontinued("draft")).toBe(true);
    expect(isDiscontinued("proposed")).toBe(true);
    expect(isDiscontinued(undefined)).toBe(false);
    expect(isDiscontinued(null)).toBe(false);
  });
});

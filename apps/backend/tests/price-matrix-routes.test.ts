/**
 * «Productos y precios» (docs/PRICE-MATRIX.md): the routes' guards and the
 * HU-07 product payload, with every loader and writer stubbed — no database.
 *
 *   · writes are owner / superadmin only, a cost also needs «Gestionar costos»;
 *   · an import with errors is never applied;
 *   · the cell route answers the row without the cost for a reader without access;
 *   · a manual model is created like the scraper creates one, sells in every
 *     channel and is stamped `source: "manual"`;
 *   · the receipt says «Precio antes $X · Promoción −Y %».
 */

jest.mock("../src/lib/price-matrix-route", () => ({ matrixAccess: jest.fn() }));
jest.mock("../src/lib/gsheet-sync", () => ({
  ...jest.requireActual("../src/lib/gsheet-sync"),
  mirrorPricesToSheet: jest.fn(async () => undefined),
}));
jest.mock("../src/lib/price-matrix-data", () => ({
  planMatrixImport: jest.fn(),
  applyMatrixImport: jest.fn(),
  loadMatrixStores: jest.fn(),
  loadMatrixRow: jest.fn(),
  executeCellOp: jest.fn(),
  invalidatePriceCaches: jest.fn(),
  createCatalogFrame: jest.fn(),
  loadMatrixSection: jest.fn(),
}));

import { POST as importPost } from "../src/api/admin/pricing/matrix/import/route";
import { POST as cellPost } from "../src/api/admin/pricing/matrix/cell/route";
import { POST as framePost } from "../src/api/admin/catalog/frames/route";
import { GET as matrixGet } from "../src/api/admin/pricing/matrix/route";
import { matrixAccess } from "../src/lib/price-matrix-route";
import * as data from "../src/lib/price-matrix-data";
import { buildCatalogFrameProduct, catalogBasePrice, cleanCatalogFrame, handleOfSku, type CatalogFrameInput } from "../src/lib/catalog-frame";
import { docLinePromo, type SaleDocument } from "../src/lib/pos-documents";
import { renderReceiptEmail } from "../src/lib/email/pos-emails";
import { frameCostsSheetHeaders, frameCostsSheetRows } from "../src/lib/gsheet-sync";
import type { EstablishmentRow } from "../src/lib/establishments";

const access = matrixAccess as jest.MockedFunction<typeof matrixAccess>;
const mocked = data as jest.Mocked<typeof data>;

const ADMIN = { actorId: "user_owner", isAdmin: true, canSeeCosts: true, canManageCosts: true };
const MANAGER = { actorId: "user_mgr", isAdmin: false, canSeeCosts: true, canManageCosts: false };
const STORES = [{ id: "est_A", code: "Op1", name: "Katy", color: "#000" }];

function call(handler: (req: never, res: never) => Promise<void>, body: unknown, query: Record<string, unknown> = {}) {
  const out: { status: number; body: unknown } = { status: 200, body: null };
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(payload: unknown) {
      out.body = payload;
      return res;
    },
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const req = { body, scope: { resolve: () => logger }, auth_context: { actor_id: "u" }, query };
  return handler(req as never, res as never).then(() => out);
}

beforeEach(() => {
  jest.clearAllMocks();
  access.mockResolvedValue(ADMIN);
  mocked.loadMatrixStores.mockResolvedValue(STORES);
});

// ── Read ─────────────────────────────────────────────────────────────────────

describe("GET /admin/pricing/matrix", () => {
  const groups = [{ key: "di-caprio", label: "Di Caprio", kind: "brand", rows: [{ kind: "frame", key: "p1", title: "DC407", cost_cents: 1650, cost_source: "supplier_list", stores: {} }] }];

  it("loads the section with costs only for a cost viewer, and removes the keys otherwise", async () => {
    mocked.loadMatrixSection.mockResolvedValue({ stores: STORES, groups } as never);
    const full = await call(matrixGet as never, null, { section: "frames", q: "dc" });
    expect(mocked.loadMatrixSection).toHaveBeenLastCalledWith(expect.anything(), "frames", { q: "dc", withCosts: true });
    expect(full.body).toMatchObject({ section: "frames", cost_access: true, stores: STORES });
    access.mockResolvedValue({ ...ADMIN, canSeeCosts: false });
    const plain = await call(matrixGet as never, null, { section: "frames" });
    expect(mocked.loadMatrixSection).toHaveBeenLastCalledWith(expect.anything(), "frames", { q: "", withCosts: false });
    const row = (plain.body as { cost_access: boolean; groups: Array<{ rows: Array<Record<string, unknown>> }> }).groups[0].rows[0];
    expect((plain.body as { cost_access: boolean }).cost_access).toBe(false);
    expect("cost_cents" in row || "cost_source" in row).toBe(false);
  });

  it("refuses an unknown section", async () => {
    expect((await call(matrixGet as never, null, { section: "sunglasses" })).body).toMatchObject({ reason: "bad_section" });
  });
});

// ── Import ───────────────────────────────────────────────────────────────────

describe("POST /admin/pricing/matrix/import", () => {
  const plan = (errors: unknown[] = [], cost = 0) => ({
    stores: STORES,
    rows: new Map(),
    plan: { changes: [{ row: 0 }], errors, counts: { rows: 1, changes: 1, errors: errors.length, cost, price: 1, discount: 0, unchanged: 0 } },
  });

  it("previews without writing", async () => {
    mocked.planMatrixImport.mockResolvedValue(plan() as never);
    const out = await call(importPost as never, { apply: false, rows: [{}] });
    expect(out.status).toBe(200);
    expect(out.body).toHaveProperty("plan");
    expect(mocked.applyMatrixImport).not.toHaveBeenCalled();
  });

  it("refuses to apply a plan with errors", async () => {
    mocked.planMatrixImport.mockResolvedValue(plan([{ row: 0, reason: "unknown_item", detail: "X" }]) as never);
    const out = await call(importPost as never, { apply: true, rows: [{}] });
    expect(out.status).toBe(422);
    expect(out.body).toMatchObject({ reason: "import_has_errors" });
    expect(mocked.applyMatrixImport).not.toHaveBeenCalled();
  });

  it("applies a clean plan", async () => {
    mocked.planMatrixImport.mockResolvedValue(plan() as never);
    mocked.applyMatrixImport.mockResolvedValue({ applied: 1, failed: [] });
    const out = await call(importPost as never, { apply: true, rows: [{}] });
    expect(out.body).toEqual({ applied: 1, failed: [] });
  });

  it("is owner / superadmin only, and a cost needs «Gestionar costos»", async () => {
    access.mockResolvedValue(MANAGER);
    expect((await call(importPost as never, { rows: [] })).body).toMatchObject({ reason: "forbidden_role" });
    access.mockResolvedValue({ ...ADMIN, canManageCosts: false });
    mocked.planMatrixImport.mockResolvedValue(plan([], 1) as never);
    expect((await call(importPost as never, { rows: [{}] })).status).toBe(403);
  });

  it("wants a list of rows", async () => {
    expect((await call(importPost as never, { rows: "x" })).body).toMatchObject({ reason: "bad_rows" });
  });
});

// ── One cell ─────────────────────────────────────────────────────────────────

describe("POST /admin/pricing/matrix/cell", () => {
  const row = { kind: "frame", key: "prod_1", title: "DC407", sku: "DC407", cost_cents: 1650, cost_source: "supplier_list", stores: {} };

  it("writes through the planned op and answers the fresh row", async () => {
    mocked.loadMatrixRow.mockResolvedValue(row as never);
    mocked.executeCellOp.mockResolvedValue(null);
    const out = await call(cellPost as never, { kind: "frame", key: "prod_1", field: "discount", store: "est_A", value: 10 });
    expect(out.status).toBe(200);
    expect(mocked.executeCellOp.mock.calls[0][1]).toEqual({ op: "discount", kind: "frame", key: "prod_1", storeId: "est_A", pct: 10 });
    expect(mocked.invalidatePriceCaches).toHaveBeenCalled();
    expect(out.body).toEqual({ row });
  });

  it("omits the cost from the answer for a reader without cost access", async () => {
    access.mockResolvedValue({ ...ADMIN, canSeeCosts: false });
    mocked.loadMatrixRow.mockResolvedValue(row as never);
    mocked.executeCellOp.mockResolvedValue(null);
    const out = await call(cellPost as never, { kind: "frame", key: "prod_1", field: "price", store: "est_A", value: 50 });
    const answered = (out.body as { row: Record<string, unknown> }).row;
    expect("cost_cents" in answered).toBe(false);
    expect("cost_source" in answered).toBe(false);
  });

  it("answers the contract's reasons", async () => {
    access.mockResolvedValue(MANAGER);
    expect((await call(cellPost as never, { kind: "frame", key: "p", field: "price", store: "est_A", value: 1 })).body).toMatchObject({ reason: "forbidden_role" });
    access.mockResolvedValue({ ...ADMIN, canManageCosts: false });
    expect((await call(cellPost as never, { kind: "frame", key: "p", field: "cost", value: 1 })).body).toMatchObject({ reason: "forbidden_role" });
    access.mockResolvedValue(ADMIN);
    expect((await call(cellPost as never, { kind: "frame", key: "p", field: "price", value: 1 })).body).toMatchObject({ reason: "store_required" });
    expect((await call(cellPost as never, { kind: "frame", key: "p", field: "price", store: "est_Z", value: 1 })).body).toMatchObject({ reason: "store_not_found" });
    mocked.loadMatrixRow.mockResolvedValue(null);
    expect((await call(cellPost as never, { kind: "frame", key: "p", field: "price", store: "est_A", value: 1 })).body).toMatchObject({ reason: "unknown_item" });
    mocked.loadMatrixRow.mockResolvedValue(row as never);
    mocked.executeCellOp.mockRejectedValue(new Error("db down"));
    expect((await call(cellPost as never, { kind: "frame", key: "p", field: "price", store: "est_A", value: 1 })).body).toMatchObject({ reason: "save_failed" });
  });
});

// ── HU-07: a model added by hand ─────────────────────────────────────────────

describe("the manual model's product", () => {
  const body = {
    kind: "frame",
    brand: "Di Caprio",
    sku: "DC 999",
    colors: [{ name: "Black", image: "https://cdn/b.jpg" }, { name: "Tortoise Brown" }],
    eye_size: 52,
    bridge_size: 18,
    temple_length: 140,
    cost: 16.5,
    prices: { est_A: { price: 60, discount: 10 } },
  };
  const clean = (b: Record<string, unknown>) => {
    const r = cleanCatalogFrame(b);
    if ("reason" in r) throw new Error(r.reason);
    return r.frame;
  };

  it("is created the way the scraper creates one", () => {
    const frame = clean(body);
    expect(frame).toMatchObject({ brand_slug: "di-caprio", model: "DC 999", cost_cents: 1650, prices: { est_A: { price_cents: 6000, discount_pct: 10 } } });
    const p = buildCatalogFrameProduct(frame, { channelIds: ["sc_default", "sc_A", "sc_A", ""], now: new Date("2026-11-06T10:00:00Z"), actorId: "user_owner" });
    expect(p["handle"]).toBe("dc-999");
    expect(p["status"]).toBe("published");
    expect(p["options"]).toEqual([{ title: "Color", values: ["Black", "Tortoise Brown"] }]);
    expect((p["variants"] as Array<Record<string, unknown>>).map((v) => [v["sku"], v["manage_inventory"], v["prices"]])).toEqual([
      ["DC 999", false, [{ currency_code: "usd", amount: 34 }]], // sellingPrice(16.50): ceil 17 × 2
      ["DC 999-tortoise-brown", false, [{ currency_code: "usd", amount: 34 }]],
    ]);
    expect(p["thumbnail"]).toBe("https://cdn/b.jpg");
    expect(p["sales_channels"]).toEqual([{ id: "sc_default" }, { id: "sc_A" }]);
    expect(p["metadata"]).toMatchObject({
      brand: "Di Caprio",
      brand_slug: "di-caprio",
      collection_slug: "di-caprio",
      kind: "frame",
      eye_size: 52,
      bridge_size: 18,
      temple_length: 140,
      source: "manual",
      first_seen_at: "2026-11-06T10:00:00.000Z",
    });
  });

  it("handles, brands, default colour and base price", () => {
    expect(handleOfSku("CASE C-26")).toBe("case-c-26");
    expect(clean({ ...body, brand: "Óptica Nueva", brand_slug: undefined }).brand_slug).toBe("optica-nueva");
    expect(clean({ ...body, colors: [] }).colors).toEqual([{ name: "Default", image: null }]);
    const caseFrame = clean({ kind: "case", sku: "CASE X1", cost: 0.98 });
    expect([caseFrame.brand_slug, caseFrame.brand]).toEqual(["case", "Cases (estuches)"]);
    expect(catalogBasePrice(caseFrame)).toBe(5); // ceil 1 × 5
    const noCost = { kind: "frame", cost_cents: null, prices: { a: { price_cents: 4500, discount_pct: null }, b: { price_cents: 5000, discount_pct: null } } } as Pick<CatalogFrameInput, "kind" | "cost_cents" | "prices">;
    expect(catalogBasePrice(noCost)).toBe(50);
  });

  it("answers the contract's reasons", () => {
    const reason = (b: Record<string, unknown>) => (cleanCatalogFrame(b) as { reason?: string }).reason;
    expect(reason({ ...body, kind: "lens" })).toBe("bad_kind");
    expect(reason({ ...body, brand: "" })).toBe("bad_brand");
    expect(reason({ ...body, brand_slug: "Bad Slug" })).toBe("bad_brand");
    expect(reason({ ...body, sku: "" })).toBe("bad_sku");
    expect(reason({ ...body, sku: "---" })).toBe("bad_sku");
    expect(reason({ ...body, colors: [{ name: "Black" }, { name: "black" }] })).toBe("bad_colors");
    expect(reason({ ...body, colors: [{ name: "Black", image: "not a url" }] })).toBe("bad_colors");
    expect(reason({ ...body, colors: "Black" })).toBe("bad_colors");
    expect(reason({ ...body, eye_size: 200 })).toBe("bad_measure");
    expect(reason({ ...body, cost: -1 })).toBe("bad_value");
    expect(reason({ ...body, cost: null, prices: {} })).toBe("bad_value");
    expect(reason({ ...body, prices: { est_A: { discount: 95 } } })).toBe("discount_range");
  });

  it("the route refuses an unknown store and a taken SKU", async () => {
    expect((await call(framePost as never, { ...body, prices: { est_Z: { price: 1 } } })).body).toMatchObject({ reason: "store_not_found" });
    mocked.createCatalogFrame.mockResolvedValue({ reason: "sku_taken" });
    const taken = await call(framePost as never, body);
    expect([taken.status, (taken.body as { reason: string }).reason]).toEqual([409, "sku_taken"]);
    access.mockResolvedValue(MANAGER);
    expect((await call(framePost as never, body)).body).toMatchObject({ reason: "forbidden_role" });
  });

  it("the route answers 201 with the product and its matrix row", async () => {
    mocked.createCatalogFrame.mockResolvedValue({ product_id: "prod_new" });
    mocked.loadMatrixRow.mockResolvedValue({ kind: "frame", key: "prod_new", title: "DC 999", stores: {} } as never);
    const out = await call(framePost as never, body);
    expect(out.status).toBe(201);
    expect(out.body).toMatchObject({ product_id: "prod_new", handle: "dc-999", row: { key: "prod_new" } });
  });
});

// ── Receipts ─────────────────────────────────────────────────────────────────

describe("the promotion on the receipt", () => {
  it("documents carry the price before and the line's effective %", () => {
    expect(docLinePromo({ frame_pct: 10, lens_pct: null, photo_pct: null, ar_pct: null, before_cents: 6000 }, 54)).toEqual({
      before: 60,
      pct: 10,
      frame_pct: 10,
      lens_pct: null,
      photo_pct: null,
      ar_pct: null,
    });
    expect(docLinePromo(null, 54)).toBeNull();
    expect(docLinePromo({ before_cents: 5400 }, 54)).toBeNull(); // nothing taken off
  });

  it("the e-mail prints «Precio antes $X · Promoción −Y %», simple receipt included", () => {
    const doc = {
      kind: "receipt",
      business: { name: "RUBI LENS", legal_name: "RUBI", url: "https://x", support_email: null, timezone: "America/Chicago" },
      store: { code: "Op1", name: "Katy", address: null, phone: null, receipt_note: null },
      terminal: { code: "Op1-POS1", receipt_locale: "es", ticket_locale: "en" },
      sale: { id: "s1", number: "Op1-000001", created_at: "2026-11-06T15:00:00Z", updated_at: "2026-11-06T15:00:00Z", promised_on: null, seller_code: null, tray: null, status: "completed", voided_at: null, delivery: "pickup" },
      customer: { name: "" },
      tracking_url: "https://x/my-orders",
      print: { count: 0, reprint: false, first_at: null },
      lines: [
        { kind: "frame", title: "DC407", variant_title: null, sku: "DC407", list: 54, unit_price: 54, tax_amount: 0, frame_price: 54, lens_price: 0, design_code: "frame-only", lens: null, handling: null, frame: null, own_frame: null, prescription_id: null, promo: { before: 60, pct: 10, frame_pct: 10, lens_pct: null, photo_pct: null, ar_pct: null } },
      ],
      totals: { list: 54, discount: 0, discount_pct: 0, tax: 0, total: 54, paid: 54, insurance: 0, balance: 0 },
      payments: [],
    } as unknown as SaleDocument;
    const es = renderReceiptEmail(doc, "es");
    expect(es.text).toContain("Precio antes $60.00 · Promoción −10 %");
    expect(es.html).toContain("Precio antes $60.00 · Promoción −10 %");
    expect(renderReceiptEmail(doc, "en").text).toContain("Price before $60.00 · Promotion −10%");
  });
});

// ── The sheet ────────────────────────────────────────────────────────────────

describe("«Costos monturas» with each store's price and discount", () => {
  const stores = [
    { id: "est_A", code: "Op1", name: "Katy", is_active: true },
    { id: "est_B", code: "Op2", name: "Rancho", is_active: true },
  ] as unknown as EstablishmentRow[];
  const catalog = [{ product_id: "p1", sku: "DC406", title: "DC406", brand_slug: "di-caprio", is_case: false, price_cents: 9900 }];

  it("adds Precio and Desc % per store after the cost columns, only when asked", () => {
    expect(frameCostsSheetHeaders(stores, true).slice(-6)).toEqual(["Costo Op1", "Costo Op2", "Precio Op1", "Desc % Op1", "Precio Op2", "Desc % Op2"]);
    expect(frameCostsSheetHeaders(stores)).toHaveLength(11);
    const prices = new Map([["p1", new Map([["est_A", { price_cents: 9000, discount_pct: 10 }], ["est_B", { price_cents: 9900, discount_pct: null }]])]]);
    const rows = frameCostsSheetRows([], catalog, stores, new Map(), prices);
    expect(rows[3]).toEqual(frameCostsSheetHeaders(stores, true));
    expect(rows[4].slice(-4)).toEqual([90, 10, 99, ""]);
  });
});

/**
 * «Productos y precios» v2 (docs/PRICE-MATRIX.md, 7-nov-2026): the till quote
 * with a brand price and a brand discount, the brand cell writer, and the new
 * routes' guards and reasons — every loader and writer stubbed, no database.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

jest.mock("../src/lib/lens-quote", () => ({ ...jest.requireActual("../src/lib/lens-quote"), computeLensBreakdown: jest.fn() }));
jest.mock("../src/lib/store-pricing-data", () => ({
  ...jest.requireActual("../src/lib/store-pricing-data"),
  openRules: jest.fn(async () => []),
  productPrices: jest.fn(async () => []),
  replaceRule: jest.fn(async () => undefined),
}));
jest.mock("../src/lib/store-settings", () => ({ resolveStoreSettings: jest.fn(async () => ({ frame_tax_rate: 0 })) }));
jest.mock("../src/lib/frame-specs", () => ({
  loadProductMetadata: jest.fn(async () => new Map()),
  frameBrand: jest.fn(() => null),
  posFrameSpecs: jest.fn(() => ({})),
}));
jest.mock("../src/lib/store-assortment-data", () => ({ listAssortmentRules: jest.fn(async () => []) }));
jest.mock("../src/lib/audit", () => ({ ...jest.requireActual("../src/lib/audit"), recordAudit: jest.fn(async () => undefined) }));
jest.mock("../src/lib/price-matrix-route", () => ({ matrixAccess: jest.fn() }));
jest.mock("../src/lib/gsheet-sync", () => ({ mirrorPricesToSheet: jest.fn(async () => undefined) }));
jest.mock("../src/lib/catalog-brand-data", () => ({
  ...jest.requireActual("../src/lib/catalog-brand-data"),
  createBrand: jest.fn(),
  updateBrand: jest.fn(),
  deleteBrand: jest.fn(),
  listBrands: jest.fn(async () => []),
}));
jest.mock("../src/lib/catalog-frame-data", () => ({ updateCatalogFrame: jest.fn(), deleteCatalogFrame: jest.fn() }));
jest.mock("../src/lib/treatment-data", () => ({ findTreatment: jest.fn(), updateTreatment: jest.fn(), deleteTreatment: jest.fn() }));

import { computeLensBreakdown } from "../src/lib/lens-quote";
import { openRules, productPrices, replaceRule } from "../src/lib/store-pricing-data";
import { loadProductMetadata } from "../src/lib/frame-specs";
import { quoteSale } from "../src/lib/pos-data";
import { executeCellOp } from "../src/lib/price-matrix-data";
import { planCellWrite, type CellOp } from "../src/lib/price-matrix";
import { brandTarget, type PriceRuleLike } from "../src/lib/store-pricing";
import { STORE_PRICING_MODULE } from "../src/modules/store-pricing";
import { matrixAccess } from "../src/lib/price-matrix-route";
import { createBrand, deleteBrand, updateBrand } from "../src/lib/catalog-brand-data";
import { deleteCatalogFrame, updateCatalogFrame } from "../src/lib/catalog-frame-data";
import { deleteTreatment, findTreatment, updateTreatment } from "../src/lib/treatment-data";
import { POST as brandsPost } from "../src/api/admin/catalog/brands/route";
import { DELETE as brandDelete, POST as brandPost } from "../src/api/admin/catalog/brands/[slug]/route";
import { DELETE as frameDelete, POST as framePatch } from "../src/api/admin/catalog/frames/[id]/route";
import { DELETE as treatmentDelete, POST as treatmentPatch } from "../src/api/admin/pricing/treatments/[code]/route";
import { POST as uploadPost } from "../src/api/admin/catalog/uploads/route";

const breakdown = computeLensBreakdown as jest.MockedFunction<typeof computeLensBreakdown>;
const access = matrixAccess as jest.MockedFunction<typeof matrixAccess>;
const ADMIN = { actorId: "user_owner", isAdmin: true, canSeeCosts: true, canManageCosts: true };
const MANAGER = { actorId: "user_mgr", isAdmin: false, canSeeCosts: true, canManageCosts: false };
const A = "est_A";

/** Store-pricing service with `store_item_discount` rows in memory (the till reads discounts through it). */
function pricingSvc(rows: Array<Record<string, unknown>> = []) {
  let n = 0;
  return {
    rows,
    listStoreItemDiscounts: jest.fn(async (f: Record<string, unknown>) =>
      rows.filter((r) => !r["deleted_at"] && Object.entries(f).every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v)))
    ),
    createStoreItemDiscounts: jest.fn(async (d: Record<string, unknown>) => rows.push({ id: `sidc_${++n}`, ...d })),
    updateStoreItemDiscounts: jest.fn(async () => undefined),
    softDeleteStoreItemDiscounts: jest.fn(async () => undefined),
  };
}

function container(svc = pricingSvc(), graph = jest.fn(async () => ({ data: [] as unknown[] }))) {
  const registry: Record<string, unknown> = {
    [ContainerRegistrationKeys.PG_CONNECTION]: {},
    [ContainerRegistrationKeys.QUERY]: { graph },
    [ContainerRegistrationKeys.LOGGER]: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    [STORE_PRICING_MODULE]: svc,
  };
  return { resolve: (key: string) => registry[key] } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  access.mockResolvedValue(ADMIN);
});

// ── The till ─────────────────────────────────────────────────────────────────

describe("quoteSale: the brand price and the brand discount at the till", () => {
  const t0 = new Date("2026-01-01T00:00:00Z");
  const rule = (over: Partial<PriceRuleLike>): PriceRuleLike => ({ establishment_id: A, scope: "frame", target: null, mode: "override", value: 0, valid_from: t0, valid_to: null, ...over });
  const graph = jest.fn(async () => ({ data: [{ id: "var_1", title: "Grey", sku: "dc-50-di-caprio-grey", product: { id: "prod_1", title: "DC 50", status: "published" } }] }));
  const frameLine = { kind: "frame" as const, variant_id: "var_1", selection: { design_code: "frame-only", material_code: null, photo_code: null, ar_code: null, finish: null }, description: null, photo: null };

  beforeEach(() => {
    breakdown.mockResolvedValue({ lens_base_cents: 0, photo_cents: 0, ar_cents: 0, total_cents: 0, category: null, requires_add: false, finish: null, cost_cents: null } as never);
    (productPrices as jest.Mock).mockResolvedValue([{ product_id: "prod_1", price: 60 }]);
    (loadProductMetadata as jest.Mock).mockResolvedValue(new Map([["prod_1", { brand_slug: "di-caprio" }]]));
  });

  it("charges the store's brand price with the brand's discount (the product's brand slug is passed)", async () => {
    (openRules as jest.Mock).mockResolvedValue([rule({ target: brandTarget("di-caprio"), value: 45 })]);
    const svc = pricingSvc([{ id: "d1", establishment_id: A, item_kind: "brand", item_key: "di-caprio", pct: 10 }]);
    const q = await quoteSale(container(svc, graph), A, [frameLine as never]);
    expect(q.lines[0]).toMatchObject({ frame: 40.5, list: 40.5, frame_source: "brand", promo: { frame_pct: 10, before_cents: 4500 } });
    expect(q.total_cents).toBe(4050);
  });

  it("the model's exact price beats the brand's; the model's discount beats the brand's", async () => {
    (openRules as jest.Mock).mockResolvedValue([rule({ target: brandTarget("di-caprio"), value: 45 }), rule({ target: "prod_1", value: 50 })]);
    const svc = pricingSvc([
      { id: "d1", establishment_id: A, item_kind: "brand", item_key: "di-caprio", pct: 10 },
      { id: "d2", establishment_id: A, item_kind: "frame", item_key: "prod_1", pct: 20 },
    ]);
    const q = await quoteSale(container(svc, graph), A, [frameLine as never]);
    expect(q.lines[0]).toMatchObject({ frame: 40, frame_source: "store_exact", promo: { frame_pct: 20, before_cents: 5000 } });
  });

  it("another store's brand price does not apply; without one the base is charged", async () => {
    (openRules as jest.Mock).mockResolvedValue([rule({ establishment_id: "est_B", target: brandTarget("di-caprio"), value: 45 })]);
    const q = await quoteSale(container(pricingSvc(), graph), A, [frameLine as never]);
    expect(q.lines[0]).toMatchObject({ frame: 60, frame_source: "adjusted", promo: null });
  });
});

// ── The brand cell writer ────────────────────────────────────────────────────

describe("executeCellOp for kind «brand»", () => {
  const op = (input: Parameters<typeof planCellWrite>[0]): CellOp => {
    const r = planCellWrite(input);
    if ("reason" in r) throw new Error(r.reason);
    return r.op;
  };

  it("a brand price is a store_price_rule on brand:<slug> (closing the open one); clearing removes it", async () => {
    const c = container();
    expect(await executeCellOp(c, op({ kind: "brand", key: "di-caprio", field: "price", store: A, value: 45 }), null, "u")).toBeNull();
    expect(replaceRule).toHaveBeenCalledWith(c, { establishmentId: A, scope: "frame", target: "brand:di-caprio", family: "price" }, { mode: "override", value: 45, source: "price-matrix-brand" }, "u");
    await executeCellOp(c, op({ kind: "brand", key: "case", field: "price", store: A, value: null }), null, "u");
    expect(replaceRule).toHaveBeenLastCalledWith(c, { establishmentId: A, scope: "case", target: "brand:case", family: "price" }, null, "u");
  });

  it("a brand discount is a store_item_discount of kind brand", async () => {
    const svc = pricingSvc();
    const c = container(svc);
    await executeCellOp(c, op({ kind: "brand", key: "di-caprio", field: "discount", store: A, value: 10 }), null, "u");
    expect(svc.rows).toEqual([expect.objectContaining({ establishment_id: A, item_kind: "brand", item_key: "di-caprio", pct: 10 })]);
  });

  it("an article op without its row is unknown_item", async () => {
    expect(await executeCellOp(container(), op({ kind: "frame", key: "prod_1", field: "discount", store: A, value: 5 }), null, "u")).toBe("unknown_item");
  });
});

// ── Routes ───────────────────────────────────────────────────────────────────

function call(handler: (req: never, res: never) => Promise<void>, body: unknown, params: Record<string, string> = {}, query: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
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
  const services: Record<string, unknown> = { [ContainerRegistrationKeys.LOGGER]: logger, ...((extra["services"] as Record<string, unknown>) ?? {}) };
  const req = { body, params, query, scope: { resolve: (k: string) => services[k] ?? logger }, auth_context: { actor_id: "u" }, ...extra };
  return handler(req as never, res as never).then(() => out);
}

describe("brand routes", () => {
  it("POST /admin/catalog/brands: owner only, validated, 409 brand_taken", async () => {
    access.mockResolvedValue(MANAGER);
    expect((await call(brandsPost as never, { name: "X" })).status).toBe(403);
    access.mockResolvedValue(ADMIN);
    expect((await call(brandsPost as never, { name: "" })).body).toMatchObject({ reason: "bad_name" });
    (createBrand as jest.Mock).mockResolvedValueOnce({ reason: "brand_taken" });
    expect((await call(brandsPost as never, { name: "Di Caprio" })).status).toBe(409);
    (createBrand as jest.Mock).mockResolvedValueOnce({ brand: { slug: "nueva", name: "Nueva" } });
    const ok = await call(brandsPost as never, { name: "Nueva", kind: "frame", logo_url: "/brands/logo-x.png" });
    expect([ok.status, ok.body]).toEqual([201, { brand: { slug: "nueva", name: "Nueva" } }]);
    expect((createBrand as jest.Mock).mock.calls[1][1]).toMatchObject({ slug: "nueva", kind: "frame", logo_url: "/brands/logo-x.png" });
  });

  it("POST /admin/catalog/brands/:slug and DELETE: 404 / 409 brand_has_models / ok", async () => {
    (updateBrand as jest.Mock).mockResolvedValueOnce({ reason: "brand_not_found" });
    expect((await call(brandPost as never, { name: "Y" }, { slug: "nope" })).status).toBe(404);
    (updateBrand as jest.Mock).mockResolvedValueOnce({ brand: { slug: "di-caprio", name: "Y" } });
    expect((await call(brandPost as never, { name: "Y" }, { slug: "Di-Caprio" })).body).toEqual({ brand: { slug: "di-caprio", name: "Y" } });
    expect((updateBrand as jest.Mock).mock.calls[1][1]).toBe("di-caprio");
    expect((await call(brandPost as never, {}, { slug: "x" })).body).toMatchObject({ reason: "nothing_to_change" });
    (deleteBrand as jest.Mock).mockResolvedValueOnce({ reason: "brand_has_models", models: 3 });
    const busy = await call(brandDelete as never, null, { slug: "di-caprio" });
    expect([busy.status, busy.body]).toEqual([409, expect.objectContaining({ reason: "brand_has_models", models: 3 })]);
    (deleteBrand as jest.Mock).mockResolvedValueOnce({ deleted: true });
    expect((await call(brandDelete as never, null, { slug: "vieja" })).body).toEqual({ deleted: true });
  });
});

describe("model routes", () => {
  it("POST /admin/catalog/frames/:id refuses to remove a sold colour (409 variant_sold) and validates", async () => {
    (updateCatalogFrame as jest.Mock).mockResolvedValueOnce({ reason: "variant_sold", variant_ids: ["var_1"] });
    const sold = await call(framePatch as never, { colors: [{ variant_id: "var_2", name: "Grey" }] }, { id: "prod_1" });
    expect([sold.status, sold.body]).toEqual([409, expect.objectContaining({ reason: "variant_sold", variant_ids: ["var_1"] })]);
    expect((await call(framePatch as never, { status: "gone" }, { id: "prod_1" })).body).toMatchObject({ reason: "bad_status" });
    (updateCatalogFrame as jest.Mock).mockResolvedValueOnce({ reason: "product_not_found" });
    expect((await call(framePatch as never, { model: "X" }, { id: "nope" })).status).toBe(404);
    access.mockResolvedValue(MANAGER);
    expect((await call(framePatch as never, { model: "X" }, { id: "prod_1" })).status).toBe(403);
  });

  it("DELETE /admin/catalog/frames/:id answers deleted or archived", async () => {
    (deleteCatalogFrame as jest.Mock).mockResolvedValueOnce({ archived: true });
    expect((await call(frameDelete as never, null, { id: "prod_1" })).body).toEqual({ archived: true });
    (deleteCatalogFrame as jest.Mock).mockResolvedValueOnce({ deleted: true });
    expect((await call(frameDelete as never, null, { id: "prod_2" })).body).toEqual({ deleted: true });
    (deleteCatalogFrame as jest.Mock).mockResolvedValueOnce({ reason: "product_not_found" });
    expect((await call(frameDelete as never, null, { id: "x" })).status).toBe(404);
  });
});

describe("treatment routes", () => {
  it("POST /:code edits through the found type; 404 when unknown; cost needs «Gestionar costos»", async () => {
    (findTreatment as jest.Mock).mockResolvedValueOnce(null);
    expect((await call(treatmentPatch as never, { label_es: "X" }, { code: "nope" })).status).toBe(404);
    access.mockResolvedValue({ ...ADMIN, canManageCosts: false });
    expect((await call(treatmentPatch as never, { cost: 3 }, { code: "ar-green" })).status).toBe(403);
    access.mockResolvedValue(ADMIN);
    (findTreatment as jest.Mock).mockResolvedValueOnce({ type: "photo", row: {} });
    expect((await call(treatmentPatch as never, { ar_group: "sv" }, { code: "photo-grey" })).body).toMatchObject({ reason: "bad_value" });
    expect((await call(treatmentPatch as never, { type: "lens" }, { code: "photo-grey" })).body).toMatchObject({ reason: "bad_type" });
  });

  it("DELETE /:code answers deleted or archived (is_active false)", async () => {
    (deleteTreatment as jest.Mock).mockResolvedValueOnce({ archived: true, type: "ar" });
    expect((await call(treatmentDelete as never, null, { code: "ar-green" })).body).toEqual({ archived: true, type: "ar" });
    (deleteTreatment as jest.Mock).mockResolvedValueOnce({ deleted: true, type: "photo" });
    expect((await call(treatmentDelete as never, null, { code: "photo-x" }, { type: "photo" })).body).toEqual({ deleted: true, type: "photo" });
    expect((deleteTreatment as jest.Mock).mock.calls[1][1]).toEqual({ code: "photo-x", type: "photo" });
    expect((await call(treatmentDelete as never, null, { code: "x" }, { type: "lens" })).body).toMatchObject({ reason: "bad_type" });
    expect(updateTreatment).not.toHaveBeenCalled();
  });
});

describe("POST /admin/catalog/uploads", () => {
  it("owner only, wants a file, stores it public through the file module and answers an absolute url", async () => {
    access.mockResolvedValue(MANAGER);
    expect((await call(uploadPost as never, null)).status).toBe(403);
    access.mockResolvedValue(ADMIN);
    expect((await call(uploadPost as never, null)).body).toMatchObject({ reason: "file_required" });
    const createFiles = jest.fn(async () => [{ id: "f", url: "catalog/1-logo.png" }]);
    const file = { originalname: "Logo.png", mimetype: "image/png", size: 3, buffer: Buffer.from("abc") };
    const out = await call(uploadPost as never, null, {}, {}, { file, services: { file: { createFiles } } });
    expect(out.status).toBe(201);
    expect((out.body as { url: string }).url).toMatch(/^https:\/\/.+\/catalog\/1-logo\.png$/);
    expect(createFiles).toHaveBeenCalledWith([expect.objectContaining({ mimeType: "image/png", access: "public", filename: expect.stringMatching(/^catalog\/\d+-logo\.png$/) })]);
  });
});

/**
 * «Productos y precios» v2 (docs/PRICE-MATRIX.md, 7-nov-2026) — the pure parts:
 *
 *   · costs are found by MODEL first (staging's SKUs are `dc-50-di-caprio-grey`
 *     and every model read «falta»), then by SKU, then by UPC;
 *   · the 2026 list beats the previous one, which beats nothing (never 0), and
 *     an owner's edit beats both wherever it was saved;
 *   · images come back as absolute URLs;
 *   · a store's BRAND price and BRAND discount, with the precedence
 *     model exact > brand > store adjustment > band > master;
 *   · the brand registry, the «Marcas» import rows, editing a model's colours,
 *     editing a treatment.
 */
import { computeCostSheet } from "../src/lib/costing";
import {
  catalogSellingPrices,
  clearFrameCostCache,
  costRefOf,
  frameCostCandidates,
  frameCostCents,
  frameCostKeyFor,
  frameCostRowFrom,
  indexCatalogAliases,
  resolveFrameCost,
  setFrameCostCache,
  summarizeFrameCosts,
  supplierListRow,
  upcsOf,
  type CatalogModel,
  type FrameCostRow,
} from "../src/lib/frame-cost";
import { absoluteImageUrl, absoluteImageUrls, catalogUploadKey, publicAssetBase, DEFAULT_ASSET_BASE } from "../src/lib/image-url";
import { brandOfTarget, brandPriceRule, brandTarget, storeLinePrice, type PriceRuleLike } from "../src/lib/store-pricing";
import {
  brandStoreCell,
  buildFrameRows,
  buildImportPlan,
  changeAsCellWrite,
  cleanTreatmentPatch,
  groupFrameRows,
  indexImportBrands,
  indexItemDiscounts,
  frameEditCellWrites,
  linePromoPcts,
  photoPricesAfter,
  planCellWrite,
  productDiscountOf,
  promoStoreLine,
  rulesByTarget,
  storeFramePrice,
  storeSheetPrices,
  toMatrixProduct,
  withBrandExposure,
  type ImportBrand,
  type MatrixProduct,
  type MatrixStore,
} from "../src/lib/price-matrix";
import { CAPRI_PREV_BY_KEY, CAPRI_PREV_PRICE_LIST, capriPrevCostCents } from "../src/modules/store-pricing/capri-price-list-prev";
import { CAPRI_BY_KEY } from "../src/modules/store-pricing/capri-price-list-2026";
import { frameCostSeedStatements, prevFrameCostSeedRows } from "../src/modules/store-pricing/frame-cost-seed";
import { catalogBrandSeedStatements } from "../src/modules/store-pricing/catalog-brand-seed";
import {
  BRAND_LOGO_FILES,
  capriLogoOf,
  cleanBrandPatch,
  cleanLogo,
  cleanNewBrand,
  DEFAULT_BRAND_SORT,
  derivedBrandRow,
  mergeBrands,
  type BrandRow,
} from "../src/lib/catalog-brand";
import { cleanCatalogFrame, cleanCatalogFramePatch, buildCatalogFrameProduct, galleryAfterEdit, planColorEdit } from "../src/lib/catalog-frame";

const row = (over: Partial<FrameCostRow> = {}): FrameCostRow => ({
  sku: "DC50",
  model: "DC 50",
  book_cents: 7999,
  cost_cents: 1699,
  source: "supplier_list",
  updated_at: null,
  updated_by: null,
  ...over,
});
const mapOf = (rows: FrameCostRow[]) => new Map(rows.map((r) => [r.sku, r]));
const NONE = new Map<string, FrameCostRow>();

afterEach(() => clearFrameCostCache());

// ── 1. Which supplier key a model is ─────────────────────────────────────────

describe("frameCostCandidates: model first, then SKU, then the scraper's slug, then UPC", () => {
  it("DC 50 → DC50, and the staging SKU dc-50-di-caprio-grey cut at word boundaries", () => {
    expect(frameCostCandidates({ model: "DC 50" })[0]).toBe("DC50");
    const fromSlug = frameCostCandidates("dc-50-di-caprio-grey");
    expect(fromSlug[0]).toBe("DC50DICAPRIOGREY");
    expect(fromSlug).toContain("DC50");
    // Whole words only: never DC501 from dc-50-…
    expect(fromSlug.every((k) => k === "DC50DICAPRIOGREY" || "DC50DICAPRIOGREY".startsWith(k))).toBe(true);
    expect(fromSlug.indexOf("DC50DICAPRIO")).toBeLessThan(fromSlug.indexOf("DC50"));
  });

  it("the model is tried before every SKU, and the UPC last", () => {
    const keys = frameCostCandidates({ model: "FX 121", skus: ["fx-121-flexure-black"], upcs: ["889652001234"] });
    expect(keys[0]).toBe("FX121");
    expect(keys[keys.length - 1]).toBe("889652001234");
  });

  it("YC-prefixed, CASE C-26, «FX 121», Grande / SimplyLite names", () => {
    expect(frameCostCandidates({ model: "YC21102" })).toEqual(expect.arrayContaining(["YC21102", "21102"]));
    expect(frameCostCandidates({ model: "CASE C-26" })[0]).toBe("CASEC26");
    expect(frameCostCandidates({ model: "«FX 121»" })[0]).toBe("FX121");
    expect(frameCostCandidates({ model: "Grande GR 801" })).toContain("GR801");
    expect(frameCostCandidates({ model: "SimplyLite SL101" })).toContain("SL101");
    expect(frameCostCandidates({ model: "Simply Lite SL 101" })).toContain("SL101");
    expect(frameCostCandidates({ model: "DI CAPRIO CASE" })).toContain("DICAPRIOCAS");
    // The key as written is always first: SIMPLYLITE CASE is tried as itself.
    expect(frameCostCandidates({ model: "SIMPLYLITE CASE" })[0]).toBe("SIMPLYLITECASE");
  });

  it("an empty reference has no candidate and resolves to nothing", () => {
    expect(frameCostCandidates({})).toEqual([]);
    expect(frameCostRowFrom(NONE, { model: "", skus: ["", null] })).toBeNull();
  });
});

describe("the cost of a staging model (slug SKUs) — the «falta» bug", () => {
  it("resolves by model from the compiled 2026 list when the table is empty", () => {
    const hit = frameCostRowFrom(NONE, { model: "DC 50", skus: ["dc-50-di-caprio-grey", "dc-50-di-caprio-black"] });
    expect(hit).toMatchObject({ sku: "DC50", cost_cents: 1699, source: "supplier_list" });
  });

  it("resolves the SAME row from the slug SKU alone (word-boundary prefix)", () => {
    expect(frameCostRowFrom(mapOf([row()]), "dc-50-di-caprio-grey")).toMatchObject({ sku: "DC50", cost_cents: 1699 });
    expect(frameCostRowFrom(NONE, "T 35-crystal-black")).toMatchObject({ sku: "T35" });
    expect(frameCostRowFrom(NONE, "AGO 1029-02-crystal-grey-silver")).toMatchObject({ sku: "AGO1029" });
  });

  it("every catalogue path: costRefOf, summarizeFrameCosts, catalogSellingPrices join by the model's key", () => {
    const m: CatalogModel = {
      product_id: "prod_dc50",
      sku: "dc-50-di-caprio-grey",
      skus: ["dc-50-di-caprio-grey", "dc-50-di-caprio-black"],
      title: "DC 50",
      brand_slug: "di-caprio",
      is_case: false,
      price_cents: 3200,
    };
    expect(costRefOf(m)).toEqual({ model: "DC 50", skus: m.skus, upcs: [] });
    expect(summarizeFrameCosts([row()], [m]).with_cost).toBe(1);
    const prices = catalogSellingPrices([m], [], null, new Date(), mapOf([row()]));
    expect(prices.get("DC50")).toMatchObject({ product_id: "prod_dc50", price_cents: 3200 });
    expect(frameCostKeyFor(costRefOf(m))).toBe("DC50");
  });

  it("an owner's edit wins wherever it was saved (old screens saved under the SKU spelling)", () => {
    const rows = mapOf([row(), row({ sku: "DC50DICAPRIOGREY", cost_cents: 2500, source: "owner_edit" })]);
    expect(frameCostRowFrom(rows, { model: "DC 50", skus: ["dc-50-di-caprio-grey"] })).toMatchObject({ cost_cents: 2500, source: "owner_edit" });
    // …and one saved under the model key wins over the supplier row too.
    const v2 = mapOf([row({ cost_cents: 1800, source: "owner_edit" })]);
    expect(frameCostRowFrom(v2, { model: "DC 50" })).toMatchObject({ cost_cents: 1800, source: "owner_edit" });
  });

  it("a store's variation is found by the model's key from a slug SKU", () => {
    const variations = new Map([["est_A", new Map([["DC50", { establishment_id: "est_A", sku: "DC50", cost_cents: 1500, updated_at: null, updated_by: null }]])]]);
    expect(resolveFrameCost(mapOf([row()]), variations, { model: "DC 50", skus: ["dc-50-di-caprio-grey"] }, "est_A")).toMatchObject({
      cost_cents: 1500,
      origin: "store_variation",
      master_cost_cents: 1699,
    });
  });

  it("frameCostCents(sku, store) — what costing / sales-insights / store-pnl call — uses the catalogue aliases, then the model argument", () => {
    setFrameCostCache([row()], [], indexCatalogAliases([{ title: "DC 50", sku: "weird-code-1", upc: "8890001" }]));
    expect(frameCostCents("weird-code-1", null)).toBe(1699);
    expect(frameCostCents("8890001", null)).toBe(1699);
    expect(frameCostCents("dc-50-di-caprio-grey", null)).toBe(1699);
    expect(frameCostCents("unknown-sku", null, "DC 50")).toBe(1699);
    expect(frameCostCents("unknown-sku", null)).toBeNull();
  });

  it("the cost sheet of a sale with a slug SKU gets the supplier's cost, not the rule", () => {
    setFrameCostCache([row()]);
    const sheet = computeCostSheet({ total: 100, items: [{ quantity: 1, sku: "dc-50-di-caprio-grey", brand_slug: "di-caprio", lens: null }] }, []);
    const frame = sheet.lines.find((l) => l.key.startsWith("frame:"));
    expect(frame).toMatchObject({ amount: 16.99, source: "supplier" });
  });

  it("upcsOf reads the scraper's upc_by_color", () => {
    expect(upcsOf({ upc_by_color: { Black: "111", Grey: "", Red: 3 } })).toEqual(["111"]);
    expect(upcsOf(null)).toEqual([]);
  });
});

// ── 2. 2026 → previous list → none ───────────────────────────────────────────

describe("the previous list is the fallback of 2026, never above it", () => {
  it("is the e3bb8ba PRICE_BOOK: model, key, wholesale cents, brand", () => {
    expect(CAPRI_PREV_PRICE_LIST.length).toBe(460);
    expect(CAPRI_PREV_BY_KEY.get("DC50")).toEqual({ brand: "Di Caprio", model: "DC 50", key: "DC50", wholesale_cents: 1599 });
    expect(capriPrevCostCents("dc 50")).toBe(1599);
    expect(capriPrevCostCents("GRANDE CASE")).toBeNull(); // only estimated in the old book
    expect(capriPrevCostCents("NOPE")).toBeNull();
  });

  it("2026 wins where both have the model", () => {
    expect(CAPRI_BY_KEY.get("DC50")?.cost_cents).toBe(1699);
    expect(supplierListRow("DC 50")).toMatchObject({ cost_cents: 1699, source: "supplier_list" });
  });

  it("an estimated-only model of the old book stays unknown (none), never 0", () => {
    expect(supplierListRow("GRANDE CASE")).toBeNull();
    expect(frameCostRowFrom(NONE, { model: "GRANDE CASE" })).toBeNull();
  });

  it("a stored previous-list row answers with its own source", () => {
    const rows = mapOf([row({ sku: "ZZ100", model: "ZZ 100", cost_cents: 777, source: "supplier_list_prev" })]);
    expect(resolveFrameCost(rows, new Map(), { model: "ZZ 100" }, null)).toMatchObject({ cost_cents: 777, origin: "supplier_list_prev" });
  });

  it("seeds only previous-list keys the 2026 list lacks, with a real figure, guarded against 2026 rows and owner edits", () => {
    const prev = [
      { brand: "X", model: "DC 50", key: "DC50", wholesale_cents: 1599 },
      { brand: "X", model: "OLD 1", key: "OLD1", wholesale_cents: 450 },
      { brand: "X", model: "OLD 2", key: "OLD2", wholesale_cents: null },
    ];
    const rows = prevFrameCostSeedRows(prev, CAPRI_BY_KEY);
    expect(rows).toEqual([{ model: "OLD 1", key: "OLD1", book_cents: 0, cost_cents: 450 }]);
    const sql = frameCostSeedStatements(rows, "supplier_list_prev").join("\n");
    expect(sql).toContain("'supplier_list_prev')");
    expect(sql).toContain("WHERE store_frame_cost.source = 'supplier_list_prev'");
    expect(sql).not.toMatch(/source\s*=\s*EXCLUDED/);
    // With today's lists the fallback seeds nothing (every key is in 2026 or estimated).
    expect(prevFrameCostSeedRows()).toEqual([]);
  });
});

// ── 3. Absolute image URLs ───────────────────────────────────────────────────

describe("absoluteImageUrl", () => {
  const BASE = "https://cdn.example.org/bucket";
  it("prefixes a bare key and leaves URLs, data: and origin paths alone", () => {
    expect(absoluteImageUrl("products/dc407/dc407_00.webp", BASE)).toBe("https://cdn.example.org/bucket/products/dc407/dc407_00.webp");
    expect(absoluteImageUrl("https://caprioptics.com/x.jpg", BASE)).toBe("https://caprioptics.com/x.jpg");
    expect(absoluteImageUrl("http://a/b.png", BASE)).toBe("http://a/b.png");
    expect(absoluteImageUrl("data:image/png;base64,AAA", BASE)).toBe("data:image/png;base64,AAA");
    expect(absoluteImageUrl("/brands/logo-4u.png", BASE)).toBe("/brands/logo-4u.png");
    expect(absoluteImageUrl("", BASE)).toBeNull();
    expect(absoluteImageUrl(null, BASE)).toBeNull();
    expect(absoluteImageUrls(["a.jpg", "a.jpg", null, "https://x/y.jpg"], BASE + "/")).toEqual(["https://cdn.example.org/bucket/a.jpg", "https://x/y.jpg"]);
  });

  it("reads R2_PUBLIC_URL, then VITE_R2_PUBLIC_URL, ignoring the example placeholder", () => {
    expect(publicAssetBase({ R2_PUBLIC_URL: "https://pub.r2.dev/" } as NodeJS.ProcessEnv)).toBe("https://pub.r2.dev");
    expect(publicAssetBase({ VITE_R2_PUBLIC_URL: "https://v.r2.dev" } as NodeJS.ProcessEnv)).toBe("https://v.r2.dev");
    expect(publicAssetBase({ R2_PUBLIC_URL: "https://assets.example.com" } as NodeJS.ProcessEnv)).toBe(DEFAULT_ASSET_BASE);
  });

  it("the matrix row's thumbnail is absolute", () => {
    const p = toMatrixProduct({ product_id: "p", title: "DC 50", thumbnail: "products/dc50/a.webp", status: "published", metadata: {}, skus: [], base_cents: 1 }, new Set());
    expect(p.thumbnail).toMatch(/^https:\/\/.+\/products\/dc50\/a\.webp$/);
  });

  it("upload keys are safe and namespaced", () => {
    expect(catalogUploadKey("Logo Ñandú (1).PNG", 123)).toBe("catalog/123-logo-nandu-1-.png");
    expect(catalogUploadKey("", 1)).toBe("catalog/1-image");
  });
});

// ── 4. Brand price and brand discount ────────────────────────────────────────

const t0 = new Date("2026-11-01T00:00:00Z");
const now = new Date("2026-11-07T12:00:00Z");
const rule = (over: Partial<PriceRuleLike>): PriceRuleLike => ({ establishment_id: "est_A", scope: "frame", target: null, mode: "override", value: 0, valid_from: t0, valid_to: null, ...over });
const line = (rules: PriceRuleLike[], over: Partial<Parameters<typeof storeLinePrice>[1]> = {}) =>
  storeLinePrice(rules, { establishmentId: "est_A", scope: "frame", target: "prod_1", base: 60, lenses: 0, brand: "di-caprio", ...over }, now, null);

describe("storeLinePrice: model exact > brand > store adjustment > band > master", () => {
  const brand = rule({ target: brandTarget("di-caprio"), value: 45 });
  const exact = rule({ target: "prod_1", value: 50 });
  const adjust = rule({ target: null, mode: "percent", value: 10 });
  const master = rule({ establishment_id: null, target: "prod_1", value: 70 });

  it("the model's exact price beats the brand's", () => {
    expect(line([brand, exact, adjust])).toMatchObject({ frame: 50, frame_source: "store_exact" });
  });
  it("the brand's beats the store's adjustment and the master", () => {
    expect(line([brand, adjust, master])).toMatchObject({ frame: 45, frame_source: "brand", adjustment: { mode: "percent", value: 10 } });
  });
  it("the brand's is not moved by the band (he typed it); a computed price is", () => {
    // Floor: anything below $50 goes to $55.
    const band = { floor_below_cents: 5000, floor_to_cents: 5500, cap_above_cents: null, cap_to_cents: null, apply_to_cases: false, enabled: true };
    const input = { establishmentId: "est_A", scope: "frame" as const, target: "prod_1", base: 40, lenses: 0, brand: "di-caprio" };
    expect(storeLinePrice([brand], input, now, band)).toMatchObject({ frame: 45, band: null, frame_source: "brand" });
    expect(storeLinePrice([], input, now, band)).toMatchObject({ frame: 55, band: { from: 40, to: 55 } });
  });
  it("without a brand price the adjustment, then the master apply as before", () => {
    expect(line([adjust])).toMatchObject({ frame: 66, frame_source: "adjusted" });
    expect(line([master])).toMatchObject({ frame: 70, frame_source: "adjusted" });
    expect(line([])).toMatchObject({ frame: 60 });
  });
  it("only the store's own brand price, in its scope, for that brand", () => {
    expect(line([rule({ establishment_id: "est_B", target: brandTarget("di-caprio"), value: 45 })]).frame).toBe(60);
    expect(line([rule({ scope: "case", target: brandTarget("di-caprio"), value: 45 })]).frame).toBe(60);
    expect(line([brand], { brand: "flexure" }).frame).toBe(60);
    expect(line([brand], { brand: null }).frame).toBe(60); // callers that pass no brand: unchanged
    expect(line([brand], { target: "" }).frame).toBe(60); // the customer's own frame never takes a brand price
  });
  it("a fixed adjustment then lands on the lenses (legacy scope all), like an exact price", () => {
    const delta = rule({ scope: "all", target: null, mode: "delta", value: 5 });
    expect(line([brand, delta], { lenses: 40 })).toMatchObject({ frame: 45, lenses: 45, total: 90 });
  });
  it("brand targets: helpers", () => {
    expect(brandTarget("4u")).toBe("brand:4u");
    expect(brandOfTarget("brand:4u")).toBe("4u");
    expect(brandOfTarget("prod_1")).toBeNull();
    expect(brandOfTarget("brand:")).toBeNull();
    expect(brandPriceRule([brand], "est_A", "frame", "di-caprio", now)).toBe(brand);
  });
});

describe("discounts: the model's own, else its brand's", () => {
  const discounts = indexItemDiscounts([
    { establishment_id: "est_A", item_kind: "brand", item_key: "di-caprio", pct: 10 },
    { establishment_id: "est_A", item_kind: "frame", item_key: "prod_2", pct: 25 },
  ]);
  it("productDiscountOf", () => {
    expect(productDiscountOf(discounts, "est_A", "prod_1", "di-caprio")).toBe(10);
    expect(productDiscountOf(discounts, "est_A", "prod_2", "di-caprio")).toBe(25);
    expect(productDiscountOf(discounts, "est_A", "prod_1", "flexure")).toBeNull();
    expect(productDiscountOf(discounts, "est_B", "prod_1", "di-caprio")).toBeNull();
    expect(productDiscountOf(discounts, "est_A", "prod_1")).toBeNull();
  });
  it("the till's line: brand price, then the brand's discount; the model's discount wins over it", () => {
    const rules = [rule({ target: brandTarget("di-caprio"), value: 45 })];
    const sel = { design_code: "frame-only" };
    const pcts = linePromoPcts(discounts, "est_A", { productId: "prod_1", brandSlug: "di-caprio", selection: sel, category: null, finish: null });
    const sp = promoStoreLine(rules, { establishmentId: "est_A", scope: "frame", target: "prod_1", brand: "di-caprio", base: 60, lens: { lens_base_cents: 0, photo_cents: 0, ar_cents: 0 } }, pcts, now);
    expect(sp.frame).toBe(40.5);
    expect(sp.before.frame_source).toBe("brand");
    expect(sp.promo).toMatchObject({ frame_pct: 10, before_cents: 4500 });
    const own = linePromoPcts(discounts, "est_A", { productId: "prod_2", brandSlug: "di-caprio", selection: sel, category: null, finish: null });
    expect(own.frame_pct).toBe(25);
  });
});

describe("the matrix: source «brand», and the brand header per store", () => {
  const stores: MatrixStore[] = [
    { id: "est_A", code: "Op1", name: "Katy", color: "#111" },
    { id: "est_B", code: "Op2", name: "Houston", color: "#222" },
  ];
  const product = (id: string, title: string, brand = "di-caprio"): MatrixProduct => ({
    product_id: id,
    title,
    thumbnail: null,
    status: "published",
    brand_slug: brand,
    brand_name: "Di Caprio",
    skus: [`${title.toLowerCase().replace(/ /g, "-")}-di-caprio-grey`],
    base_cents: 6000,
    is_case: false,
    price_scope: "frame",
    first_seen_at: null,
  });
  const rules = [rule({ target: brandTarget("di-caprio"), value: 45 }), rule({ target: "prod_2", value: 50 })];
  const discounts = indexItemDiscounts([{ establishment_id: "est_A", item_kind: "brand", item_key: "di-caprio", pct: 10 }]);
  const products = [product("prod_1", "DC 50"), product("prod_2", "DC 72")];
  const rows = buildFrameRows(products, stores, rules, discounts, new Map(), { rows: NONE, variations: new Map() }, now);

  it("rows: brand price + brand discount; the model's exact price still wins; other store untouched", () => {
    expect(rows[0].stores["est_A"]).toMatchObject({ price_cents: 4500, source: "brand", exact: false, discount_pct: 10, final_cents: 4050 });
    expect(rows[1].stores["est_A"]).toMatchObject({ price_cents: 5000, source: "store_exact", exact: true, discount_pct: 10, final_cents: 4500 });
    expect(rows[0].stores["est_B"]).toMatchObject({ price_cents: 6000, source: "base", discount_pct: null });
  });

  it("rows carry the cost by model and the key it lives under", () => {
    expect(rows[0]).toMatchObject({ cost_cents: 1699, cost_source: "supplier_list", cost_key: "DC50" });
    expect(rows[1]).toMatchObject({ cost_key: "DC72" });
  });

  it("the group header: brand_price_cents / brand_discount_pct per store, and the logo", () => {
    const groups = withBrandExposure(groupFrameRows(rows, products, new Map()), stores, new Map(), {
      rules,
      discounts,
      scope: "frame",
      logos: new Map([["di-caprio", "/brands/logo-di-caprio.png"]]),
      now,
    });
    expect(groups[0].stores?.["est_A"]).toMatchObject({ brand_rule: null, exposed_rows: 2, brand_price_cents: 4500, brand_discount_pct: 10 });
    expect(groups[0].stores?.["est_B"]).toMatchObject({ brand_price_cents: null, brand_discount_pct: null });
    expect(groups[0].logo_url).toBe("/brands/logo-di-caprio.png");
    expect(brandStoreCell(rules, discounts, "est_A", "di-caprio", "case", now)).toEqual({ brand_price_cents: null, brand_discount_pct: 10 });
  });

  it("storeFramePrice, rulesByTarget and the sheet see the brand", () => {
    const forProduct = rulesByTarget(rules);
    expect(forProduct("prod_1", "di-caprio").some((r) => r.target === "brand:di-caprio")).toBe(true);
    expect(forProduct("prod_1").some((r) => r.target === "brand:di-caprio")).toBe(false);
    expect(storeFramePrice(rules, "est_A", { product_id: "prod_1", base_cents: null, price_scope: "frame", brand_slug: "di-caprio" }, now)).toEqual({ price_cents: 4500, source: "brand", exact: false });
    const sheet = storeSheetPrices([{ product_id: "prod_1", price_cents: 6000, brand_slug: "di-caprio" }], ["est_A"], rules, discounts, now);
    expect(sheet.get("prod_1")?.get("est_A")).toEqual({ price_cents: 4500, discount_pct: 10 });
  });
});

describe("POST /matrix/cell with kind «brand»", () => {
  it("plans a brand price (scope by the brand) and a brand discount", () => {
    expect(planCellWrite({ kind: "brand", key: "di-caprio", field: "price", store: "est_A", value: 45 })).toEqual({ op: { op: "brand_price", slug: "di-caprio", storeId: "est_A", scope: "frame", usd: 45 } });
    expect(planCellWrite({ kind: "brand", key: "case", field: "price", store: "est_A", value: "" })).toEqual({ op: { op: "brand_price", slug: "case", storeId: "est_A", scope: "case", usd: null } });
    expect(planCellWrite({ kind: "brand", key: "4u", field: "price", store: "est_A", value: 9, scope: "case" })).toMatchObject({ op: { scope: "case" } });
    expect(planCellWrite({ kind: "brand", key: "di-caprio", field: "discount", store: "est_A", value: 10 })).toEqual({ op: { op: "brand_discount", slug: "di-caprio", storeId: "est_A", pct: 10 } });
  });
  it("answers the contract's reasons", () => {
    expect(planCellWrite({ kind: "brand", key: "di-caprio", field: "cost", store: null, value: 1 })).toEqual({ reason: "bad_field" });
    expect(planCellWrite({ kind: "brand", key: "di-caprio", field: "price", store: "", value: 1 })).toEqual({ reason: "store_required" });
    expect(planCellWrite({ kind: "brand", key: "Di Caprio!", field: "price", store: "est_A", value: 1 })).toEqual({ reason: "unknown_item" });
    expect(planCellWrite({ kind: "brand", key: "di-caprio", field: "discount", store: "est_A", value: 95 })).toEqual({ reason: "discount_range" });
    expect(planCellWrite({ kind: "brand", key: "di-caprio", field: "price", store: "est_A", value: 1, scope: "all" })).toEqual({ reason: "bad_value" });
  });
});

describe("import: «Marcas» rows", () => {
  const stores = [{ id: "est_A", code: "Op1", name: "Katy", color: "" }];
  const brands = new Map<string, ImportBrand>();
  indexImportBrands(
    [{ key: "di-caprio", label: "Di Caprio", kind: "brand", rows: [], stores: { est_A: { brand_rule: null, exposed_rows: 1, brand_price_cents: 4500, brand_discount_pct: null } } }],
    "frame",
    brands
  );
  const index = { products: new Map(), lenses: new Map(), treatments: new Map(), brands, stores };

  it("plans price and discount changes per store, «unchanged» when equal, errors otherwise", () => {
    const plan = buildImportPlan(
      [
        { section: "brands", key: "di-caprio", stores: { Op1: { price: 45, discount: 10 } } },
        { section: "brands", key: "nope", stores: {} },
        { section: "brands", key: "di-caprio", cost: 3 },
        { section: "brands", key: "di-caprio", stores: { Op9: { price: 1 } } },
      ],
      index
    );
    expect(plan.counts).toMatchObject({ rows: 4, changes: 1, unchanged: 1, discount: 1 });
    expect(plan.changes[0]).toMatchObject({ section: "brands", kind: "brand", key: "di-caprio", scope: "frame", field: "discount", store: "est_A", before: null, after: 10 });
    expect(plan.errors.map((e) => e.reason)).toEqual(["unknown_item", "bad_row", "store_not_found"]);
    expect(changeAsCellWrite(plan.changes[0])).toEqual({ kind: "brand", key: "di-caprio", field: "discount", store: "est_A", value: 10, scope: "frame" });
    expect(planCellWrite(changeAsCellWrite(plan.changes[0]))).toMatchObject({ op: { op: "brand_discount" } });
  });

  it("clearing a brand price that is set is a change", () => {
    const plan = buildImportPlan([{ section: "brands", key: "DI-CAPRIO", stores: { op1: { price: null } } }], index);
    expect(plan.changes[0]).toMatchObject({ field: "price", before: 45, after: null });
  });
});

// ── 5. The brand registry ────────────────────────────────────────────────────

describe("catalog_brand", () => {
  it("maps catalogue slugs to the storefront's logo files explicitly", () => {
    expect(capriLogoOf("four-you")).toBe("/brands/logo-4u.png");
    expect(capriLogoOf("4u")).toBe("/brands/logo-4u.png");
    expect(capriLogoOf("cases")).toBe("/brands/logo-case.png");
    expect(capriLogoOf("di-caprio")).toBe("/brands/logo-di-caprio.png");
    expect(capriLogoOf("eyeleos")).toBeNull();
    expect(capriLogoOf("simply-lite")).toBeNull();
    expect(Object.values(BRAND_LOGO_FILES).sort()).toEqual(["4u", "4u", "case", "case", "di-caprio", "flexure", "grande", "millennial", "peachtree", "prorx", "trendy"]);
  });

  it("seeds the Capri brands idempotently, never overwriting a row", () => {
    const sql = catalogBrandSeedStatements().join("\n");
    expect(sql).toContain("ON CONFLICT (slug) WHERE deleted_at IS NULL DO NOTHING");
    expect(sql).toContain("'cbr_di_caprio', 'di-caprio', 'Di Caprio', '/brands/logo-di-caprio.png', 'frame', 'capri'");
    expect(sql).toContain("'case', 'Cases (estuches)', '/brands/logo-case.png', 'case'");
    expect(sql).toContain("'simply-lite', 'Simplylite', NULL");
  });

  it("a catalogue brand the registry lacks still appears (registered on read)", () => {
    const registry: BrandRow[] = [{ slug: "di-caprio", name: "Di Caprio", logo_url: "/brands/logo-di-caprio.png", kind: "frame", source: "capri", active: true, sort: 10 }];
    const merged = mergeBrands(registry, [
      { slug: "di-caprio", name: "Di Caprio", models: 34, cases: 0, manual: false },
      { slug: "eyeleos", name: "Eyeleos", models: 3, cases: 0, manual: false },
      { slug: "mine", name: "", models: 1, cases: 1, manual: true },
    ]);
    expect(merged.map((b) => [b.slug, b.models, b.registered, b.logo_url, b.kind, b.source])).toEqual([
      ["di-caprio", 34, true, "/brands/logo-di-caprio.png", "frame", "capri"],
      ["eyeleos", 3, false, null, "frame", "capri"],
      ["mine", 1, false, null, "case", "manual"],
    ]);
    expect(derivedBrandRow({ slug: "four-you", name: "", models: 2, cases: 0, manual: false })).toMatchObject({ name: "four-you", logo_url: "/brands/logo-4u.png", sort: DEFAULT_BRAND_SORT });
  });

  it("validates new brands and patches", () => {
    expect(cleanNewBrand({ name: "Óptica Nueva" })).toEqual({ brand: { slug: "optica-nueva", name: "Óptica Nueva", kind: "frame", logo_url: null, sort: DEFAULT_BRAND_SORT } });
    expect(cleanNewBrand({ name: "" })).toEqual({ reason: "bad_name" });
    expect(cleanNewBrand({ name: "X", kind: "lens" })).toEqual({ reason: "bad_kind" });
    expect(cleanNewBrand({ name: "X", slug: "Bad Slug" })).toEqual({ reason: "bad_slug" });
    expect(cleanNewBrand({ name: "X", logo_url: "javascript:alert(1)" })).toEqual({ reason: "bad_logo" });
    expect(cleanLogo("/brands/logo-4u.png")).toEqual({ logo: "/brands/logo-4u.png" });
    expect(cleanLogo("//evil.com/x.png")).toEqual({ reason: "bad_logo" });
    expect(cleanLogo("https://pub.r2.dev/catalog/1-logo.png")).toEqual({ logo: "https://pub.r2.dev/catalog/1-logo.png" });
    expect(cleanBrandPatch({ name: "Di Caprio Italia", active: false, sort: 5, logo_url: "" })).toEqual({ patch: { name: "Di Caprio Italia", active: false, sort: 5, logo_url: null } });
    expect(cleanBrandPatch({})).toEqual({ reason: "nothing_to_change" });
    expect(cleanBrandPatch({ active: "yes" })).toEqual({ reason: "bad_value" });
  });
});

// ── 6. Models: the PDP attributes, editing colours ───────────────────────────

describe("a model's PDP attributes and gallery, in the scraper's metadata keys", () => {
  const base = { brand: "Di Caprio", sku: "DC 999", cost: 16.5, colors: [{ name: "Black", image: "https://cdn/b.jpg" }] };
  it("creates with images[] first, the attributes and the description", () => {
    const cleaned = cleanCatalogFrame({
      ...base,
      images: ["https://cdn/main.jpg", "https://cdn/side.jpg"],
      material: ["Acetato", "Metal"],
      shape: "cat-eye",
      style: "full-frame",
      gender: "women",
      age_group: "adult",
      features: ["spring-hinges", "spring-hinges"],
      description: "  Hand-made acetate.  ",
    });
    if ("reason" in cleaned) throw new Error(cleaned.reason);
    const p = buildCatalogFrameProduct(cleaned.frame, { channelIds: [], now: new Date(0), actorId: null });
    expect(p["thumbnail"]).toBe("https://cdn/main.jpg");
    expect(p["images"]).toEqual([{ url: "https://cdn/main.jpg" }, { url: "https://cdn/side.jpg" }, { url: "https://cdn/b.jpg" }]);
    expect(p["description"]).toBe("Hand-made acetate.");
    expect(p["metadata"]).toMatchObject({ material: ["Acetato", "Metal"], shape: "cat-eye", style: "full-frame", gender: "women", age_group: "adult", features: ["spring-hinges"], source: "manual" });
  });
  it("refuses bad extras", () => {
    const reason = (b: Record<string, unknown>) => (cleanCatalogFrame({ ...base, ...b }) as { reason?: string }).reason;
    expect(reason({ images: ["not-a-url"] })).toBe("bad_images");
    expect(reason({ images: "x" })).toBe("bad_images");
    expect(reason({ shape: { a: 1 } })).toBe("bad_attribute");
    expect(reason({ features: "x" })).toBe("bad_attribute");
    expect(reason({ description: "x".repeat(5000) })).toBe("bad_description");
  });
});

describe("editing a model (POST /admin/catalog/frames/:id)", () => {
  it("validates only what is sent", () => {
    expect(cleanCatalogFramePatch({ model: "DC 50 B", status: "draft", shape: null })).toEqual({ patch: { attributes: { shape: null }, title: "DC 50 B", status: "draft" } });
    expect(cleanCatalogFramePatch({})).toEqual({ reason: "nothing_to_change" });
    expect(cleanCatalogFramePatch({ status: "archived" })).toEqual({ reason: "bad_status" });
    expect(cleanCatalogFramePatch({ colors: [] })).toEqual({ reason: "bad_colors" });
    expect(cleanCatalogFramePatch({ colors: [{ name: "Black" }, { name: "BLACK" }] })).toEqual({ reason: "bad_colors" });
    expect(cleanCatalogFramePatch({ brand: "Grande" })).toMatchObject({ patch: { brand: "Grande", brand_slug: "grande" } });
  });

  it("plans the colours: keep / rename, add (SKU <model>-<colour>, never taken), remove what is left out", () => {
    const existing = [
      { id: "v1", title: "Black", sku: "DC 50", metadata: null },
      { id: "v2", title: "Grey", sku: "DC 50-grey", metadata: null },
      { id: "v3", title: "Red", sku: "DC 50-red", metadata: null },
    ];
    const plan = planColorEdit(
      existing,
      [
        { variant_id: "v1", name: "Black" },
        { variant_id: "v2", name: "Smoke Grey", image: "https://cdn/g.jpg" },
        { variant_id: null, name: "Red" },
        { variant_id: "v9", name: "Blue" },
      ],
      "DC 50"
    );
    expect(plan.update).toEqual([{ id: "v2", name: "Smoke Grey", image: "https://cdn/g.jpg", renamed: true }]);
    expect(plan.create).toEqual([{ name: "Red", image: null, sku: "DC 50-red-2" }]);
    expect(plan.remove).toEqual(["v3"]);
    expect(plan.newOptionValues).toEqual(["Smoke Grey"]);
    expect(plan.unknown).toEqual(["v9"]);
  });

  it("takes the panel's colour `id` as the variant (QA v2: kept colours were planned as new)", () => {
    const out = cleanCatalogFramePatch({ colors: [{ id: "v1", name: "Negro", image: "https://cdn/n.png" }, { variant_id: "v2", name: "Carey" }, { name: "Rojo" }] });
    expect(out).toEqual({ patch: { attributes: {}, colors: [{ variant_id: "v1", name: "Negro", image: "https://cdn/n.png" }, { variant_id: "v2", name: "Carey" }, { variant_id: null, name: "Rojo" }] } });
    const existing = [
      { id: "v1", title: "Negro", sku: "MV2300", metadata: null },
      { id: "v2", title: "Carey", sku: "MV2300-carey", metadata: null },
    ];
    if (!("patch" in out) || !out.patch.colors) throw new Error("expected a patch with colours");
    const plan = planColorEdit(existing, out.patch.colors, "MV2300");
    expect(plan.remove).toEqual([]);
    expect(plan.create.map((c) => c.name)).toEqual(["Rojo"]);
  });

  it("«Editar modelo» writes cost and per-store prices as matrix cells, only what changed (QA v2)", () => {
    const cell = (price: number | null, exact: boolean, pct: number | null) => ({ price_cents: price, source: exact ? "store_exact" : "brand", exact, discount_pct: pct, final_cents: price, exposed: true }) as never;
    const row = { kind: "frame" as const, key: "prod_1", cost_cents: 3150, cost_source: "supplier_list", stores: { s1: cell(9900, true, null), s2: cell(7900, false, 15) } };
    // Unchanged cost and prices (the dialog sends what it opened with) → nothing; a brand discount shown is not copied.
    expect(frameEditCellWrites({ cost: 31.5, prices: { s1: { price: 99, discount: 0 }, s2: { price: null, discount: 15 } } }, row, ["s1", "s2"])).toEqual({ writes: [] });
    // New cost, new exact price in s2, cleared price in s1, new discount in s1.
    expect(frameEditCellWrites({ cost: "32.75", prices: { s1: { price: null, discount: 5 }, s2: { price: 85 } } }, row, ["s1", "s2"])).toEqual({
      writes: [
        { kind: "frame", key: "prod_1", field: "cost", store: null, value: "32.75" },
        { kind: "frame", key: "prod_1", field: "price", store: "s1", value: null },
        { kind: "frame", key: "prod_1", field: "discount", store: "s1", value: 5 },
        { kind: "frame", key: "prod_1", field: "price", store: "s2", value: 85 },
      ],
    });
    // Clearing a cost only writes when it is the owner's (back to the list).
    expect(frameEditCellWrites({ cost: null }, row, ["s1"])).toEqual({ writes: [] });
    expect(frameEditCellWrites({ cost: null }, { ...row, cost_source: "owner_edit" }, ["s1"])).toEqual({ writes: [{ kind: "frame", key: "prod_1", field: "cost", store: null, value: null }] });
    expect(frameEditCellWrites({ prices: { nope: { price: 1 } } }, row, ["s1"])).toEqual({ reason: "store_not_found" });
    expect(frameEditCellWrites({ prices: { s1: { discount: 99 } } }, row, ["s1"])).toEqual({ reason: "discount_range" });
    expect(frameEditCellWrites({ cost: "abc" }, row, ["s1"])).toEqual({ reason: "bad_value" });
  });

  it("rebuilds the gallery on an edit like the create (extras, then colour photos); untouched → undefined", () => {
    const current = {
      images: ["https://cdn/extra.jpg", "https://cdn/black.jpg", "https://cdn/tort.jpg"],
      variants: [
        { id: "v1", title: "Black", sku: "X", metadata: { image: "https://cdn/black.jpg" } },
        { id: "v2", title: "Tortoise", sku: "X-t", metadata: { image: "https://cdn/tort.jpg" } },
      ],
    };
    // The dialog sends no extra photos and a new photo for colour 2: the colour photos stay, the extras go.
    expect(galleryAfterEdit(current, { images: [], colors: [{ variant_id: "v1", name: "Black" }, { variant_id: "v2", name: "Tortoise", image: "https://cdn/new.jpg" }] }))
      .toEqual(["https://cdn/black.jpg", "https://cdn/new.jpg"]);
    // Only a colour photo changes: the extra photos are kept, first.
    expect(galleryAfterEdit(current, { colors: [{ variant_id: "v1", name: "Black", image: "https://cdn/b2.jpg" }, { variant_id: "v2", name: "Tortoise" }] }))
      .toEqual(["https://cdn/extra.jpg", "https://cdn/b2.jpg", "https://cdn/tort.jpg"]);
    expect(galleryAfterEdit(current, { colors: [{ variant_id: "v1", name: "Negro" }, { variant_id: "v2", name: "Tortoise" }] })).toBeUndefined();
    expect(galleryAfterEdit(current, {})).toBeUndefined();
    // A removed photo (null) leaves the gallery.
    expect(galleryAfterEdit(current, { images: ["https://cdn/extra.jpg"], colors: [{ variant_id: "v1", name: "Black", image: null }, { variant_id: "v2", name: "Tortoise" }] }))
      .toEqual(["https://cdn/extra.jpg", "https://cdn/tort.jpg"]);
  });
});

// ── 7. Treatments ────────────────────────────────────────────────────────────

describe("editing a treatment (POST /admin/pricing/treatments/:code)", () => {
  it("validates per type", () => {
    expect(cleanTreatmentPatch("ar", { label_es: "AR Verde", ar_group: "sv", cost: 3, prices: 25 })).toEqual({ patch: { label_es: "AR Verde", ar_group: "sv", cost_cents: 300, prices: { ar: 2500 } } });
    expect(cleanTreatmentPatch("photo", { prices: { sv: 30, prog: null } })).toEqual({ patch: { prices: { sv: 3000, prog: null } } });
    expect(cleanTreatmentPatch("photo", { ar_group: "sv" })).toEqual({ reason: "bad_value" });
    expect(cleanTreatmentPatch("ar", { prices: null })).toEqual({ reason: "bad_value" });
    expect(cleanTreatmentPatch("photo", { label_en: "" })).toEqual({ reason: "bad_label" });
    expect(cleanTreatmentPatch("photo", { is_active: "no" })).toEqual({ reason: "bad_value" });
    expect(cleanTreatmentPatch("photo", { cost: null })).toEqual({ patch: { cost_cents: null } });
    expect(cleanTreatmentPatch("photo", {})).toEqual({ reason: "nothing_to_change" });
  });
  it("a photochromic keeps at least one priced category", () => {
    expect(photoPricesAfter({ sv: 3000, bifocal: null, prog: 4000 }, { prog: null })).toEqual({ sv: 3000, bifocal: null, prog: null });
    expect(photoPricesAfter({ sv: 3000, bifocal: null, prog: null }, { sv: null })).toBeNull();
  });
});

describe("matrix brand groups carry the general switch", () => {
  const { withBrandExposure: withExposure } = jest.requireActual("../src/lib/price-matrix");
  const store = { id: "est_1", code: "Op1", name: "Katy", color: "#000" };
  const group = (key: string) => ({ key, label: key, kind: "brand", rows: [{ kind: "frame", key: "p1", brand_slug: key, stores: { est_1: { exposed: false } } }] });

  it("active=false for a brand switched off in the registry, true otherwise; store rule unchanged", () => {
    const assortment = new Map([["est_1", [{ scope: "chain_brand", target: "di-caprio", exposed: false }, { scope: "brand", target: "di-caprio", exposed: true }]]]);
    const [off, on] = withExposure([group("di-caprio"), group("flexure")], [store], assortment, {
      rules: [], discounts: new Map() as never, scope: "frame", inactive: new Set(["di-caprio"]),
    });
    expect(off.active).toBe(false);
    expect(off.stores.est_1.brand_rule).toBe(true);
    expect(on.active).toBe(true);
  });
});

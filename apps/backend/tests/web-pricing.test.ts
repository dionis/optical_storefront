import { indexItemDiscounts } from "../src/lib/price-matrix";
import type { PriceRuleLike } from "../src/lib/store-pricing";
import { applyWebPrices, productsOfBody, webLensParts, webLinePrice, webProductPrice, type WebPriceContext } from "../src/lib/web-pricing";

/**
 * What the web shop charges = the online store's prices (11-nov-2026).
 * The same pure functions as the till, so: no rule → the master's price; the
 * store's exact price, adjustment and promotions → the store's.
 */
const STORE = { id: "est_4", code: "Op4", name: "Online", color: "#0E5AD0" };
const rule = (over: Partial<PriceRuleLike>): PriceRuleLike => ({
  establishment_id: "est_4",
  scope: "frame",
  target: null,
  mode: "percent",
  value: 10,
  valid_from: "2026-10-01T00:00:00Z",
  valid_to: null,
  ...over,
});
const ctxOf = (rules: PriceRuleLike[] = [], discounts: Array<{ item_kind: string; item_key: string; pct: number }> = []): WebPriceContext => ({
  store: STORE,
  rules,
  discounts: indexItemDiscounts(discounts.map((d) => ({ establishment_id: "est_4", ...d }))),
  caseIds: new Set(rules.filter((r) => r.scope === "case" && r.target).map((r) => r.target as string)),
});
const NOW = new Date("2026-11-11T12:00:00Z");
const P = { id: "prod_1", metadata: { brand_slug: "flexure" } };

describe("webProductPrice", () => {
  it("a store with no rule and no promotion charges the master's price", () => {
    expect(webProductPrice(ctxOf(), P, 120, NOW)).toEqual({ price: 120, before: 120, discount_pct: null });
  });
  it("the store's exact price of the model wins over its adjustment", () => {
    const ctx = ctxOf([rule({}), rule({ target: "prod_1", mode: "override", value: 99 })]);
    expect(webProductPrice(ctx, P, 120, NOW).price).toBe(99);
    expect(webProductPrice(ctx, { id: "prod_2", metadata: {} }, 120, NOW).price).toBe(132);
  });
  it("another store's rules never reach the web", () => {
    expect(webProductPrice(ctxOf([rule({ establishment_id: "est_1", target: "prod_1", mode: "override", value: 50 })]), P, 120, NOW).price).toBe(120);
  });
  it("the store's promotion on the model, or on its brand, comes off its price", () => {
    expect(webProductPrice(ctxOf([], [{ item_kind: "frame", item_key: "prod_1", pct: 25 }]), P, 120, NOW)).toEqual({ price: 90, before: 120, discount_pct: 25 });
    expect(webProductPrice(ctxOf([], [{ item_kind: "brand", item_key: "flexure", pct: 10 }]), P, 120, NOW).price).toBe(108);
  });
});

describe("applyWebPrices — the catalogue leaves with the store's price", () => {
  const body = () => ({
    products: [
      { id: "prod_1", metadata: { brand_slug: "flexure" }, variants: [{ id: "v1", calculated_price: { calculated_amount: 120, original_amount: 120, calculated_amount_with_tax: 129.9, currency_code: "usd" } }, { id: "v2", calculated_price: null }] },
      { id: "prod_2", variants: [{ id: "v3", calculated_price: { calculated_amount: 80, original_amount: 80 } }] },
    ],
  });
  it("rewrites calculated and original amounts, scales the tax-inclusive sibling, and skips unpriced variants", () => {
    const b = body();
    const ctx = ctxOf([rule({ target: "prod_1", mode: "override", value: 100 })], [{ item_kind: "frame", item_key: "prod_1", pct: 10 }]);
    const changed = applyWebPrices(ctx, productsOfBody(b), new Map([["prod_2", {}]]), NOW);
    expect(changed).toBe(1);
    const cp = b.products[0].variants[0].calculated_price as Record<string, unknown>;
    expect(cp.calculated_amount).toBe(90);
    expect(cp.original_amount).toBe(100);
    expect(cp.calculated_amount_with_tax).toBe(97.43); // 129.9 × 90 / 120
    expect(cp.currency_code).toBe("usd");
    expect(b.products[0].variants[1].calculated_price).toBeNull();
    expect(b.products[1].variants[0].calculated_price).toEqual({ calculated_amount: 80, original_amount: 80 });
  });
  it("the metadata of a product whose body carries none comes from the map (brand price)", () => {
    const b = body();
    const ctx = ctxOf([], [{ item_kind: "brand", item_key: "milen", pct: 50 }]);
    applyWebPrices(ctx, productsOfBody(b), new Map([["prod_2", { brand_slug: "milen" }]]), NOW);
    expect(b.products[1].variants[0].calculated_price!.calculated_amount).toBe(40);
    expect(b.products[0].variants[0].calculated_price!.calculated_amount).toBe(120);
  });
  it("reads a single-product body and ignores anything else", () => {
    expect(productsOfBody({ product: { id: "p" } })).toHaveLength(1);
    expect(productsOfBody({ regions: [] })).toEqual([]);
    expect(productsOfBody(null)).toEqual([]);
  });
});

describe("webLinePrice / webLensParts — a configured line in the online store", () => {
  const lens = { lens_base_cents: 6000, photo_cents: 4000, ar_cents: 2000 };
  const selection = { design_code: "sv", material_code: "poly", photo_code: "photo-grey", ar_code: "ar-green" };
  it("no rule, no promotion: frame + the lens add-on as given, no promo", () => {
    expect(webLinePrice(ctxOf(), { product: P, base: 120, selection, lens, category: "sv", finish: null }, NOW)).toEqual({ frame: 120, lens_cents: 12000, promo: null });
  });
  it("the frame's promotion and the AR's promotion each come off their own part", () => {
    const ctx = ctxOf([], [{ item_kind: "frame", item_key: "prod_1", pct: 10 }, { item_kind: "ar", item_key: "ar-green", pct: 50 }]);
    const line = webLinePrice(ctx, { product: P, base: 120, selection, lens, category: "sv", finish: null }, NOW);
    expect(line.frame).toBe(108);
    expect(line.lens_cents).toBe(11000);
    expect(line.promo).toMatchObject({ frame_pct: 10, ar_pct: 50, before_cents: 24000 });
  });
  it("the wizard's lens parts add up to what the cart will charge for the lenses", () => {
    const ctx = ctxOf([], [{ item_kind: "ar", item_key: "ar-green", pct: 50 }]);
    const parts = webLensParts(ctx, { selection, lens, category: "sv", finish: null }, NOW);
    expect(parts).toEqual({ lens_base_cents: 6000, photo_cents: 4000, ar_cents: 1000, total_cents: 11000 });
    expect(parts.lens_base_cents + parts.photo_cents + parts.ar_cents).toBe(parts.total_cents);
  });
});

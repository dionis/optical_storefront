/**
 * A store frame that is not in the catalog (owner, 9-nov-2026): typed in at
 * the till with brand, model, color and size, and charged at the price the
 * seller enters — unlike the customer's own frame, which is not charged.
 */
import { cleanLines, cleanStoreFrame, STORE_FRAME_PRICE } from "../src/lib/pos";
import { factFromLine } from "../src/lib/sale-facts";
import { lineFactOf } from "../src/lib/pos-sale-detail";

const store = (extra: Record<string, unknown>) => ({ kind: "store_frame", selection: { design_code: "frame-only" }, ...extra });

describe("cleanStoreFrame", () => {
  it("needs a name (brand or model) and a price", () => {
    expect(cleanStoreFrame({ brand: "Vogue", price: "89.90" })).toEqual({
      specs: { brand: "Vogue", model: null, color: null, eye_size: null, bridge: null, temple: null },
      price_cents: 8990,
    });
    expect(cleanStoreFrame({ model: "VO5286", color: "Carey", eye_size: 52, bridge: 18, temple: 140, price: 120 })).toMatchObject({ price_cents: 12000, specs: { model: "VO5286", eye_size: 52 } });
    expect(cleanStoreFrame({ color: "Negro", price: 50 })).toEqual({ reason: "store_frame_needs_name" });
    expect(cleanStoreFrame(null)).toEqual({ reason: "store_frame_needs_name" });
  });
  it("refuses a missing, zero, negative or absurd price", () => {
    for (const price of [undefined, "", 0, -5, "abc", STORE_FRAME_PRICE.max + 1]) {
      expect(cleanStoreFrame({ brand: "Vogue", price })).toEqual({ reason: "bad_store_frame_price" });
    }
    expect(cleanStoreFrame({ brand: "Vogue", price: "$1,200.50" })).toMatchObject({ price_cents: 120050 });
  });
  it("refuses a size outside the plausible ranges", () => {
    expect(cleanStoreFrame({ brand: "Vogue", price: 50, bridge: 3 })).toEqual({ reason: "bad_store_frame" });
  });
});

describe("the sale line", () => {
  it("carries the specs, the summary and the price; it may be sold without lenses", () => {
    const r = cleanLines([store({ store_frame: { brand: "Vogue", model: "VO5286", color: "Carey", eye_size: 52, bridge: 18, temple: 140, price: 95 }, description: "exhibidor" })]);
    expect(r).toMatchObject({
      lines: [{ kind: "store_frame", variant_id: null, frame_price_cents: 9500, own_frame: { brand: "Vogue", temple: 140 }, description: "Vogue VO5286 · Carey · 52-18-140 — exhibidor" }],
    });
    expect(cleanLines([store({ selection: { design_code: "sv", material_code: "cr39" }, store_frame: { brand: "Vogue", price: 95 } })])).toMatchObject({ lines: [{ selection: { design_code: "sv" } }] });
  });
  it("without a name or a price the line is refused", () => {
    expect(cleanLines([store({ store_frame: { price: 95 } })])).toEqual({ reason: "store_frame_needs_name" });
    expect(cleanLines([store({ store_frame: { brand: "Vogue" } })])).toEqual({ reason: "bad_store_frame_price" });
  });
  it("an own frame or a catalog frame never carry a frame price", () => {
    const own = cleanLines([{ kind: "own_frame", selection: { design_code: "sv" }, own_frame: { brand: "Oakley" }, store_frame: { brand: "x", price: 99 } }]);
    expect(own).toMatchObject({ lines: [{ kind: "own_frame", frame_price_cents: null }] });
    const cat = cleanLines([{ kind: "frame", variant_id: "variant_1", selection: { design_code: "frame-only" }, store_frame: { brand: "x", price: 99 } }]);
    expect(cat).toMatchObject({ lines: [{ kind: "frame", frame_price_cents: null, own_frame: null }] });
  });
});

describe("analytics and lists read it as a sold frame", () => {
  const md = { kind: "store-frame", lens_config: { design_code: "frame-only" }, list_price: 95, frame_price: 95, lens_addon: 0, tax_amount: 0, store_frame: { brand: "Vogue", model: "VO5286", color: "Carey", description: "Vogue VO5286 · Carey" } };
  it("sale facts: a frame, with the typed brand and model, no product", () => {
    const ctx = { orderId: "order_1", channel: "pos" as const, saleId: "poss_1", saleNumber: "Op1-000001", establishmentId: "est_1", terminalId: null, sellerId: null, sellerCode: null, customerId: null, paymentMethods: ["cash"], soldAt: new Date("2026-11-09T12:00:00Z"), status: "active" as const, tz: "America/Chicago" };
    const f = factFromLine({ id: "li_1", unit_price: 95, quantity: 1, title: "Vogue VO5286 · Carey", product_id: null, metadata: md }, {}, ctx);
    expect(f).toMatchObject({ category: "frame", brand: "Vogue", title: "VO5286", product_id: null, frame_cents: 9500 });
  });
  it("sale list: brand, model and color as typed", () => {
    const f = lineFactOf({ id: "li_1", title: "Vogue VO5286 · Carey", product_id: null, metadata: md } as never, undefined);
    expect(f).toMatchObject({ category: "frame", brand: "Vogue", title: "VO5286", variant_title: "Carey", sku: null });
  });
});

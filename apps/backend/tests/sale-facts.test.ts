import { factFromLine, type LineContext } from "../src/lib/sale-facts";
import { previousPeriod } from "../src/lib/sales-analytics";

const ctx: LineContext = {
  orderId: "order_1",
  channel: "pos",
  saleId: "poss_1",
  saleNumber: "Op2-000147",
  establishmentId: "est_2",
  terminalId: "posterm_1",
  sellerId: "user_1",
  sellerCode: "CM07",
  customerId: "cus_1",
  paymentMethods: ["cash"],
  // 22:30 in Katy on Oct 27 is 03:30 UTC on Oct 28.
  soldAt: new Date("2026-10-28T03:30:00Z"),
  status: "active",
  tz: "America/Chicago",
};

describe("factFromLine", () => {
  it("a frame with lenses, discounted, on its local day", () => {
    const f = factFromLine(
      {
        id: "item_1",
        product_id: "prod_1",
        variant_id: "var_1",
        variant_sku: "GR825-BLK",
        product_title: "GR 825",
        quantity: 1,
        unit_price: 202.5,
        metadata: { list_price: 225, frame_price: 32.4, lens_addon: 170.1, tax_amount: 0, prescription_id: "rx_1", lens_config: { design_code: "prog-mid", material_code: "poly", photo_code: "photo-grey", ar_code: "ar-green" } },
      },
      { brand: "Capri", brand_slug: "capri" },
      ctx
    );
    expect(f).toMatchObject({
      category: "frame",
      brand: "Capri",
      lens_design: "prog-mid",
      has_prescription: true,
      list_cents: 22500,
      discount_cents: 2250,
      total_cents: 20250,
      frame_cents: 3240,
      lenses_cents: 17010,
      sold_date_local: "2026-10-27",
    });
  });

  it("a case and a customer's own frame", () => {
    expect(factFromLine({ id: "i2", product_id: "p2", quantity: 1, unit_price: 10, metadata: {} }, { brand_slug: "case" }, ctx).category).toBe("case");
    const own = factFromLine({ id: "i3", title: "Ray-Ban", quantity: 1, unit_price: 120, metadata: { kind: "own-frame", lens_config: { design_code: "sv" } } }, {}, ctx);
    expect(own).toMatchObject({ category: "own_frame", product_id: null, lens_design: "sv" });
  });

  it("a frame-only line with sales tax keeps the tax apart", () => {
    const f = factFromLine({ id: "i4", product_id: "p4", quantity: 1, unit_price: 38.52, metadata: { list_price: 36, tax_amount: 2.52, lens_config: { design_code: "frame-only" } } }, {}, ctx);
    expect(f).toMatchObject({ tax_cents: 252, list_cents: 3600, discount_cents: 0, lens_design: null });
  });
});

describe("previousPeriod", () => {
  it("is the same length just before", () => {
    expect(previousPeriod("2026-10-01", "2026-10-31")).toEqual({ from: "2026-08-31", to: "2026-09-30" });
    expect(previousPeriod("2026-10-27", "2026-10-27")).toEqual({ from: "2026-10-26", to: "2026-10-26" });
  });
});

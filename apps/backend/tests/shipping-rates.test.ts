import { FLAT_SHIPPING_RATE, isShippableCountry, quoteCarrier, quoteCarriers } from "../src/lib/shipping-rates";

describe("delivery: one flat price, United States only", () => {
  it("sells the delivery at $30", () => {
    expect(FLAT_SHIPPING_RATE).toBe(30);
  });

  it("quotes ONE option at the flat price whatever the cart is worth", () => {
    for (const subtotal of [0, 19.99, 150, 2500]) {
      const quotes = quoteCarriers(subtotal);
      expect(quotes).toHaveLength(1);
      expect(quotes[0]).toMatchObject({ carrier: "fedex", amount: 30, free: false });
    }
  });

  it("has no cheaper second carrier to pick", () => {
    expect(quoteCarrier(80, "fedex")?.amount).toBe(30);
    expect(quoteCarrier(80, "FEDEX")?.amount).toBe(30);
    expect(quoteCarrier(80, "dhl")).toBeNull();
    expect(quoteCarrier(80, "")).toBeNull();
  });

  it("ships to the United States only", () => {
    expect(isShippableCountry("us")).toBe(true);
    expect(isShippableCountry("US")).toBe(true);
    expect(isShippableCountry("")).toBe(true); // no country typed yet: the quote route answers once it is
    for (const cc of ["mx", "ca", "es", "cu", "pr-x"]) expect(isShippableCountry(cc)).toBe(false);
  });
});

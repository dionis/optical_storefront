import { PRICE_BOOK } from "../src/data/wholesale-prices";
import { CAPRI_BY_KEY, capriKeyOf } from "../src/modules/store-pricing/capri-price-list-2026";
import { sellingPrice } from "../src/lib/pricing";

/**
 * The catalogue's price book is a PROJECTION of the supplier's list, not a
 * second opinion about what a frame costs. There used to be two lists, and the
 * selling price and the margin of one model could start from different numbers.
 * These tests fail the moment they drift apart again.
 */
const isCase = (brand: string) => brand === "Cases";

describe("the price book is derived from the supplier's list", () => {
  it("prices every row from the supplier's real cost, with the shop's markup", () => {
    const wrong = PRICE_BOOK.filter((p) => p.wholesale != null)
      .filter((p) => p.price !== sellingPrice(p.wholesale as number, isCase(p.brand) ? "case" : "frame"));
    expect(wrong.map((p) => p.model)).toEqual([]);
  });

  it("takes each cost from the supplier's list, never from a guess", () => {
    const off = PRICE_BOOK.filter((p) => p.wholesale != null).filter((p) => {
      const row = CAPRI_BY_KEY.get(capriKeyOf(p.model));
      return !row || Math.round((p.wholesale as number) * 100) !== row.cost_cents;
    });
    expect(off.map((p) => p.model)).toEqual([]);
  });

  it("marks as estimated exactly the models the supplier does not list", () => {
    // Today: the Grande and SimplyLite cases. A row with no cost must never
    // carry a cost of 0 — that would read as a 100% margin.
    for (const p of PRICE_BOOK) {
      expect(p.estimated).toBe(p.wholesale == null);
      expect(p.wholesale).not.toBe(0);
    }
  });

  it("never sells below cost", () => {
    const under = PRICE_BOOK.filter((p) => p.wholesale != null && p.price <= (p.wholesale as number));
    expect(under.map((p) => p.model)).toEqual([]);
  });

  it("keys every model once", () => {
    const keys = PRICE_BOOK.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/**
 * The breakdown of the month's result (lib/pnl-breakdown.ts): adding the
 * stores' ledger figures keeps every part, so the breakdown adds up to the
 * cards. The full read is checked against /admin/store-costs/pnl in the QA run.
 */
import { addEntity } from "../src/lib/pnl-breakdown";
import type { EntityMonth } from "../src/lib/financial-statement";

const e = (over: Partial<EntityMonth>): EntityMonth => ({
  entity: "est_1", channel: "pos", net_sales: 0, sales_tax: 0, gross_sales: 0, sales_count: 0,
  cogs: { frames: 0, lenses: 0, treatments: 0, per_order: 0, total: 0 }, payment_fees: 0, commissions: 0, costs: [], ...over,
});

describe("pnl breakdown", () => {
  it("adds two stores part by part", () => {
    const a = e({ net_sales: 10000, sales_tax: 500, gross_sales: 10500, sales_count: 3, taxable_net_sales: 4000, cogs: { frames: 2000, lenses: 1000, treatments: 300, per_order: 100, total: 3400 }, payment_fees: 250, commissions: 700, costs: [{ item_id: "i1", bucket: "fixed", tax_category: "rent", per_sale: false, cents: 120000 }] });
    const b = e({ entity: "est_2", net_sales: 5000, sales_tax: 0, gross_sales: 5000, sales_count: 2, web_net_sales: 5000, shipping_income: 3000, cogs: { frames: 1000, lenses: 0, treatments: 0, per_order: 0, total: 1000 }, payment_fees: 150, commissions: 0, costs: [{ item_id: "i2", bucket: "shared", tax_category: "rent", per_sale: false, cents: 30000 }] });
    const s = addEntity(addEntity(null, a), b);
    expect(s).toMatchObject({ net_sales: 15000, sales_tax: 500, gross_sales: 15500, sales_count: 5, taxable_net_sales: 4000, shipping_income: 3000, web_net_sales: 5000, payment_fees: 400, commissions: 700 });
    expect(s.cogs).toEqual({ frames: 3000, lenses: 1000, treatments: 300, per_order: 100, total: 4400 });
    expect(s.costs.map((c) => c.item_id)).toEqual(["i1", "i2"]);
  });

  it("never changes the first entity it starts from", () => {
    const a = e({ net_sales: 100, costs: [{ item_id: "x", bucket: "variable", tax_category: "other", per_sale: true, cents: 5 }] });
    const s = addEntity(addEntity(null, a), e({ net_sales: 1 }));
    expect(a.net_sales).toBe(100);
    expect(a.costs).toHaveLength(1);
    expect(s.net_sales).toBe(101);
  });
});

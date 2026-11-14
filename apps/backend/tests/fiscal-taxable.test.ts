import { ledgerOf, statementDollars, statementOf, type LedgerFact, type LedgerInput } from "../src/lib/financial-statement";

/**
 * The fiscal report's sales-tax figures (13-nov-2026): taxable sales are the
 * net of the lines that carried tax, exempt sales the rest, and the two add
 * up to the revenue — per store, per month and consolidated.
 */
const fact = (o: Partial<LedgerFact>): LedgerFact => ({
  order_id: "o1",
  channel: "pos",
  establishment_id: "est_1",
  seller_id: null,
  seller_code: null,
  product_id: "p1",
  sku: "FX1",
  qty: 1,
  total_cents: 10000,
  tax_cents: 0,
  lens_design: null,
  lens_material: null,
  lens_photo: null,
  lens_ar: null,
  lens_finish: null,
  sold_date_local: "2026-11-05",
  ...o,
});
const input = (facts: LedgerFact[], o: Partial<LedgerInput> = {}): LedgerInput => ({
  months: ["2026-11"],
  facts,
  pays: [],
  rules: [],
  items: [],
  brandOf: () => null,
  pctOf: () => null,
  storeIds: ["est_1", "est_2"],
  activeStoreIds: ["est_1", "est_2"],
  tz: "UTC",
  web: false,
  ...o,
});

describe("taxable and exempt sales", () => {
  const facts = [
    fact({ order_id: "a", total_cents: 10825, tax_cents: 825 }), // a frame alone: taxed
    fact({ order_id: "b", total_cents: 25000, tax_cents: 0, lens_design: "sv" }), // with prescription: exempt
    // one order, two lines: only the taxed line is taxable
    fact({ order_id: "c", total_cents: 5413, tax_cents: 413 }),
    fact({ order_id: "c", total_cents: 9000, tax_cents: 0, product_id: null, sku: null, lens_design: "sv" }),
    fact({ order_id: "d", establishment_id: "est_2", total_cents: 4000, tax_cents: 0 }),
  ];
  const [nov] = ledgerOf(input(facts));

  it("taxable = net of the lines that carried tax; exempt = the rest; they add up to the revenue", () => {
    const s = statementOf([nov.entities.get("est_1")!]);
    expect(s.taxable_sales).toBe(10000 + 5000);
    expect(s.sales_tax).toBe(825 + 413);
    expect(s.revenue.total).toBe(10000 + 25000 + 5000 + 9000);
    expect(s.exempt_sales).toBe(34000);
    expect(s.taxable_sales + s.exempt_sales).toBe(s.revenue.total);
    expect(s.gross_sales).toBe(s.revenue.total + s.sales_tax);
  });

  it("a store with no taxed sale has no taxable sales, and the consolidated figure is the sum", () => {
    const two = statementOf([nov.entities.get("est_2")!]);
    expect(two.taxable_sales).toBe(0);
    expect(two.exempt_sales).toBe(4000);
    const all = statementOf([...nov.entities.values()]);
    expect(all.taxable_sales).toBe(15000);
    expect(all.exempt_sales).toBe(38000);
    expect(statementDollars(all)).toMatchObject({ taxable_sales: 150, exempt_sales: 380, sales_tax: 12.38 });
  });

  it("an entity month built before the field existed counts as no taxable sales", () => {
    const e = { ...nov.entities.get("est_1")! };
    delete e.taxable_net_sales;
    expect(statementOf([e]).taxable_sales).toBe(0);
  });
});

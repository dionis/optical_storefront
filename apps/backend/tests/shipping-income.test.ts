import { ledgerOf, shippingCentsByOrder, statementDollars, statementOf, TAX_LINES, type LedgerFact, type LedgerInput } from "../src/lib/financial-statement";
import { computePnl } from "../src/lib/store-costs";
import { itemChargesOf } from "../src/lib/store-pnl";

/**
 * Delivery charged to the web's customers (13-nov-2026): a flat price the
 * owner SELLS the delivery at. It is income of the online store, next to its
 * sales — in the ledger, the statement and the store result — and the gateway
 * charged its fee on it too. Sales-tax figures stay about the goods.
 */
const fact = (o: Partial<LedgerFact>): LedgerFact => ({
  order_id: "o1",
  channel: "web",
  establishment_id: null,
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
  storeIds: ["est_1", "est_web"],
  activeStoreIds: ["est_1", "est_web"],
  tz: "UTC",
  web: false,
  onlineStoreId: "est_web",
  ...o,
});
const gateway = [
  { id: "r1", kind: "order_percent", match_key: "payment_fee", label: "Gateway", amount: 2.9, active: true },
  { id: "r2", kind: "payment_fixed", match_key: "gateway_fixed", label: "Gateway fixed", amount: 0.3, active: true },
] as unknown as LedgerInput["rules"];

describe("the order's shipping lines → cents per order", () => {
  it("sums the methods of the latest version, each once", () => {
    const by = shippingCentsByOrder([
      { order_id: "a", version: 1, method_id: "m1", amount: 28 },
      { order_id: "a", version: 2, method_id: "m1", amount: 30 },
      { order_id: "a", version: 2, method_id: "m1", amount: 30 },
      { order_id: "b", version: 1, method_id: "m2", amount: "30" },
      { order_id: "b", version: 1, method_id: "m3", amount: 4.5 },
      { order_id: "c", version: 1, method_id: "m4", amount: 0 },
      { order_id: "d", version: 1, method_id: "m5", amount: null },
    ]);
    expect(by.get("a")).toBe(3000);
    expect(by.get("b")).toBe(3450);
    expect(by.has("c")).toBe(false);
    expect(by.has("d")).toBe(false);
  });
});

describe("delivery charged is income of the online store", () => {
  const facts = [
    fact({ order_id: "w1", total_cents: 13500 }),
    fact({ order_id: "w2", total_cents: 8000, tax_cents: 500 }),
    fact({ order_id: "p1", channel: "pos", establishment_id: "est_1", total_cents: 20000 }),
  ];
  const shippingByOrder = new Map([["w1", 3000], ["w2", 3000], ["p1", 9999], ["gone", 3000]]);
  const [nov] = ledgerOf(input(facts, { shippingByOrder, rules: gateway }));
  const web = nov.entities.get("est_web")!;
  const till = nov.entities.get("est_1")!;

  it("is booked on the online store, order by order", () => {
    expect(web.shipping_income).toBe(6000);
    expect(web.net_sales).toBe(13500 + 7500);
  });

  it("a till sale never carries delivery, whatever the map says", () => {
    expect(till.shipping_income ?? 0).toBe(0);
  });

  it("the gateway fee is on what the customer paid: goods + delivery", () => {
    // w1: 2.9 % × (135 + 30) + 0.30 = 5.085 → 5.09 ; w2: 2.9 % × (80 + 30) + 0.30 = 3.49
    expect(web.payment_fees).toBe(Math.round(16500 * 0.029) + 30 + Math.round(11000 * 0.029) + 30);
  });

  it("the statement shows it as revenue of its own; sales-tax figures stay about the goods", () => {
    const s = statementOf([web]);
    expect(s.revenue.web).toBe(21000);
    expect(s.revenue.shipping).toBe(6000);
    expect(s.revenue.total).toBe(27000);
    expect(s.taxable_sales).toBe(7500);
    expect(s.exempt_sales).toBe(13500);
    expect(s.taxable_sales + s.exempt_sales).toBe(s.revenue.pos + s.revenue.web);
    expect(s.gross_profit).toBe(27000 - s.cogs.total_all);
    expect(s.net_income).toBe(27000 - s.cogs.total_all - s.opex.total);
    expect(statementDollars(s).revenue.shipping).toBe(60);
  });

  it("consolidated: the stores add up, delivery included once", () => {
    const all = statementOf([web, till]);
    expect(all.revenue).toEqual({ pos: 20000, web: 21000, shipping: 6000, total: 47000 });
  });

  it("without the map nothing changes (the books before 13-nov-2026)", () => {
    const [plain] = ledgerOf(input(facts, { rules: gateway }));
    const e = plain.entities.get("est_web")!;
    expect(e.shipping_income).toBeUndefined();
    expect(statementOf([e]).revenue).toEqual({ pos: 0, web: 21000, shipping: 0, total: 21000 });
    expect(e.payment_fees).toBe(Math.round(13500 * 0.029) + 30 + Math.round(8000 * 0.029) + 30);
  });

  it("has its line for the accountant: gross receipts", () => {
    expect(TAX_LINES.shipping_income).toEqual({ schedule_c: "1", f1120s: "1a" });
  });
});

describe("the store result counts the delivery as income", () => {
  it("contribution, margin and break-even are over sales + delivery", () => {
    const p = computePnl({ net_sales: 21000, shipping_income: 6000, cogs: 9000, payment_fees: 900, commissions: 0, variable_manual: 2400, fixed: 5000, shared: 1000 });
    expect(p.shipping_income).toBe(6000);
    expect(p.contribution).toBe(27000 - 9000 - 900 - 2400);
    expect(p.contribution_pct).toBe(54.4);
    expect(p.result).toBe(14700 - 6000);
    expect(p.break_even).toBe(Math.round(6000 / (14700 / 27000)));
  });

  it("a store with no delivery is exactly as before", () => {
    const before = computePnl({ net_sales: 21000, cogs: 9000, payment_fees: 900, commissions: 500, variable_manual: 100, fixed: 5000, shared: 1000 });
    expect(before.shipping_income).toBe(0);
    expect(before.contribution).toBe(21000 - 9000 - 1500);
    expect(before.contribution_pct).toBe(50);
    expect(before.result).toBe(10500 - 6000);
  });
});

describe("what each cost item charged each store this month", () => {
  it("lists the split of a shared item and merges repeated charges, in store order", () => {
    const entities = new Map([
      ["s2", { costs: [{ item_id: "shared", cents: 12687 }, { item_id: "bag", cents: 300 }] }],
      ["s1", { costs: [{ item_id: "shared", cents: 11421 }, { item_id: "rent", cents: 250000 }, { item_id: "rent", cents: 1 }, { item_id: "zero", cents: 0 }] }],
    ]);
    expect(itemChargesOf(entities, ["s1", "s2", "s3"])).toEqual({
      shared: [{ establishment_id: "s1", amount: 114.21 }, { establishment_id: "s2", amount: 126.87 }],
      rent: [{ establishment_id: "s1", amount: 2500.01 }],
      bag: [{ establishment_id: "s2", amount: 3 }],
    });
  });
});

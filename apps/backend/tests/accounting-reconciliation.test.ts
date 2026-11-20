import { buildCashReport, type MethodLike, type PaymentRow } from "../src/lib/cash-report";
import { computeCostSheet, lineGroup, type CostOrderLike, type CostRule } from "../src/lib/costing";
import { settlementFor, statementTotals, type StatementSale } from "../src/lib/pos-statement";
import { saleListRowOf, type SaleListRaw } from "../src/lib/sales-analytics";
import { attachSaleEconomics, buildInsights, lineEconomics, sumEconomicsByOrder, type EconomicsContext, type Figures, type InsightLine } from "../src/lib/sales-insights";
import { commissionsOf, sumFeesByStore, type CommissionFactLike, type FeeRowLike } from "../src/lib/store-pnl";
import { computePnl } from "../src/lib/store-costs";

/**
 * ONE month of ONE store, written once, read by every screen that shows money.
 *
 * The point of this file is not to re-check each formula (that is
 * tests/accounting-audit.test.ts) but to prove that the five screens answer the
 * SAME number wherever their definitions coincide, and to pin the places where
 * they legitimately differ so nobody "fixes" a real difference later.
 * docs/CONTABILIDAD.md explains every line of it in Spanish.
 *
 * October 2026, store Op1 (time zone UTC in the fixture), seller ANA at 10 %:
 *
 *   Op1-000001  frame + monofocal lenses, $150.00, no tax, cash in full
 *   Op1-000002  frame only, $100.00 + $7.00 of sales tax, one credit card
 *   Op1-000003  the customer's own frame + lenses, $120.00, paid across TWO
 *               methods ($50 cash + $30 card) plus $20 from the insurer,
 *               $20.00 still owed
 *   Op1-000004  VOIDED: $200.00 taken in cash and given back the same day
 */

const STORE = "est_1";
const TZ = "UTC";
const MONTH = "2026-10";

// ── The owner's cost rules ───────────────────────────────────────────────────

const rule = (kind: CostRule["kind"], match_key: string, amount: number, unit: CostRule["unit"] = "fixed"): CostRule => ({ kind, match_key, label: match_key, amount, unit, active: true, sort_order: 0 });
const RULES = [
  rule("frame_brand", "flexure", 20),
  rule("lens_design", "sv", 10),
  rule("order_fixed", "lab", 1),
  rule("order_percent", "payment_fee", 2.9, "percent"),
  rule("payment_fixed", "payment_fee_fixed", 0.3),
  rule("order_percent", "profit_target", 30, "percent"),
];
const COMMISSION_PCT = 10;

// ── sale_fact: one row per sold line ─────────────────────────────────────────

const fact = (over: Partial<InsightLine>): InsightLine => ({
  order_id: "order_1",
  sale_id: "poss_1",
  channel: "pos",
  establishment_id: STORE,
  terminal_id: "t1",
  seller_id: "u_ana",
  seller_code: "ANA",
  product_id: "p1",
  sku: "FX1",
  title: "Flexure 1",
  brand: "Flexure",
  brand_slug: "flexure",
  category: "frame",
  lens_design: "sv",
  // The fixture prices the lens by DESIGN only, so every material cost is defined
  // and no line is flagged as "cost still missing".
  lens_material: null,
  lens_photo: null,
  lens_ar: null,
  payment_methods: ["cash"],
  qty: 1,
  total_cents: 15000,
  tax_cents: 0,
  sold_date_local: "2026-10-05",
  hour: 15,
  ...over,
});

/** The live lines: a voided sale keeps its sale_fact rows but every report filters them out. */
const LINES: InsightLine[] = [
  fact({}),
  fact({ order_id: "order_2", sale_id: "poss_2", sku: "FX2", title: "Flexure 2", lens_design: null, lens_material: null, total_cents: 10700, tax_cents: 700, sold_date_local: "2026-10-06", payment_methods: ["credit"] }),
  fact({
    order_id: "order_3",
    sale_id: "poss_3",
    category: "own_frame",
    product_id: null,
    sku: null,
    brand: null,
    brand_slug: null,
    title: "own_frame",
    total_cents: 12000,
    tax_cents: 0,
    sold_date_local: "2026-10-07",
    payment_methods: ["cash", "credit", "insurance"],
  }),
];

/** Recorded fee of each till sale: what the card processor actually charged. */
const SALE_FEES = new Map([
  ["poss_1", 0], // cash
  ["poss_2", 340], // 2.9 % of 107.00 = 310 + 30 fixed
  ["poss_3", 117], // 2.9 % of the 30.00 card part = 87 + 30 fixed
  ["poss_4", 0], // the voided sale was cash
]);

/** pos_sale: what each till sale has collected and what it still owes. */
const SALE_CASH = new Map([
  ["poss_1", { paid: 15000, balance: 0 }],
  ["poss_2", { paid: 10700, balance: 0 }],
  ["poss_3", { paid: 8000, balance: 2000 }], // $50 cash + $30 card + $20 insurer, $20 owed
]);

const ORDERS = new Map([
  ["order_1", { gross: 15000, net: 15000, lines: 1 }],
  ["order_2", { gross: 10700, net: 10000, lines: 1 }],
  ["order_3", { gross: 12000, net: 12000, lines: 1 }],
]);

const ctx: EconomicsContext = { rules: RULES, orders: ORDERS, saleFees: SALE_FEES, saleCash: SALE_CASH, commissionPct: () => COMMISSION_PCT };

// ── 1. Ejecutivo / Panel de ventas ───────────────────────────────────────────

const ECON = lineEconomics(LINES, ctx);
const ZERO: Figures = { sales: 0, net: 0, tax: 0, cost: 0, fee: 0, commission: 0, profit: 0, margin_pct: null, paid: 0, balance: 0, count: 0, units: 0, avg_ticket: 0 };

const INSIGHTS = buildInsights({
  from: "2026-10-01",
  to: "2026-10-31",
  grain: "day",
  by: "seller",
  lines: LINES,
  econ: ECON,
  previous: ZERO,
  previousRange: { from: "2026-09-01", to: "2026-09-30" },
  labels: { store: () => null, sellerName: () => "Ana" },
  costRulesMissing: false,
  truncated: false,
});

describe("Ejecutivo: the per-sale money", () => {
  it("is what was charged, less the tax, the materials, the fee of the collection and the commission", () => {
    expect(ECON).toEqual([
      // 150.00 − (frame 20 + lens 10 + lab 1) − 0 of fee − 10 % of 150.00
      { net: 15000, cost: 3100, fee: 0, commission: 1500, profit: 10400, paid: 15000, balance: 0, missing_cost: false },
      // 107.00 − 7.00 of tax = 100.00 net; frame 20 + lab 1; the card cost 3.40
      { net: 10000, cost: 2100, fee: 340, commission: 1000, profit: 6560, paid: 10700, balance: 0, missing_cost: false },
      // The customer's own frame: only the lens and the lab; the card part cost 1.17
      { net: 12000, cost: 1100, fee: 117, commission: 1200, profit: 9583, paid: 8000, balance: 2000, missing_cost: false },
    ]);
  });

  it("totals the month in dollars, with the margin over the net", () => {
    expect(INSIGHTS.totals).toEqual({
      sales: 377, // 150.00 + 107.00 + 120.00
      net: 370, // less the 7.00 of sales tax
      tax: 7,
      cost: 63, // 31.00 + 21.00 + 11.00
      fee: 4.57,
      commission: 37,
      profit: 265.43, // 370 − 63 − 4.57 − 37
      margin_pct: 71.7, // 265.43 / 370
      paid: 337, // 150.00 + 107.00 + 80.00 taken in
      balance: 20, // only Op1-000003 still owes
      count: 3,
      units: 3,
      avg_ticket: 125.67, // 377.00 / 3
    });
  });

  it("the seller's row carries the whole month, because every sale is hers", () => {
    const ana = INSIGHTS.rows.find((r) => r.key === "ANA");
    expect(ana).toMatchObject({ label: "Ana", sales: 377, profit: 265.43, commission: 37, share: 100 });
  });

  it("the day series adds up to the month", () => {
    expect(INSIGHTS.series.reduce((s, p) => s + p.sales, 0)).toBeCloseTo(INSIGHTS.totals.sales, 2);
    expect(INSIGHTS.series.reduce((s, p) => s + p.profit, 0)).toBeCloseTo(INSIGHTS.totals.profit, 2);
    expect(INSIGHTS.series.reduce((s, p) => s + p.count, 0)).toBe(INSIGHTS.totals.count);
  });
});

// ── 2. Pedidos de la tienda (the list of sales) ──────────────────────────────

const raw = (over: Partial<SaleListRaw>): SaleListRaw => ({
  order_id: "order_1",
  sale_id: "poss_1",
  number: "Op1-000001",
  channel: "pos",
  establishment_id: STORE,
  seller_code: "ANA",
  customer_id: null,
  sold_at: "2026-10-05T18:00:00.000Z",
  total: 15000,
  discount: 0,
  units: 1,
  status: "active",
  items: "Flexure 1",
  frame_brand: "Flexure",
  frame_model: "Flexure 1",
  frame_sku: "FX1",
  frame_line_id: null,
  own_frame: false,
  has_rx: true,
  lens_design: "sv",
  lens_material: null,
  lens_photo: null,
  lens_ar: null,
  ...over,
});

const LIST = [
  saleListRowOf(raw({}), { sale: { paid_cents: 15000, balance_cents: 0 } }),
  saleListRowOf(raw({ order_id: "order_2", sale_id: "poss_2", number: "Op1-000002", total: 10700, frame_sku: "FX2", frame_model: "Flexure 2", lens_design: null, lens_material: null, has_rx: false }), { sale: { paid_cents: 10700, balance_cents: 0 } }),
  saleListRowOf(raw({ order_id: "order_3", sale_id: "poss_3", number: "Op1-000003", total: 12000, own_frame: true, frame_brand: null, frame_model: null, frame_sku: null }), { sale: { paid_cents: 8000, balance_cents: 2000 } }),
];
const WITH_ECONOMICS = attachSaleEconomics(LIST, sumEconomicsByOrder(LINES, ECON), { profit: true, commission: true });

describe("Pedidos de la tienda", () => {
  it("shows the money of each sale, straight out of the same lines as Ejecutivo", () => {
    expect(WITH_ECONOMICS.map((r) => [r.number, r.total, r.net, r.cost, r.fee, r.commission, r.profit, r.margin_pct])).toEqual([
      ["Op1-000001", 150, 150, 31, 0, 15, 104, 69.3],
      ["Op1-000002", 107, 100, 21, 3.4, 10, 65.6, 65.6],
      ["Op1-000003", 120, 120, 11, 1.17, 12, 95.83, 79.9],
    ]);
  });

  it("the collected and the owed of a till sale are the sale's own, not the line's", () => {
    expect(WITH_ECONOMICS.map((r) => [r.paid, r.balance])).toEqual([[150, 0], [107, 0], [80, 20]]);
  });

  it("a web order is paid in full when it is placed: no balance to chase", () => {
    const web = saleListRowOf(raw({ order_id: "order_w", sale_id: null, number: null, channel: "web", establishment_id: null, total: 9900 }), {});
    expect(web).toMatchObject({ total: 99, paid: 99, balance: 0 });
  });

  it("RECONCILES: the list adds up to the Executive KPIs of the same period", () => {
    const sum = (k: "total" | "net" | "cost" | "fee" | "commission" | "profit" | "paid" | "balance") => Math.round(WITH_ECONOMICS.reduce((s, r) => s + Number(r[k] ?? 0) * 100, 0));
    expect(sum("total")).toBe(Math.round(INSIGHTS.totals.sales * 100));
    expect(sum("net")).toBe(Math.round(INSIGHTS.totals.net * 100));
    expect(sum("cost")).toBe(Math.round(INSIGHTS.totals.cost * 100));
    expect(sum("fee")).toBe(Math.round(INSIGHTS.totals.fee * 100));
    expect(sum("commission")).toBe(Math.round(INSIGHTS.totals.commission * 100));
    expect(sum("profit")).toBe(Math.round(INSIGHTS.totals.profit * 100));
    // The till: the Executive KPIs must not need this list to know what came in.
    expect(sum("paid")).toBe(Math.round(INSIGHTS.totals.paid * 100));
    expect(sum("balance")).toBe(Math.round(INSIGHTS.totals.balance * 100));
    expect(WITH_ECONOMICS.length).toBe(INSIGHTS.totals.count);
  });
});

// ── 3. Estado de cuenta ──────────────────────────────────────────────────────

const pmt = (method_code: string, amount_cents: number, kind = "deposit", at = "2026-10-05T18:00:00.000Z") => ({ method_code, method: null, kind, amount_cents, reference: null, at });

const STATEMENT_SALES: StatementSale[] = [
  { id: "poss_1", number: "Op1-000001", store_code: "Op1", date: "2026-10-05T18:00:00.000Z", day: "2026-10-05", seller_code: "ANA", customer_name: null, delivery: "pickup", status: "completed", items: [], list_cents: 15000, discount_cents: 0, tax_cents: 0, total_cents: 15000, paid_cents: 15000, insurance_cents: 0, balance_cents: 0, payments: [pmt("cash", 15000)] },
  { id: "poss_2", number: "Op1-000002", store_code: "Op1", date: "2026-10-06T18:00:00.000Z", day: "2026-10-06", seller_code: "ANA", customer_name: null, delivery: "pickup", status: "completed", items: [], list_cents: 10000, discount_cents: 0, tax_cents: 700, total_cents: 10700, paid_cents: 10700, insurance_cents: 0, balance_cents: 0, payments: [pmt("credit", 10700, "deposit", "2026-10-06T18:00:00.000Z")] },
  { id: "poss_3", number: "Op1-000003", store_code: "Op1", date: "2026-10-07T18:00:00.000Z", day: "2026-10-07", seller_code: "ANA", customer_name: null, delivery: "pickup", status: "completed", items: [], list_cents: 12000, discount_cents: 0, tax_cents: 0, total_cents: 12000, paid_cents: 8000, insurance_cents: 2000, balance_cents: 2000, payments: [pmt("cash", 5000, "deposit", "2026-10-07T18:00:00.000Z"), pmt("credit", 3000, "deposit", "2026-10-07T18:01:00.000Z"), pmt("insurance", 2000, "deposit", "2026-10-07T18:02:00.000Z")] },
  // Voided: listed with its status, out of every total. `voidSale` zeroes its money columns.
  { id: "poss_4", number: "Op1-000004", store_code: "Op1", date: "2026-10-08T18:00:00.000Z", day: "2026-10-08", seller_code: "ANA", customer_name: null, delivery: "pickup", status: "voided", items: [], list_cents: 20000, discount_cents: 0, tax_cents: 0, total_cents: 20000, paid_cents: 0, insurance_cents: 0, balance_cents: 0, payments: [pmt("cash", 20000, "deposit", "2026-10-08T18:00:00.000Z"), pmt("cash", -20000, "refund", "2026-10-08T19:00:00.000Z")] },
];
const STATEMENT = statementTotals(STATEMENT_SALES);

describe("Estado de cuenta", () => {
  it("adds up the completed sales and counts the voided one apart", () => {
    expect(STATEMENT).toMatchObject({
      count: 3,
      voided_count: 1,
      list_cents: 37000,
      tax_cents: 700,
      total_cents: 37700,
      paid_cents: 33700,
      insurance_cents: 2000,
      balance_cents: 2000,
    });
  });

  it("a sale paid across two methods and an insurer lands in each one", () => {
    expect(STATEMENT.by_method.map((m) => [m.code, m.cents]).sort()).toEqual([
      ["cash", 20000], // 150.00 + 50.00 of the third sale
      ["credit", 13700], // 107.00 + 30.00
      ["insurance", 2000],
    ]);
    // The voided sale's cash and its refund cancel out: it adds nothing.
    expect(STATEMENT.by_method.reduce((s, m) => s + m.cents, 0)).toBe(STATEMENT.paid_cents + STATEMENT.insurance_cents);
  });

  it("every cut of the period adds up to the same grand total", () => {
    expect(STATEMENT.by_seller.reduce((s, r) => s + r.total_cents, 0)).toBe(STATEMENT.total_cents);
    expect(STATEMENT.by_day.reduce((s, r) => s + r.total_cents, 0)).toBe(STATEMENT.total_cents);
    expect(STATEMENT.balance_cents).toBe(STATEMENT.total_cents - STATEMENT.paid_cents - STATEMENT.insurance_cents);
  });

  it("RECONCILES: what was charged and the net are the Executive's", () => {
    expect(STATEMENT.total_cents).toBe(Math.round(INSIGHTS.totals.sales * 100));
    expect(STATEMENT.tax_cents).toBe(Math.round(INSIGHTS.totals.tax * 100));
    expect(STATEMENT.total_cents - STATEMENT.tax_cents).toBe(Math.round(INSIGHTS.totals.net * 100));
  });

  it("RECONCILES: the settlement base of a family store is that same net", () => {
    const s = settlementFor({ kind: "family", settlement_pct: 40 }, STATEMENT);
    expect(s).toEqual({ pct: 40, base_cents: 37000, amount_cents: 14800 });
    expect(s?.base_cents).toBe(Math.round(INSIGHTS.totals.net * 100));
  });

  it("RECONCILES: the owed of the statement is the owed of the sales list", () => {
    expect(STATEMENT.balance_cents).toBe(Math.round(WITH_ECONOMICS.reduce((s, r) => s + r.balance * 100, 0)));
  });
});

// ── 4. Caja ──────────────────────────────────────────────────────────────────

const METHODS: MethodLike[] = [
  { code: "cash", label: null, label_en: null, kind: "cash", counts_as_cash: true, builtin: true, receivable: false },
  { code: "credit", label: null, label_en: null, kind: "credit", counts_as_cash: false, builtin: true, receivable: false },
  { code: "insurance", label: null, label_en: null, kind: "insurance", counts_as_cash: false, builtin: true, receivable: true },
];

let seq = 0;
const row = (method_code: string, amount_cents: number, fee_cents: number, day: string, kind = "deposit"): PaymentRow => ({
  id: `pospay_${++seq}`,
  day,
  method_code,
  amount_cents,
  fee_cents,
  kind,
  counts_as_cash: method_code === "cash",
  received_by: "u_ana",
  establishment_id: STORE,
});

/** Exactly the rows pos_sale_payment holds for the month, the voided sale included. */
const PAYMENT_ROWS: PaymentRow[] = [
  row("cash", 15000, 0, "2026-10-05"),
  row("credit", 10700, 340, "2026-10-06"),
  row("cash", 5000, 0, "2026-10-07"),
  row("credit", 3000, 117, "2026-10-07"),
  row("insurance", 2000, 0, "2026-10-07"),
  row("cash", 20000, 0, "2026-10-08"),
  row("cash", -20000, 0, "2026-10-08", "refund"),
];

const CASH = buildCashReport({
  from: "2026-10-01",
  to: "2026-10-31",
  methods: METHODS,
  payments: PAYMENT_ROWS,
  // The drawer: the automatic lines mirror the cash payments and the refund,
  // plus one expense paid out of the till by hand.
  movements: [
    { id: "m1", at: "2026-10-05T13:00:00.000Z", day: "2026-10-05", session_id: "cash1", establishment_id: STORE, terminal_code: "Op1-POS1", kind: "in", category: "opening_float", amount_cents: 5000, note: null, created_by: "u_ana" },
    { id: "m2", at: "2026-10-05T18:00:00.000Z", day: "2026-10-05", session_id: "cash1", establishment_id: STORE, terminal_code: "Op1-POS1", kind: "in", category: "sale_payment", amount_cents: 15000, note: "Op1-000001", created_by: "u_ana" },
    { id: "m3", at: "2026-10-07T18:00:00.000Z", day: "2026-10-07", session_id: "cash1", establishment_id: STORE, terminal_code: "Op1-POS1", kind: "in", category: "sale_payment", amount_cents: 5000, note: "Op1-000003", created_by: "u_ana" },
    { id: "m4", at: "2026-10-08T18:00:00.000Z", day: "2026-10-08", session_id: "cash1", establishment_id: STORE, terminal_code: "Op1-POS1", kind: "in", category: "sale_payment", amount_cents: 20000, note: "Op1-000004", created_by: "u_ana" },
    { id: "m5", at: "2026-10-08T19:00:00.000Z", day: "2026-10-08", session_id: "cash1", establishment_id: STORE, terminal_code: "Op1-POS1", kind: "out", category: "sale_refund", amount_cents: 20000, note: "Op1-000004", created_by: "u_ana" },
    { id: "m6", at: "2026-10-09T10:00:00.000Z", day: "2026-10-09", session_id: "cash1", establishment_id: STORE, terminal_code: "Op1-POS1", kind: "out", category: "expense", amount_cents: 2500, note: "cleaning", created_by: "u_ana" },
  ],
  sessions: [],
});

describe("Caja", () => {
  it("summarises each method net of refunds and keeps the insurer out of the money collected", () => {
    expect(CASH.by_method.map((m) => [m.code, m.in_cents, m.refund_cents, m.net_cents, m.fee_cents])).toEqual([
      ["cash", 40000, 20000, 20000, 0],
      ["credit", 13700, 0, 13700, 457],
      ["insurance", 2000, 0, 2000, 0],
    ]);
    expect(CASH.totals).toMatchObject({
      payments_cents: 33700, // 20000 of cash + 13700 of card
      cash_payments_cents: 20000,
      card_cents: 13700,
      receivable_cents: 2000,
      movements_in_cents: 0, // the automatic lines are not added on top
      movements_out_cents: 2500,
      cash_net_cents: 20000 - 2500,
      fees_cents: 457,
    });
  });

  it("the per-day series reconciles with the by-method totals", () => {
    expect(CASH.series.reduce((s, d) => s + d.payments_cents, 0)).toBe(CASH.totals.payments_cents);
    expect(CASH.series.reduce((s, d) => s + d.cash_net_cents, 0)).toBe(CASH.totals.cash_net_cents);
    expect(CASH.series.reduce((s, d) => s + d.cash_out_cents, 0)).toBe(CASH.totals.movements_out_cents);
    expect(CASH.series.reduce((s, d) => s + d.cash_in_cents, 0)).toBe(CASH.totals.movements_in_cents);
  });

  it("RECONCILES: what the till took equals what the statement says was collected", () => {
    expect(CASH.totals.payments_cents).toBe(STATEMENT.paid_cents);
    expect(CASH.totals.receivable_cents).toBe(STATEMENT.insurance_cents);
    expect(CASH.totals.payments_cents + CASH.totals.receivable_cents).toBe(STATEMENT.by_method.reduce((s, m) => s + m.cents, 0));
  });

  it("RECONCILES: the fees of the till are the fees the Executive charged to the sales", () => {
    expect(CASH.totals.fees_cents).toBe(Math.round(INSIGHTS.totals.fee * 100));
  });

  it("DIFFERS on purpose: a voided sale moved real cash, so the drawer saw it and the sales did not", () => {
    const cash = CASH.by_method.find((m) => m.code === "cash");
    expect(cash?.in_cents).toBe(40000); // 150.00 + 50.00 + the 200.00 of the voided sale
    expect(cash?.net_cents).toBe(20000); // and 200.00 back out, so nothing was kept
    // No sale of the month is worth 200.00 any more: the void left no revenue.
    expect(INSIGHTS.totals.sales).toBe(377);
  });
});

// ── 5. Resultado por tienda ──────────────────────────────────────────────────

/** The cost of goods the way store-pnl.ts builds it: one sheet per sale, "material" lines only. */
function cogsOf(lines: InsightLine[]): number {
  let total = 0;
  for (const l of lines) {
    const order: CostOrderLike = {
      total: l.total_cents / 100,
      tax_total: l.tax_cents / 100,
      paid: true,
      items: [{ quantity: l.qty, sku: l.sku, brand_slug: l.brand_slug, lens: l.lens_design ? { design_code: l.lens_design, material_code: l.lens_material, photo_code: l.lens_photo, ar_code: l.lens_ar } : null }],
    };
    const sheet = computeCostSheet(order, RULES, null, null, null);
    total += sheet.lines.filter((x) => lineGroup(x) === "material").reduce((s, x) => s + Math.round(Number(x.subtotal) * 100), 0);
  }
  return total;
}

const FEE_ROWS: FeeRowLike[] = [
  { establishment_id: STORE, fee_cents: 0, created_at: "2026-10-05T18:00:00.000Z", sale_status: "completed" },
  { establishment_id: STORE, fee_cents: 340, created_at: "2026-10-06T18:00:00.000Z", sale_status: "completed" },
  { establishment_id: STORE, fee_cents: 117, created_at: "2026-10-07T18:01:00.000Z", sale_status: "completed" },
  // The voided sale's payment: its fee is not a cost of the month either.
  { establishment_id: STORE, fee_cents: 0, created_at: "2026-10-08T18:00:00.000Z", sale_status: "voided" },
];

const COMMISSION_FACTS: CommissionFactLike[] = LINES.map((l) => ({ establishment_id: l.establishment_id, seller_id: l.seller_id, seller_code: l.seller_code, net: l.total_cents - l.tax_cents }));

const PNL = computePnl({
  net_sales: LINES.reduce((s, l) => s + l.total_cents - l.tax_cents, 0),
  cogs: cogsOf(LINES),
  payment_fees: sumFeesByStore(FEE_ROWS, MONTH, TZ).get(STORE) ?? 0,
  commissions: commissionsOf(COMMISSION_FACTS, () => COMMISSION_PCT).byStore.get(STORE) ?? 0,
  variable_manual: 0,
  // Rent of 1,200.00 and a share of 300.00 of the chain's shared costs.
  fixed: 120000,
  shared: 30000,
});

describe("Resultado por tienda", () => {
  it("the month's result is the contribution less the fixed costs", () => {
    expect(PNL).toMatchObject({
      net_sales: 37000,
      cogs: 6300,
      payment_fees: 457,
      commissions: 3700,
      variable_total: 4157,
      contribution: 26543,
      fixed_total: 150000,
      result: 26543 - 150000,
    });
  });

  it("the break-even point is the fixed costs over the contribution margin", () => {
    const fraction = PNL.contribution / PNL.net_sales;
    expect(PNL.contribution_pct).toBe(Math.round(fraction * 1000) / 10);
    expect(PNL.break_even).toBe(Math.round(PNL.fixed_total / fraction));
    // Selling that much would leave exactly the fixed costs on the table.
    expect((PNL.break_even as number) * fraction).toBeCloseTo(PNL.fixed_total, 0);
  });

  it("RECONCILES: net sales, cost of goods, fees and commissions are the Executive's", () => {
    expect(PNL.net_sales).toBe(Math.round(INSIGHTS.totals.net * 100));
    expect(PNL.cogs).toBe(Math.round(INSIGHTS.totals.cost * 100));
    expect(PNL.payment_fees).toBe(Math.round(INSIGHTS.totals.fee * 100));
    expect(PNL.commissions).toBe(Math.round(INSIGHTS.totals.commission * 100));
  });

  it("RECONCILES: the contribution IS the gross profit of the Executive", () => {
    expect(PNL.contribution).toBe(Math.round(INSIGHTS.totals.profit * 100));
  });

  it("DIFFERS on purpose: the result also carries the rent, which no sale, hour or product can carry", () => {
    expect(PNL.result).not.toBe(Math.round(INSIGHTS.totals.profit * 100));
    expect(PNL.contribution - PNL.result).toBe(PNL.fixed_total);
  });

  it("DIFFERS on purpose: the owner's % items and the profit target never become a cost", () => {
    // `profit_target` (30 %) is a goal and `payment_fee` is already counted as
    // the recorded fee: neither may be added again on top of the P&L.
    const sheet = computeCostSheet({ total: 150, tax_total: 0, paid: true, items: [{ quantity: 1, sku: "FX1", brand_slug: "flexure", lens: { design_code: "sv" } }] }, RULES, null, null);
    expect(sheet.lines.some((l) => l.match_key === "profit_target")).toBe(false);
    expect(sheet.profit_target_pct).toBe(30);
  });
});

// ── 6. The whole month in one assertion ──────────────────────────────────────

describe("the month closes", () => {
  it("charged = net + tax, and net = profit + cost + fee + commission", () => {
    const t = INSIGHTS.totals;
    expect(Math.round(t.net * 100) + Math.round(t.tax * 100)).toBe(Math.round(t.sales * 100));
    expect(Math.round(t.cost * 100) + Math.round(t.fee * 100) + Math.round(t.commission * 100) + Math.round(t.profit * 100)).toBe(Math.round(t.net * 100));
  });

  it("charged = collected + owed by the customer + owed by the insurer", () => {
    expect(STATEMENT.total_cents).toBe(STATEMENT.paid_cents + STATEMENT.balance_cents + STATEMENT.insurance_cents);
    expect(STATEMENT.paid_cents).toBe(CASH.totals.payments_cents);
    expect(STATEMENT.insurance_cents).toBe(CASH.totals.receivable_cents);
  });
});

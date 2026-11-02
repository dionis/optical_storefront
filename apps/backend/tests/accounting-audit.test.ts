import { cashDocumentOf } from "../src/lib/cash-documents";
import { buildCashReport, type MethodLike, type MovementAggRow, type MovementRow, type PaymentRow, type SessionRow } from "../src/lib/cash-report";
import { expectedCash, ledgerTotals, type CashSessionView, type MovementView } from "../src/lib/cash";
import type { CostRule } from "../src/lib/costing";
import { allocateCents, lineEconomics, type EconomicsContext, type InsightLine } from "../src/lib/sales-insights";
import { applyFilter, type AnalyticsFilter } from "../src/lib/sales-analytics";
import { groupSellerStats, netRevenueOf, type StatOrder } from "../src/lib/sellers";
import { commissionsOf, sumFeesByStore, type CommissionFactLike, type FeeRowLike } from "../src/lib/store-pnl";
import { statementTotals, settlementFor, type StatementSale } from "../src/lib/pos-statement";
import { aggregateSales, periodRanges } from "../src/lib/start-map";
import type { LineEconomics } from "../src/lib/sales-insights";

/**
 * Accounting audit (2026-11): one test per defect found in the financial
 * figures, each with the expectation computed by hand in the comment. Every
 * amount is in integer cents, as the server keeps money.
 *
 * The cross-screen identities live in tests/accounting-reconciliation.test.ts;
 * docs/CONTABILIDAD.md carries the formulas and the open questions.
 */

// ── Rules and lines shared by the cases ──────────────────────────────────────

const rule = (kind: CostRule["kind"], match_key: string, amount: number, unit: CostRule["unit"] = "fixed"): CostRule => ({
  kind,
  match_key,
  label: match_key,
  amount,
  unit,
  active: true,
  sort_order: 0,
});

/** frame $20, monofocal lens $10, $1 of lab per order, gateway 3 % + $0.30, 10 % rent, 30 % target. */
const RULES = [
  rule("frame_brand", "flexure", 20),
  rule("lens_design", "sv", 10),
  rule("order_fixed", "lab", 1),
  rule("order_percent", "payment_fee", 3, "percent"),
  rule("payment_fixed", "payment_fee_fixed", 0.3),
  rule("order_percent", "rent", 10, "percent"),
  rule("order_percent", "profit_target", 30, "percent"),
];

const line = (over: Partial<InsightLine> = {}): InsightLine => ({
  order_id: "o1",
  sale_id: "s1",
  channel: "pos",
  establishment_id: "est_1",
  terminal_id: "t1",
  seller_id: "u1",
  seller_code: "ANA",
  product_id: "p1",
  sku: "FX1",
  title: "Flex 1",
  brand: "Flexure",
  brand_slug: "flexure",
  category: "frame",
  lens_design: "sv",
  lens_material: null,
  lens_photo: null,
  lens_ar: null,
  payment_methods: ["cash"],
  qty: 1,
  total_cents: 10000,
  tax_cents: 0,
  sold_date_local: "2026-10-27",
  hour: 15,
  ...over,
});

const ctx = (over: Partial<EconomicsContext> = {}): EconomicsContext => ({
  rules: RULES,
  orders: new Map([["o1", { gross: 10000, net: 10000, lines: 1 }]]),
  saleFees: new Map([["s1", 0]]),
  commissionPct: () => 0,
  ...over,
});

// ── allocateCents ────────────────────────────────────────────────────────────

describe("allocateCents", () => {
  it("splits a whole amount with nothing lost and nothing invented", () => {
    // 100 ¢ over weights 3333 / 3333 / 3334: 33.33 / 33.33 / 33.34 →
    // floors 33+33+33 = 99, the last cent to the biggest remainder (.34).
    expect(allocateCents(100, [3333, 3333, 3334])).toEqual([33, 33, 34]);
    // Rounding each part on its own would have given 33+33+33 = 99 ¢.
    expect(allocateCents(100, [3333, 3333, 3334]).reduce((s, v) => s + v, 0)).toBe(100);
  });

  it("splits one cent, ties going to the first line so the answer is stable", () => {
    expect(allocateCents(1, [5000, 5000])).toEqual([1, 0]);
    expect(allocateCents(2, [5000, 5000])).toEqual([1, 1]);
  });

  it("falls back to equal parts when every weight is zero, and still adds up", () => {
    expect(allocateCents(10, [0, 0, 0])).toEqual([4, 3, 3]);
    expect(allocateCents(10, [0, 0, 0]).reduce((s, v) => s + v, 0)).toBe(10);
  });

  it("keeps the sign of a negative amount (a refund) and handles the empty and zero cases", () => {
    expect(allocateCents(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(allocateCents(0, [1, 2])).toEqual([0, 0]);
    expect(allocateCents(500, [])).toEqual([]);
  });
});

// ── lineEconomics ────────────────────────────────────────────────────────────

describe("lineEconomics: the per-order money is charged once and adds up", () => {
  it("splits the recorded fee and the fixed costs of a three-line sale to the cent", () => {
    const lines = [
      line({ total_cents: 3333 }),
      line({ total_cents: 3333, sku: "FX2" }),
      line({ total_cents: 3334, sku: "FX3" }),
    ];
    const econ = lineEconomics(lines, ctx({ orders: new Map([["o1", { gross: 10000, net: 10000, lines: 3 }]]), saleFees: new Map([["s1", 1000]]) }));
    // The fee recorded with the sale's payments is $10.00 and belongs to the
    // whole sale: 333 + 333 + 334 = 1000, never 999.
    expect(econ.map((e) => e.fee)).toEqual([333, 333, 334]);
    expect(econ.reduce((s, e) => s + e.fee, 0)).toBe(1000);
    // $1.00 of lab per order, and $30.00 of materials on each line (frame + lens).
    expect(econ.map((e) => e.cost)).toEqual([3033, 3033, 3034]);
    expect(econ.reduce((s, e) => s + e.cost, 0)).toBe(3000 * 3 + 100);
  });

  it("charges a filtered line only its share of the sale, as before", () => {
    // Half the net of the sale: half the $4.00 fee and half the $1.00 of lab.
    const econ = lineEconomics([line({ total_cents: 5000 })], ctx({ orders: new Map([["o1", { gross: 10000, net: 10000, lines: 2 }]]), saleFees: new Map([["s1", 400]]) }));
    expect(econ[0]).toMatchObject({ net: 5000, fee: 200, cost: 3000 + 50 });
  });

  it("a sale given away (100 % discount) splits the fixed costs by line, never divides by zero", () => {
    const lines = [line({ total_cents: 0 }), line({ total_cents: 0, sku: "FX2" })];
    const econ = lineEconomics(lines, ctx({ orders: new Map([["o1", { gross: 0, net: 0, lines: 2 }]]), saleFees: new Map([["s1", 0]]) }));
    expect(econ.map((e) => e.net)).toEqual([0, 0]);
    // $1.00 of lab split in two, the materials still spent: the sale is a loss.
    expect(econ.map((e) => e.cost)).toEqual([3050, 3050]);
    expect(econ.map((e) => e.profit)).toEqual([-3050, -3050]);
    expect(econ.every((e) => Number.isFinite(e.cost) && Number.isFinite(e.profit))).toBe(true);
  });

  it("a web order pays the gateway on what was charged, the fixed fee only once", () => {
    const lines = [
      line({ order_id: "w1", sale_id: null, channel: "web", total_cents: 6000 }),
      line({ order_id: "w1", sale_id: null, channel: "web", total_cents: 4000, sku: "FX2" }),
    ];
    const econ = lineEconomics(lines, ctx({ orders: new Map([["w1", { gross: 10000, net: 10000, lines: 2 }]]), saleFees: new Map() }));
    // 3 % of $100.00 = $3.00, plus $0.30 fixed = 330 ¢ for the whole order.
    expect(econ.reduce((s, e) => s + e.fee, 0)).toBe(330);
    expect(econ.map((e) => e.fee)).toEqual([198, 132]);
  });

  it("the customer's own frame has no frame cost and is not flagged as missing one", () => {
    const own = line({ order_id: "o2", sale_id: "s2", category: "own_frame", sku: null, brand_slug: null, product_id: null, total_cents: 8000 });
    const [e] = lineEconomics([own], ctx({ orders: new Map([["o2", { gross: 8000, net: 8000, lines: 1 }]]), saleFees: new Map([["s2", 0]]) }));
    // Only the $10 lens and the $1 of lab: no frame was sold.
    expect(e).toMatchObject({ net: 8000, cost: 1100, missing_cost: false });
  });

  it("the commission is a percentage of the NET, not of what was charged", () => {
    const [e] = lineEconomics([line({ total_cents: 10700, tax_cents: 700 })], ctx({ commissionPct: () => 10 }));
    // net = 10700 − 700 = 10000 → 10 % = 1000, not 1070.
    expect(e).toMatchObject({ net: 10000, commission: 1000 });
  });
});

// ── Voided sales are out of every figure ─────────────────────────────────────

/** Records what `applyFilter` asks the database, so the exclusion rules can be pinned without one. */
function recorder() {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const q: Record<string, (...args: unknown[]) => unknown> = {};
  for (const fn of ["whereNull", "whereBetween", "where", "whereIn", "whereRaw", "orWhere", "orWhereIn", "orWhereRaw"]) {
    q[fn] = (...args: unknown[]) => {
      calls.push({ fn, args });
      if (typeof args[0] === "function") (args[0] as (w: unknown) => void)(q);
      return q;
    };
  }
  return { q, calls };
}

describe("applyFilter: what never reaches a financial figure", () => {
  const base: AnalyticsFilter = { from: "2026-10-01", to: "2026-10-31", stores: null };

  it("drops deleted rows and voided sales, and only counts the local days asked for", () => {
    const { q, calls } = recorder();
    applyFilter(q as never, base);
    expect(calls).toEqual(
      expect.arrayContaining([
        { fn: "whereNull", args: ["sale_fact.deleted_at"] },
        { fn: "whereBetween", args: ["sale_fact.sold_date_local", ["2026-10-01", "2026-10-31"]] },
        { fn: "where", args: ["sale_fact.status", "active"] },
      ])
    );
  });

  it("keeps the voided ones only when they are asked for by name", () => {
    const { q, calls } = recorder();
    applyFilter(q as never, { ...base, includeVoided: true });
    expect(calls.some((c) => c.fn === "where" && c.args[0] === "sale_fact.status")).toBe(false);
  });
});

// ── store-pnl: payment fees ──────────────────────────────────────────────────

describe("sumFeesByStore", () => {
  const fee = (over: Partial<FeeRowLike>): FeeRowLike => ({ establishment_id: "est_1", fee_cents: 350, created_at: "2026-10-15T18:00:00.000Z", sale_status: "completed", ...over });

  it("leaves out the fee of a voided sale: its sales are out of the month too", () => {
    const fees = sumFeesByStore([fee({}), fee({ fee_cents: 1160, sale_status: "voided" })], "2026-10", "UTC");
    expect(fees.get("est_1")).toBe(350);
  });

  it("uses the LOCAL day, so the last night of the month is not lost or borrowed", () => {
    // 2026-11-01 02:00 UTC is still 2026-10-31 22:00 in New York.
    const late = fee({ created_at: "2026-11-01T02:00:00.000Z" });
    // 2026-10-01 02:00 UTC is 2026-09-30 22:00 in New York: September's.
    const early = fee({ created_at: "2026-10-01T02:00:00.000Z", fee_cents: 999 });
    const fees = sumFeesByStore([late, early], "2026-10", "America/New_York");
    expect(fees.get("est_1")).toBe(350);
  });

  it("adds up per store and ignores a payment with no store", () => {
    const fees = sumFeesByStore([fee({}), fee({ establishment_id: "est_2", fee_cents: 100 }), fee({ establishment_id: null })], "2026-10", "UTC");
    expect([...fees.entries()].sort()).toEqual([["est_1", 350], ["est_2", 100]]);
  });
});

// ── store-pnl: commissions ───────────────────────────────────────────────────

describe("commissionsOf", () => {
  const fact = (over: Partial<CommissionFactLike>): CommissionFactLike => ({ establishment_id: "est_1", seller_id: "u1", seller_code: "ANA", net: 10000, ...over });

  it("pays the profile's percentage, and falls back to the seller record like Ejecutivo does", () => {
    const pct = (f: CommissionFactLike) => (f.seller_id === "u1" ? 10 : f.seller_code === "REF" ? 5 : null);
    const { sellers, byStore } = commissionsOf(
      [fact({}), fact({ seller_id: null, seller_code: "REF", net: 20000 })],
      pct
    );
    // A referral seller with no panel user earned 5 % of $200.00 = $10.00, which
    // the old version booked as zero in the store result.
    expect(sellers.map((s) => [s.seller_code, s.net_sales, s.pct, s.commission])).toEqual([
      ["ANA", 100, 10, 10],
      ["REF", 200, 5, 10],
    ]);
    expect(byStore.get("est_1")).toBe(1000 + 1000);
  });

  it("a line with no seller earns nothing and shows no percentage", () => {
    const { sellers, byStore } = commissionsOf([fact({ seller_id: null, seller_code: null })], () => 10);
    expect(sellers).toEqual([{ seller_id: null, seller_code: null, net_sales: 100, pct: null, commission: 0 }]);
    expect(byStore.size).toBe(0);
  });

  it("splits one seller's commission between the stores they sold in", () => {
    const { byStore } = commissionsOf([fact({}), fact({ establishment_id: "est_2", net: 5000 })], () => 10);
    expect(byStore.get("est_1")).toBe(1000);
    expect(byStore.get("est_2")).toBe(500);
  });
});

// ── sellers: the commission base ─────────────────────────────────────────────

describe("seller commissions are a percentage of the net", () => {
  const sellers = [{ id: "s1", code: "ANA", name: "Ana", commission_pct: 10, active: true }];
  const order = (over: Partial<StatOrder> = {}): StatOrder => ({ seller_code: "ANA", total: 107, tax_total: 7, shipping_total: 0, terminal: null, created_at: "2026-10-01T10:00:00Z", ...over });

  it("takes the sales tax and the shipping out of the base", () => {
    expect(netRevenueOf({ total: 107, tax_total: 7, shipping_total: 0 })).toBe(100);
    expect(netRevenueOf({ total: 120, tax_total: 7, shipping_total: 13 })).toBe(100);
    expect(netRevenueOf({ total: 100 })).toBe(100);
    expect(netRevenueOf({ total: 0, tax_total: 5 })).toBe(0);
  });

  it("pays 10 % of $100.00, not of the $107.00 the customer handed over", () => {
    const { sellers: rows } = groupSellerStats([order()], sellers);
    expect(rows[0]).toMatchObject({ revenue: 107, net_revenue: 100, commission: 10 });
  });

  it("the shipping of a web order is the courier's, not the seller's", () => {
    const { sellers: rows } = groupSellerStats([order({ total: 120, tax_total: 7, shipping_total: 13 })], sellers);
    expect(rows[0]).toMatchObject({ revenue: 120, net_revenue: 100, commission: 10 });
  });

  it("a canceled order earns nobody anything", () => {
    const { sellers: rows } = groupSellerStats([order(), order({ total: 1000, terminal: "canceled" as never })], sellers);
    expect(rows[0]).toMatchObject({ orders: 1, revenue: 107, net_revenue: 100, commission: 10 });
  });
});

// ── Cash report ──────────────────────────────────────────────────────────────

const METHODS: MethodLike[] = [
  { code: "cash", label: null, label_en: null, kind: "cash", counts_as_cash: true, builtin: true, receivable: false },
  { code: "credit", label: null, label_en: null, kind: "credit", counts_as_cash: false, builtin: true, receivable: false },
  // The owner unticked "counts as cash" on Zelle AFTER the money went in the drawer.
  { code: "zelle", label: null, label_en: null, kind: "zelle", counts_as_cash: false, builtin: true, receivable: false },
  { code: "insurance", label: null, label_en: null, kind: "insurance", counts_as_cash: false, builtin: true, receivable: true },
];

let seq = 0;
const pay = (over: Partial<PaymentRow>): PaymentRow => ({
  id: `p${++seq}`,
  day: "2026-10-05",
  method_code: "cash",
  amount_cents: 10000,
  fee_cents: 0,
  kind: "deposit",
  counts_as_cash: true,
  received_by: "u1",
  establishment_id: "est_1",
  ...over,
});
const mv = (over: Partial<MovementRow>): MovementRow => ({
  id: `m${++seq}`,
  at: "2026-10-05T15:00:00.000Z",
  day: "2026-10-05",
  session_id: "cash1",
  establishment_id: "est_1",
  terminal_code: "Op1-POS1",
  kind: "out",
  category: "expense",
  amount_cents: 2000,
  note: null,
  created_by: "u1",
  ...over,
});
const ses = (over: Partial<SessionRow> = {}): SessionRow => ({
  id: "cash1",
  establishment_id: "est_1",
  terminal_code: "Op1-POS1",
  opened_at: "2026-10-05T13:00:00.000Z",
  closed_at: "2026-10-05T23:00:00.000Z",
  opening_cents: 5000,
  expected_cents: 13000,
  counted_cents: 13000,
  diff_cents: 0,
  note: null,
  ...over,
});

describe("buildCashReport", () => {
  it("counts as cash what the TILL recorded as cash, so the series and the totals agree", () => {
    const r = buildCashReport({
      from: "2026-10-01",
      to: "2026-10-31",
      methods: METHODS,
      // The row says this Zelle payment went into the drawer; the method's flag
      // says it does not any more. The drawer is what has to be counted.
      payments: [pay({ method_code: "zelle", amount_cents: 4000, counts_as_cash: true })],
      movements: [],
      sessions: [],
    });
    expect(r.totals.cash_payments_cents).toBe(4000);
    expect(r.totals.other_cents).toBe(0);
    expect(r.series.reduce((s, d) => s + d.cash_net_cents, 0)).toBe(r.totals.cash_net_cents);
  });

  it("a refund is money leaving, whichever sign it was stored with", () => {
    const negative = buildCashReport({ from: "2026-10-01", to: "2026-10-31", methods: METHODS, payments: [pay({ method_code: "credit", amount_cents: 15000 }), pay({ method_code: "credit", amount_cents: -15000, kind: "refund" })], movements: [], sessions: [] });
    const positive = buildCashReport({ from: "2026-10-01", to: "2026-10-31", methods: METHODS, payments: [pay({ method_code: "credit", amount_cents: 15000 }), pay({ method_code: "credit", amount_cents: 15000, kind: "refund" })], movements: [], sessions: [] });
    for (const r of [negative, positive]) {
      expect(r.by_method[0]).toMatchObject({ in_cents: 15000, refund_cents: 15000, net_cents: 0 });
      expect(r.totals.payments_cents).toBe(0);
      expect(r.totals.card_cents).toBe(0);
    }
  });

  it("the insurer's part is listed, never counted as collected", () => {
    const r = buildCashReport({ from: "2026-10-01", to: "2026-10-31", methods: METHODS, payments: [pay({ method_code: "insurance", amount_cents: 12000, counts_as_cash: false })], movements: [], sessions: [] });
    expect(r.totals).toMatchObject({ receivable_cents: 12000, payments_cents: 0, cash_payments_cents: 0, cash_net_cents: 0 });
    expect(r.series).toEqual([]);
  });

  it("keeps cash in / cash out complete when the movement LIST is capped", () => {
    // The list only brought two of the month's lines; the aggregate has them all.
    const agg: MovementAggRow[] = [
      { day: "2026-10-05", kind: "out", category: "expense", count: 400, cents: 800000 },
      { day: "2026-10-06", kind: "in", category: "change_fund", count: 2, cents: 5000 },
      { day: "2026-10-06", kind: "in", category: "sale_payment", count: 900, cents: 9000000 },
    ];
    const r = buildCashReport({
      from: "2026-10-01",
      to: "2026-10-31",
      methods: METHODS,
      payments: [pay({ amount_cents: 9000000, day: "2026-10-06" })],
      movements: [mv({}), mv({ kind: "in", category: "change_fund", amount_cents: 2500 })],
      sessions: [],
      truncated: true,
      movementAgg: agg,
    });
    expect(r.truncated).toBe(true);
    expect(r.totals.movements_out_cents).toBe(800000);
    expect(r.totals.movements_in_cents).toBe(5000);
    expect(r.totals.cash_net_cents).toBe(9000000 + 5000 - 800000);
    // The automatic lines are still only listed, never added on top of the payments.
    expect(r.by_category.find((c) => c.category === "sale_payment")).toMatchObject({ count: 900, cents: 9000000 });
    expect(r.series.reduce((s, d) => s + d.cash_net_cents, 0)).toBe(r.totals.cash_net_cents);
    // The list itself stays as it came, capped.
    expect(r.movements).toHaveLength(2);
  });

  it("falls back to the list when no aggregate is given (the pure callers)", () => {
    const r = buildCashReport({ from: "2026-10-01", to: "2026-10-31", methods: METHODS, payments: [], movements: [mv({}), mv({ kind: "in", category: "change_fund", amount_cents: 2500 })], sessions: [] });
    expect(r.totals).toMatchObject({ movements_out_cents: 2000, movements_in_cents: 2500 });
  });

  it("adds up the differences of the closings of the period", () => {
    const r = buildCashReport({ from: "2026-10-01", to: "2026-10-31", methods: METHODS, payments: [], movements: [], sessions: [ses({ diff_cents: -500 }), ses({ id: "cash2", diff_cents: 200 })] });
    expect(r.totals.sessions_diff_cents).toBe(-300);
  });
});

// ── The closing document ─────────────────────────────────────────────────────

const movement = (over: Partial<MovementView>): MovementView => ({
  id: `v${++seq}`,
  session_id: "cash1",
  kind: "in",
  amount: 0,
  amount_cents: 0,
  category: "sale_payment",
  auto: true,
  note: null,
  created_by: "u1",
  by: { id: "u1", name: "Ana", code: "ANA" },
  created_at: "2026-10-05T15:00:00.000Z",
  sale_id: "poss_1",
  payment_id: "pospay_1",
  terminal_id: "t1",
  terminal_code: "Op1-POS1",
  ...over,
});

describe("cashDocumentOf", () => {
  // opening 50.00 + payments 120.00 − refunds 20.00 + manual in 10.00 − manual out 30.00 = 130.00
  const movements: MovementView[] = [
    movement({ category: "opening_float", amount_cents: 5000, amount: 50 }),
    movement({ category: "sale_payment", amount_cents: 8000, amount: 80 }),
    movement({ category: "sale_payment", amount_cents: 4000, amount: 40, terminal_id: "t2", terminal_code: "Op1-POS2" }),
    movement({ category: "sale_refund", kind: "out", amount_cents: 2000, amount: 20 }),
    movement({ category: "change_fund", kind: "in", amount_cents: 1000, amount: 10, auto: false, note: "coins" }),
    movement({ category: "expense", kind: "out", amount_cents: 3000, amount: 30, auto: false, note: "paper" }),
  ];
  const session: CashSessionView = {
    id: "cash1",
    establishment_id: "est_1",
    terminal_id: null,
    status: "closed",
    opened_by: "u1",
    opened_by_person: { id: "u1", name: "Ana", code: "ANA" },
    opened_at: "2026-10-05T13:00:00.000Z",
    opened_signature: "AG",
    opening_note: null,
    opening: 50,
    closed_at: "2026-10-05T23:00:00.000Z",
    closed_by: "u1",
    closed_by_person: { id: "u1", name: "Ana", code: "ANA" },
    closed_signature: "AG",
    expected: 130,
    counted: 130,
    diff: 0,
    note: null,
    approval_signature: null,
    approved_by: null,
    approved_by_person: null,
    approved_at: null,
    cash_in_sales: 100,
    cash_payments_count: 2,
    refunds: 20,
    manual_in: 10,
    manual_out: 30,
    movements,
  };

  it("the ledger closes: opening + payments − refunds + in − out = expected", () => {
    const expected = expectedCash(5000, movements.map((m) => ({ kind: m.kind, amount: m.amount_cents, category: m.category })));
    expect(expected).toBe(13000);
    const t = ledgerTotals(movements.map((m) => ({ kind: m.kind, amount_cents: m.amount_cents, category: m.category })));
    expect(5000 + t.cash_payments - t.refunds + t.manual_in - t.manual_out).toBe(expected);
  });

  it("prints exactly the session's figures, nothing recomputed behind its back", () => {
    const doc = cashDocumentOf(session, { id: "est_1", code: "Op1", name: "Óptica 1" }, "close", new Date("2026-10-06T00:00:00.000Z"));
    expect(doc.totals).toEqual({
      opening_cents: 5000,
      cash_payments_count: 2,
      cash_payments_cents: 12000,
      refunds_count: 1,
      refunds_cents: 2000,
      manual_in_cents: 1000,
      manual_out_cents: 3000,
      expected_cents: 13000,
      counted_cents: 13000,
      diff_cents: 0,
    });
    expect(doc.session.expected_cents).toBe(Math.round(session.expected * 100));
    expect(doc.session.counted_cents).toBe(Math.round((session.counted as number) * 100));
    expect(doc.session.diff_cents).toBe(Math.round((session.diff as number) * 100));
    // The identity again, this time off the printed document.
    const t = doc.totals;
    expect(t.opening_cents + t.cash_payments_cents - t.refunds_cents + t.manual_in_cents - t.manual_out_cents).toBe(t.expected_cents);
  });

  it("splits the net cash of the sales by till and by whoever took it, the float out of both", () => {
    const doc = cashDocumentOf(session, { id: "est_1", code: "Op1", name: "Óptica 1" }, "close");
    expect(doc.by_terminal.map((t) => [t.code, t.cents])).toEqual([["Op1-POS1", 8000 - 2000], ["Op1-POS2", 4000]]);
    expect(doc.by_seller.map((s) => s.cents)).toEqual([12000 - 2000]);
    expect(doc.manual.map((m) => [m.kind, m.category, m.cents, m.notes])).toEqual([
      ["in", "change_fund", 1000, ["coins"]],
      ["out", "expense", 3000, ["paper"]],
    ]);
  });
});

// ── The statement ────────────────────────────────────────────────────────────

const sale = (over: Partial<StatementSale> = {}): StatementSale => ({
  id: "poss_1",
  number: "Op1-000001",
  store_code: "Op1",
  date: "2026-10-05T18:00:00.000Z",
  day: "2026-10-05",
  seller_code: "ANA",
  customer_name: "Cliente",
  delivery: "pickup",
  status: "completed",
  items: [],
  list_cents: 10000,
  discount_cents: 0,
  tax_cents: 0,
  total_cents: 10000,
  paid_cents: 10000,
  insurance_cents: 0,
  balance_cents: 0,
  payments: [{ method_code: "cash", method: null, kind: "deposit", amount_cents: 10000, reference: null, at: "2026-10-05T18:00:00.000Z" }],
  ...over,
});

describe("statementTotals", () => {
  const sales = [
    sale(),
    // A sale with a deposit, an insurer's part and a balance still owed.
    sale({
      id: "poss_2",
      number: "Op1-000002",
      day: "2026-10-06",
      seller_code: "LUIS",
      total_cents: 30000,
      tax_cents: 0,
      paid_cents: 10000,
      insurance_cents: 15000,
      balance_cents: 5000,
      payments: [
        { method_code: "cash", method: null, kind: "deposit", amount_cents: 10000, reference: null, at: "2026-10-06T18:00:00.000Z" },
        { method_code: "insurance", method: null, kind: "deposit", amount_cents: 15000, reference: null, at: "2026-10-06T18:05:00.000Z" },
      ],
    }),
    // Voided: listed, but out of every total.
    sale({ id: "poss_3", number: "Op1-000003", status: "voided", total_cents: 99900, paid_cents: 0, insurance_cents: 0, balance_cents: 0, payments: [] }),
  ];

  it("lists the voided sale and leaves it out of every figure but its count", () => {
    const t = statementTotals(sales);
    expect(t).toMatchObject({ count: 2, voided_count: 1, total_cents: 40000, paid_cents: 20000, insurance_cents: 15000, balance_cents: 5000 });
  });

  it("by_seller and by_day each add up to the grand total", () => {
    const t = statementTotals(sales);
    expect(t.by_seller.reduce((s, r) => s + r.total_cents, 0)).toBe(t.total_cents);
    expect(t.by_day.reduce((s, r) => s + r.total_cents, 0)).toBe(t.total_cents);
    expect(t.by_seller.reduce((s, r) => s + r.count, 0)).toBe(t.count);
  });

  it("by_method adds up to what the till received: the customer's money AND the insurer's", () => {
    const t = statementTotals(sales);
    expect(t.by_method.reduce((s, r) => s + r.cents, 0)).toBe(t.paid_cents + t.insurance_cents);
    expect(t.balance_cents).toBe(t.total_cents - t.paid_cents - t.insurance_cents);
  });

  it("nets a refund out of its method", () => {
    const t = statementTotals([
      sale({
        payments: [
          { method_code: "cash", method: null, kind: "deposit", amount_cents: 10000, reference: null, at: "2026-10-05T18:00:00.000Z" },
          { method_code: "cash", method: null, kind: "refund", amount_cents: 2500, reference: null, at: "2026-10-05T19:00:00.000Z" },
        ],
      }),
    ]);
    expect(t.by_method).toEqual([{ code: "cash", label: null, cents: 7500 }]);
  });

  it("the settlement is a percentage of the net of the completed sales only", () => {
    const t = statementTotals([sale({ total_cents: 10700, tax_cents: 700 }), sale({ id: "poss_9", status: "voided", total_cents: 50000, tax_cents: 0 })]);
    // (10700 − 700) × 40 % = 4000
    expect(settlementFor({ kind: "family", settlement_pct: 40 }, t)).toEqual({ pct: 40, base_cents: 10000, amount_cents: 4000 });
    expect(settlementFor({ kind: "own", settlement_pct: 40 }, t)).toBeNull();
    expect(settlementFor({ kind: "family", settlement_pct: null }, t)).toBeNull();
  });
});

// ── The start map ────────────────────────────────────────────────────────────

describe("aggregateSales", () => {
  const pr = periodRanges("2026-11-04", 3); // Wednesday
  const l = (over: Partial<InsightLine>) => line({ sold_date_local: "2026-11-04", tax_cents: 0, ...over });
  const e = (over: Partial<LineEconomics>): LineEconomics => ({ net: 10000, cost: 3000, fee: 200, commission: 500, profit: 6300, missing_cost: false, ...over });

  it("carries the payment fee apart as well as inside the cost, so Ejecutivo can be reconciled", () => {
    const { periods } = aggregateSales([l({ order_id: "a" }), l({ order_id: "b", sku: "FX2" })], [e({}), e({ fee: 350 })], pr, { profit: true, commission: true });
    expect(periods.today.fee_cents).toBe(550);
    // The map's "cost" is the Executive's cost PLUS its fee: 6000 + 550.
    expect(periods.today.cost_cents).toBe(6550);
    expect(periods.today.profit_cents).toBe(12600);
  });

  it("hides cost, fee and commission from whoever may not see them", () => {
    const { periods } = aggregateSales([l({ order_id: "a" })], [e({})], pr, { profit: false, commission: false });
    expect(periods.today).toMatchObject({ sales_cents: 10000, cost_cents: null, fee_cents: null, profit_cents: null, commission_cents: null });
  });
});

import { CASH_CATEGORIES, expectedCash, isCashCategory } from "../src/lib/cash";
import { buildCashReport, nextDay, type MethodLike, type MovementRow, type PaymentRow, type SessionRow } from "../src/lib/cash-report";
import { isAllowedForRestrictedRole } from "../src/lib/staff-roles";

const METHODS: MethodLike[] = [
  { code: "debit", label: null, label_en: null, kind: "debit", counts_as_cash: false, builtin: true, receivable: false },
  { code: "credit", label: null, label_en: null, kind: "credit", counts_as_cash: false, builtin: true, receivable: false },
  { code: "zelle", label: null, label_en: null, kind: "zelle", counts_as_cash: false, builtin: true, receivable: false },
  { code: "cash", label: null, label_en: null, kind: "cash", counts_as_cash: true, builtin: true, receivable: false },
  { code: "insurance", label: null, label_en: null, kind: "insurance", counts_as_cash: false, builtin: true, receivable: true },
  { code: "venmo", label: "Venmo tienda", label_en: "Store Venmo", kind: "other", counts_as_cash: false, builtin: false, receivable: false },
];

let seq = 0;
const pay = (over: Partial<PaymentRow>): PaymentRow => ({
  id: `p${++seq}`,
  day: "2026-10-05",
  method_code: "cash",
  amount_cents: 10000,
  fee_cents: 0,
  kind: "deposit",
  counts_as_cash: false,
  received_by: "u1",
  establishment_id: "est1",
  ...over,
});
const mv = (over: Partial<MovementRow>): MovementRow => ({
  id: `m${++seq}`,
  at: "2026-10-05T15:00:00.000Z",
  day: "2026-10-05",
  session_id: "cash1",
  establishment_id: "est1",
  terminal_code: "Op1-POS1",
  kind: "out",
  category: "expense",
  amount_cents: 2000,
  note: "paper",
  created_by: "u1",
  ...over,
});
const ses = (over: Partial<SessionRow>): SessionRow => ({
  id: "cash1",
  establishment_id: "est1",
  terminal_code: "Op1-POS1",
  opened_at: "2026-10-05T13:00:00.000Z",
  closed_at: "2026-10-05T23:00:00.000Z",
  opening_cents: 5000,
  expected_cents: 13000,
  counted_cents: 12500,
  diff_cents: -500,
  note: null,
  ...over,
});

describe("cash movement categories", () => {
  it("accepts the fixed list only", () => {
    for (const c of CASH_CATEGORIES) expect(isCashCategory(c)).toBe(true);
    expect(isCashCategory("")).toBe(false);
    expect(isCashCategory("petty cash")).toBe(false);
    expect(isCashCategory(null)).toBe(false);
  });

  it("expected cash still ignores the category", () => {
    expect(expectedCash(5000, [10000], [{ kind: "out", amount: 2000 }])).toBe(13000);
  });
});

describe("buildCashReport", () => {
  const report = () =>
    buildCashReport({
      from: "2026-10-01",
      to: "2026-10-31",
      methods: METHODS,
      people: [{ id: "u1", name: "Ana García", code: "ANA" }],
      payments: [
        pay({ method_code: "cash", amount_cents: 10000, counts_as_cash: true }),
        pay({ method_code: "cash", amount_cents: 3000, counts_as_cash: true, kind: "balance", day: "2026-10-06" }),
        pay({ method_code: "debit", amount_cents: 20000, fee_cents: 350 }),
        pay({ method_code: "credit", amount_cents: 15000, fee_cents: 480 }),
        pay({ method_code: "credit", amount_cents: -15000, kind: "refund", day: "2026-10-07" }),
        pay({ method_code: "zelle", amount_cents: 8000 }),
        pay({ method_code: "venmo", amount_cents: 1000, received_by: "u2" }),
        pay({ method_code: "insurance", amount_cents: 12000 }),
      ],
      movements: [
        mv({ kind: "in", category: "change_fund", amount_cents: 5000, note: "coins" }),
        mv({ kind: "out", category: "expense", amount_cents: 2000 }),
        mv({ kind: "out", category: "expense", amount_cents: 1500, day: "2026-10-06", at: "2026-10-06T15:00:00.000Z", created_by: "u2" }),
        mv({ kind: "out", category: "supplier_payment", amount_cents: 7000, day: "2026-10-06", at: "2026-10-06T16:00:00.000Z" }),
        mv({ kind: "out", category: null, amount_cents: 100, note: "old row", created_by: null }),
      ],
      sessions: [ses({}), ses({ id: "cash2", opened_at: "2026-10-06T13:00:00.000Z", closed_at: null, expected_cents: null, counted_cents: null, diff_cents: null })],
    });

  it("summarises each method with refunds and fees, receivables apart", () => {
    const r = report();
    const by = Object.fromEntries(r.by_method.map((m) => [m.code, m]));
    expect(r.by_method.map((m) => m.code)).toEqual(["debit", "credit", "zelle", "cash", "insurance", "venmo"]);
    expect(by.cash).toMatchObject({ in_count: 2, in_cents: 13000, refund_cents: 0, net_cents: 13000, counts_as_cash: true });
    expect(by.credit).toMatchObject({ in_count: 1, in_cents: 15000, refund_cents: 15000, fee_cents: 480, net_cents: 0 });
    expect(by.insurance).toMatchObject({ receivable: true, net_cents: 12000 });
    expect(by.venmo.label).toEqual({ es: "Venmo tienda", en: "Store Venmo" });
    expect(r.totals).toEqual({
      payments_cents: 13000 + 20000 + 0 + 8000 + 1000,
      cash_payments_cents: 13000,
      card_cents: 20000,
      other_cents: 9000,
      receivable_cents: 12000,
      movements_in_cents: 5000,
      movements_out_cents: 10600,
      cash_net_cents: 13000 + 5000 - 10600,
      fees_cents: 830,
      sessions_diff_cents: -500,
    });
  });

  it("groups the manual movements by reason and lists them newest first with who", () => {
    const r = report();
    expect(r.by_category).toEqual([
      { category: "supplier_payment", kind: "out", count: 1, cents: 7000 },
      { category: "expense", kind: "out", count: 2, cents: 3500 },
      { category: null, kind: "out", count: 1, cents: 100 },
      { category: "change_fund", kind: "in", count: 1, cents: 5000 },
    ]);
    expect(r.movements[0]).toMatchObject({ category: "supplier_payment", at: "2026-10-06T16:00:00.000Z", by: { id: "u1", name: "Ana García", code: "ANA" } });
    expect(r.movements.find((m) => m.note === "old row")?.by).toBeNull();
    // An unknown user keeps its id so nothing is hidden.
    expect(r.movements.find((m) => m.amount_cents === 1500)?.by).toEqual({ id: "u2", name: "u2", code: null });
    expect(r.people.map((p) => p.id)).toEqual(["u1", "u2"]);
  });

  it("builds the per-day series from payments and movements", () => {
    const r = report();
    expect(r.series).toEqual([
      { date: "2026-10-05", payments_cents: 10000 + 20000 + 15000 + 8000 + 1000, cash_in_cents: 5000, cash_out_cents: 2100, cash_net_cents: 10000 + 5000 - 2100 },
      { date: "2026-10-06", payments_cents: 3000, cash_in_cents: 0, cash_out_cents: 8500, cash_net_cents: 3000 - 8500 },
      { date: "2026-10-07", payments_cents: -15000, cash_in_cents: 0, cash_out_cents: 0, cash_net_cents: 0 },
    ]);
    expect(r.sessions.map((s) => s.id)).toEqual(["cash2", "cash1"]);
    expect(r.sessions[0].diff_cents).toBeNull();
  });

  it("is empty, not broken, without rows", () => {
    const r = buildCashReport({ from: "2026-10-01", to: "2026-10-31", methods: METHODS, payments: [], movements: [], sessions: [] });
    expect(r.by_method).toEqual([]);
    expect(r.series).toEqual([]);
    expect(r.totals.cash_net_cents).toBe(0);
    expect(r.truncated).toBe(false);
  });

  it("nextDay crosses months and years", () => {
    expect(nextDay("2026-10-31")).toBe("2026-11-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });
});

describe("restricted roles reach the cash report", () => {
  it("GET /admin/pos/cash-report is allow-listed", () => {
    expect(isAllowedForRestrictedRole("GET", "/admin/pos/cash-report?from=2026-10-01&to=2026-10-31")).toBe(true);
  });
});

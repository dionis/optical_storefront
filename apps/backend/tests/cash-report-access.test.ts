import { redactCashReport, type CashReport } from "../src/lib/cash-report";

/**
 * The payment processor's charge is a cost: money the store loses on every
 * card. A seller opens this screen to reconcile their own till, so the number
 * must not reach them — and it must not reach them as a zero either, which
 * would read as "this costs nothing".
 */
const report = (): CashReport =>
  ({
    from: "2026-10-01",
    to: "2026-10-31",
    by_method: [
      { code: "card", label: { es: "Tarjeta", en: "Card" }, builtin: true, kind: "card", counts_as_cash: false, receivable: false, in_count: 9, in_cents: 120_00, refund_cents: 0, fee_cents: 3_48, net_cents: 120_00 },
      { code: "cash", label: { es: "Efectivo", en: "Cash" }, builtin: true, kind: "cash", counts_as_cash: true, receivable: false, in_count: 4, in_cents: 60_00, refund_cents: 0, fee_cents: 0, net_cents: 60_00 },
    ],
    movements: [],
    by_category: [],
    sessions: [],
    series: [],
    totals: { fees_cents: 3_48 } as CashReport["totals"],
    people: [],
    truncated: false,
  }) as unknown as CashReport;

describe("redactCashReport", () => {
  it("hands the charge to a caller who may see costs, and says so", () => {
    const out = redactCashReport(report(), true);
    expect(out.access).toEqual({ fees: true });
    expect(out.by_method.map((m) => m.fee_cents)).toEqual([3_48, 0]);
    expect(out.totals.fees_cents).toBe(3_48);
  });

  it("takes it out for everyone else, as null and never as zero", () => {
    const out = redactCashReport(report(), false);
    expect(out.access).toEqual({ fees: false });
    expect(out.by_method.map((m) => m.fee_cents)).toEqual([null, null]);
    expect(out.totals.fees_cents).toBeNull();
    // A zero would print "$0.00" and read as "the card costs the store nothing".
    expect(out.by_method.some((m) => m.fee_cents === 0)).toBe(false);
  });

  it("leaves the till itself untouched — what was collected is theirs to see", () => {
    const out = redactCashReport(report(), false);
    expect(out.by_method.map((m) => m.in_cents)).toEqual([120_00, 60_00]);
    expect(out.by_method.map((m) => m.net_cents)).toEqual([120_00, 60_00]);
    expect(out.movements).toEqual([]);
  });

  it("does not mutate the report it was given", () => {
    const original = report();
    redactCashReport(original, false);
    expect(original.by_method[0].fee_cents).toBe(3_48);
    expect(original.totals.fees_cents).toBe(3_48);
  });
});

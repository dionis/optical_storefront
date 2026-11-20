import { cleanCorrectionMeta, isCustomerPayment, paymentsStamp, planPaymentCorrection, type StoredPayment } from "../src/lib/payment-correction";
import type { PaymentMethodLike } from "../src/lib/pos";

/**
 * Correcting the payments of a sale (owner, 15-nov-2026): «si pongo que se
 * cobró 250 de anticipo y fue total, debe poderse resolver».
 */
const methods: PaymentMethodLike[] = [
  { code: "cash", is_active: true, receivable: false, kind: "cash", counts_as_cash: true },
  { code: "card", is_active: true, receivable: false, kind: "card", fee_pct: 3, fee_fixed_cents: 10, reference_fields: [{ key: "last4", required: true }] },
  { code: "zelle", is_active: true, receivable: false, kind: "transfer", establishment_ids: ["est_2"] },
  { code: "old", is_active: false, receivable: false, kind: "other" },
  { code: "ins", is_active: true, receivable: true, kind: "insurance" },
];
const row = (o: Partial<StoredPayment>): StoredPayment => ({
  id: "p1",
  method_code: "cash",
  amount_cents: 25000,
  reference: null,
  details: {},
  kind: "deposit",
  fee_cents: 0,
  counts_as_cash: true,
  establishment_id: "est_1",
  cash_session_id: "cash_1",
  ...o,
});
const sale = { total_cents: 48000, insurance_cents: 0, establishment_id: "est_1" };
const plan = (stored: StoredPayment[], input: unknown, s = sale) => planPaymentCorrection(stored, input, methods, s);

describe("why the payments are corrected", () => {
  it("takes a reason from the list, and a note (required with «other»)", () => {
    expect(cleanCorrectionMeta({ reason: "wrong_amount" })).toEqual({ why: "wrong_amount", note: null });
    expect(cleanCorrectionMeta({ reason: "duplicate", note: "  dos veces  " })).toEqual({ why: "duplicate", note: "dos veces" });
    expect(cleanCorrectionMeta({ reason: "other" })).toEqual({ reason: "correction_note_required" });
    expect(cleanCorrectionMeta({ reason: "nope" })).toEqual({ reason: "bad_correction_reason" });
    expect(cleanCorrectionMeta({ reason: "other", note: "x".repeat(501) })).toEqual({ reason: "note_too_long" });
  });
});

describe("planning a correction", () => {
  it("the owner's case: $250 recorded as a deposit, the patient paid the whole $480 in cash", () => {
    const p = plan([row({})], [{ id: "p1", method_code: "cash", amount: 480 }]);
    if ("reason" in p) throw new Error(p.reason);
    expect(p.update).toHaveLength(1);
    expect(p.update[0].after).toMatchObject({ method_code: "cash", amount_cents: 48000, counts_as_cash: true });
    expect(p.paid_cents).toBe(48000);
    expect(p.balance_cents).toBe(0);
    expect(p.before_paid_cents).toBe(25000);
    // $230 more entered the drawer than was recorded
    expect(p.cash).toEqual([{ establishment_id: "est_1", cents: 23000 }]);
  });

  it("cash that was really a card: the cash leaves the drawer, the card takes its fee", () => {
    const p = plan([row({})], [{ id: "p1", method_code: "card", amount: 250, details: { last4: "4242" } }]);
    if ("reason" in p) throw new Error(p.reason);
    expect(p.update[0].after).toMatchObject({ method_code: "card", amount_cents: 25000, counts_as_cash: false, fee_cents: 760, reference: "4242" });
    expect(p.cash).toEqual([{ establishment_id: "est_1", cents: -25000 }]);
    expect(p.paid_cents).toBe(25000);
  });

  it("a card needs its reference", () => {
    expect(plan([row({})], [{ id: "p1", method_code: "card", amount: 250 }])).toEqual({ reason: "missing_reference", method: "card" });
  });

  it("a payment recorded twice: the copy goes, the drawer gives it back", () => {
    const p = plan([row({}), row({ id: "p2", kind: "balance" })], [{ id: "p1", method_code: "cash", amount: 250 }]);
    if ("reason" in p) throw new Error(p.reason);
    expect(p.remove.map((r) => r.id)).toEqual(["p2"]);
    expect(p.keep.map((r) => r.id)).toEqual(["p1"]);
    expect(p.paid_cents).toBe(25000);
    expect(p.cash).toEqual([{ establishment_id: "est_1", cents: -25000 }]);
  });

  it("a payment that was never recorded is added: the deposit when nothing else is one", () => {
    const p = plan([], [{ method_code: "card", amount: 100, details: { last4: "1111" } }]);
    if ("reason" in p) throw new Error(p.reason);
    expect(p.add).toEqual([expect.objectContaining({ method_code: "card", amount_cents: 10000, kind: "deposit" })]);
    expect(p.cash).toEqual([]);
    const q = plan([row({})], [{ id: "p1", method_code: "cash", amount: 250 }, { method_code: "cash", amount: 100 }]);
    if ("reason" in q) throw new Error(q.reason);
    expect(q.add[0].kind).toBe("balance");
    expect(q.cash).toEqual([{ establishment_id: "est_1", cents: 10000 }]);
  });

  it("never more than the total less the insurer's part", () => {
    expect(plan([row({})], [{ id: "p1", method_code: "cash", amount: 480.01 }])).toEqual({ reason: "overpaid", max: 48000 });
    const insured = { ...sale, insurance_cents: 8000 };
    expect(plan([row({})], [{ id: "p1", method_code: "cash", amount: 480 }], insured)).toEqual({ reason: "overpaid", max: 40000 });
  });

  it("the insurer's row is shown, never changed or removed here", () => {
    const ins = row({ id: "pi", method_code: "ins", counts_as_cash: false, amount_cents: 8000 });
    const p = plan([row({}), ins], [{ id: "p1", method_code: "cash", amount: 400 }], { ...sale, insurance_cents: 8000 });
    if ("reason" in p) throw new Error(p.reason);
    expect(p.fixed.map((r) => r.id)).toEqual(["pi"]);
    expect(p.remove).toEqual([]);
    expect(p.balance_cents).toBe(0);
    expect(plan([row({}), ins], [{ id: "pi", method_code: "cash", amount: 80 }])).toEqual({ reason: "payment_not_editable" });
    expect(plan([row({})], [{ method_code: "ins", amount: 10 }])).toEqual({ reason: "payment_not_editable", method: "ins" });
  });

  it("a row sent back as it was stays as it was, even if its method is now switched off", () => {
    const old = row({ method_code: "old", counts_as_cash: false });
    const p = plan([old, row({ id: "p2" })], [{ id: "p1", method_code: "old", amount: 250 }, { id: "p2", method_code: "cash", amount: 200 }]);
    if ("reason" in p) throw new Error(p.reason);
    expect(p.keep.map((r) => r.id)).toEqual(["p1"]);
    expect(p.update.map((u) => u.before.id)).toEqual(["p2"]);
  });

  it("refuses what makes no sense", () => {
    expect(plan([row({})], [{ id: "p1", method_code: "cash", amount: 250 }])).toEqual({ reason: "no_changes" });
    expect(plan([row({})], [{ id: "zz", method_code: "cash", amount: 250 }])).toEqual({ reason: "unknown_payment" });
    expect(plan([row({})], [{ id: "p1", method_code: "cash", amount: 250 }, { id: "p1", method_code: "cash", amount: 1 }])).toEqual({ reason: "bad_payment" });
    expect(plan([row({})], [{ id: "p1", method_code: "cash", amount: 0 }])).toEqual({ reason: "bad_payment", method: "cash" });
    expect(plan([row({})], [{ id: "p1", method_code: "zelle", amount: 250 }])).toEqual({ reason: "bad_method", method: "zelle" });
    expect(plan([row({})], "nope")).toEqual({ reason: "bad_payment" });
    expect(plan([row({})], Array.from({ length: 13 }, () => ({ method_code: "cash", amount: 1 })))).toEqual({ reason: "bad_payment" });
  });

  it("removing every payment leaves the whole total owed and the cash out of the drawer", () => {
    const p = plan([row({})], []);
    if ("reason" in p) throw new Error(p.reason);
    expect(p.paid_cents).toBe(0);
    expect(p.balance_cents).toBe(48000);
    expect(p.cash).toEqual([{ establishment_id: "est_1", cents: -25000 }]);
  });

  it("cash goes back to the drawer of the store where it was received (a sale moved to another store)", () => {
    const moved = { ...sale, establishment_id: "est_2" };
    const p = plan([row({})], [{ id: "p1", method_code: "cash", amount: 300 }, { method_code: "cash", amount: 50 }], moved);
    if ("reason" in p) throw new Error(p.reason);
    expect(p.cash).toEqual([{ establishment_id: "est_1", cents: 5000 }, { establishment_id: "est_2", cents: 5000 }]);
  });

  it("a cash row with the change it gave keeps the amount, not what was tendered", () => {
    const p = plan([row({})], [{ id: "p1", method_code: "cash", amount: 480, details: { tendered: 500 } }]);
    if ("reason" in p) throw new Error(p.reason);
    expect(p.update[0].after).toMatchObject({ amount_cents: 48000, details: { tendered_cents: 50000, change_cents: 2000 } });
  });
});

describe("which rows are the customer's", () => {
  it("not the insurer's, not refunds", () => {
    expect(isCustomerPayment({ kind: "deposit", method_code: "cash" }, methods)).toBe(true);
    expect(isCustomerPayment({ kind: "balance", method_code: "gone" }, methods)).toBe(true);
    expect(isCustomerPayment({ kind: "refund", method_code: "cash" }, methods)).toBe(false);
    expect(isCustomerPayment({ kind: "deposit", method_code: "ins" }, methods)).toBe(false);
  });

  it("the stamp changes when a row changes, not when the order does", () => {
    const a = [row({}), row({ id: "p2", amount_cents: 100 })];
    expect(paymentsStamp(a)).toBe(paymentsStamp([...a].reverse()));
    expect(paymentsStamp(a)).not.toBe(paymentsStamp([row({}), row({ id: "p2", amount_cents: 101 })]));
  });
});

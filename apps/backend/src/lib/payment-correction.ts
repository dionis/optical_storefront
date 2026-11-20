/**
 * CORRECTING THE PAYMENTS OF A SALE (owner, 15-nov-2026): «debo poder enmendar
 * los problemas de registro, por ejemplo si pongo que se cobró 250 de anticipo
 * y fue total […] fundamental con los pagos».
 *
 * Until now a payment, once written, could only be added to («cobrar») or
 * wiped with the whole sale («anular»). A clerk who typed $250 as a deposit
 * when the patient paid the full $480, who picked «efectivo» for a card, or
 * who recorded the same payment twice had no way to fix it.
 *
 * The person sends the list of the sale's customer payments AS THEY SHOULD BE:
 * the rows they keep (with their `id`), changed or not, and new rows without
 * one. A stored row that is missing from the list is removed. This file works
 * out, without touching anything, what that means:
 *
 *   - which rows stay as they are, which change (method, amount, reference),
 *     which go and which are added;
 *   - what the customer has paid afterwards and what is still owed — never
 *     more than the total less the insurer's part (`overpaid`);
 *   - how much CASH moves, store by store: a payment that was cash and is now
 *     card took money out of the drawer that was never there. That difference
 *     becomes a «correction» line in the store's open register
 *     (lib/payment-correction-data.ts), never an edit of a register already
 *     closed and signed.
 *
 * What it never touches: the insurer's part (it has its own claim) and
 * refunds (a voided sale is not corrected). A changed row gets the fee of its
 * method as it is today; a row left as it was keeps the fee it was recorded
 * with («later fee edits never change it»).
 *
 * Pure: exported for the tests.
 */
import { acceptedAt, cleanPayments, type PaymentMethodLike } from "./pos";

export const CORRECTION_REASONS = ["wrong_amount", "wrong_method", "duplicate", "not_received", "missing", "other"] as const;
export type CorrectionReason = (typeof CORRECTION_REASONS)[number];
export const CORRECTION_NOTE_MAX = 500;
/** More rows than any real sale has; past it the request is malformed. */
export const MAX_CORRECTED_ROWS = 12;

/** A payment row as stored (cents). */
export interface StoredPayment {
  id: string;
  method_code: string;
  amount_cents: number;
  reference: string | null;
  details: Record<string, unknown> | null;
  kind: string;
  fee_cents: number;
  counts_as_cash: boolean;
  establishment_id: string | null;
  cash_session_id: string | null;
}

/** What a corrected or new row becomes (cents). */
export interface CorrectedRow {
  method_code: string;
  amount_cents: number;
  reference: string | null;
  details: Record<string, string | number>;
  fee_cents: number;
  counts_as_cash: boolean;
}

export interface CorrectionPlan {
  /** Rows left exactly as they were. */
  keep: StoredPayment[];
  update: Array<{ before: StoredPayment; after: CorrectedRow }>;
  remove: StoredPayment[];
  add: Array<CorrectedRow & { kind: "deposit" | "balance" }>;
  /** Insurer rows: shown, never changed here. */
  fixed: StoredPayment[];
  before_paid_cents: number;
  paid_cents: number;
  balance_cents: number;
  /** Cash that has to enter (+) or leave (−) each store's drawer to match. */
  cash: Array<{ establishment_id: string; cents: number }>;
}

export interface SaleTotals {
  total_cents: number;
  insurance_cents: number;
  establishment_id: string;
}

/** Why the payments are corrected: a reason from the list, and a note (required with «other»). */
export function cleanCorrectionMeta(body: { reason?: unknown; note?: unknown }): { reason: string } | { why: CorrectionReason; note: string | null } {
  const why = String(body.reason ?? "");
  if (!(CORRECTION_REASONS as readonly string[]).includes(why)) return { reason: "bad_correction_reason" };
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > CORRECTION_NOTE_MAX) return { reason: "note_too_long" };
  if (why === "other" && !note) return { reason: "correction_note_required" };
  return { why: why as CorrectionReason, note: note || null };
}

/** A row the customer paid (not the insurer, not a refund). */
export function isCustomerPayment(p: Pick<StoredPayment, "kind" | "method_code">, methods: readonly PaymentMethodLike[]): boolean {
  if (p.kind !== "deposit" && p.kind !== "balance") return false;
  const m = methods.find((x) => x.code === p.method_code);
  return !(m && (m.kind === "insurance" || m.receivable));
}

const sameRow = (a: StoredPayment, b: CorrectedRow): boolean => a.method_code === b.method_code && a.amount_cents === b.amount_cents && (a.reference ?? null) === (b.reference ?? null);

/** cents of a raw `amount` in dollars, or NaN. */
const centsOf = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
};

/**
 * What correcting the sale's customer payments to `input` means. `stored` are
 * the sale's live payment rows; `input` the list the person sent.
 */
export function planPaymentCorrection(
  stored: readonly StoredPayment[],
  input: unknown,
  methods: readonly PaymentMethodLike[],
  sale: SaleTotals
): { reason: string; method?: string; max?: number } | CorrectionPlan {
  if (!Array.isArray(input)) return { reason: "bad_payment" };
  if (input.length > MAX_CORRECTED_ROWS) return { reason: "bad_payment" };
  const editable = stored.filter((p) => isCustomerPayment(p, methods));
  const fixed = stored.filter((p) => !isCustomerPayment(p, methods));
  const byId = new Map(editable.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const keep: StoredPayment[] = [];
  const update: CorrectionPlan["update"] = [];
  const fresh: CorrectedRow[] = [];

  for (const raw of input as Array<{ id?: unknown; method_code?: unknown; amount?: unknown; details?: unknown }>) {
    const id = raw?.id == null || raw.id === "" ? null : String(raw.id);
    const before = id ? byId.get(id) : undefined;
    if (id && !before) return { reason: fixed.some((p) => p.id === id) ? "payment_not_editable" : "unknown_payment" };
    if (id && seen.has(id)) return { reason: "bad_payment" };
    if (id) seen.add(id);
    const method = String(raw?.method_code ?? "");
    const cents = centsOf(raw?.amount);
    // Sent back exactly as stored (no new details): it stays, whatever happened
    // to its method since (switched off in the store, a new fee).
    if (before && method === before.method_code && cents === before.amount_cents && raw?.details === undefined) {
      keep.push(before);
      continue;
    }
    const establishmentId = before?.establishment_id || sale.establishment_id;
    const m = methods.find((x) => x.code === method);
    // A method may stay on a row it was already on even if the store no longer offers it.
    const usable = m && (acceptedAt(m, establishmentId) || (before && before.method_code === method && m.is_active)) ? [{ ...m, establishment_ids: null }] : methods;
    const cleaned = cleanPayments([{ method_code: method, amount: raw?.amount, details: raw?.details }], Number.MAX_SAFE_INTEGER, usable as PaymentMethodLike[], { establishmentId, allowInsurance: false });
    if ("reason" in cleaned) return cleaned.reason === "insurance_at_sale_only" ? { reason: "payment_not_editable", method } : cleaned;
    const [p] = cleaned.payments;
    const row: CorrectedRow = { method_code: p.method_code, amount_cents: p.amount_cents, reference: p.reference, details: p.details, fee_cents: p.fee_cents, counts_as_cash: p.counts_as_cash };
    if (before && sameRow(before, row)) keep.push(before);
    else if (before) update.push({ before, after: row });
    else fresh.push(row);
  }
  const remove = editable.filter((p) => !seen.has(p.id));
  if (!update.length && !remove.length && !fresh.length) return { reason: "no_changes" };

  // A new row is the deposit when nothing left on the sale is one.
  const hasDeposit = [...keep, ...update.map((u) => u.before)].some((p) => p.kind === "deposit");
  const add = fresh.map((r, i) => ({ ...r, kind: (hasDeposit || i > 0 ? "balance" : "deposit") as "deposit" | "balance" }));

  const before_paid_cents = editable.reduce((s, p) => s + p.amount_cents, 0);
  const paid_cents = keep.reduce((s, p) => s + p.amount_cents, 0) + update.reduce((s, u) => s + u.after.amount_cents, 0) + add.reduce((s, r) => s + r.amount_cents, 0);
  const due = sale.total_cents - sale.insurance_cents;
  if (paid_cents > due) return { reason: "overpaid", max: Math.max(0, due) };

  const cash = new Map<string, number>();
  const move = (store: string | null, cents: number) => {
    if (!cents) return;
    const key = store || sale.establishment_id;
    cash.set(key, (cash.get(key) ?? 0) + cents);
  };
  for (const u of update) move(u.before.establishment_id, (u.after.counts_as_cash ? u.after.amount_cents : 0) - (u.before.counts_as_cash ? u.before.amount_cents : 0));
  for (const p of remove) move(p.establishment_id, p.counts_as_cash ? -p.amount_cents : 0);
  for (const r of add) move(sale.establishment_id, r.counts_as_cash ? r.amount_cents : 0);

  return {
    keep,
    update,
    remove,
    add,
    fixed,
    before_paid_cents,
    paid_cents,
    balance_cents: due - paid_cents,
    cash: [...cash.entries()].filter(([, c]) => c !== 0).map(([establishment_id, cents]) => ({ establishment_id, cents })),
  };
}

/**
 * A fingerprint of the customer payments a plan was made from. The writer
 * compares it under the row lock: if someone collected or corrected in
 * between, the plan is stale and nothing is written (`payments_changed`).
 */
export function paymentsStamp(stored: readonly Pick<StoredPayment, "id" | "method_code" | "amount_cents">[]): string {
  return stored
    .map((p) => `${p.id}:${p.method_code}:${p.amount_cents}`)
    .sort()
    .join("|");
}

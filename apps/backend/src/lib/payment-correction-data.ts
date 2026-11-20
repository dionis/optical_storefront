/**
 * Writes a payment correction (lib/payment-correction.ts plans it).
 *
 * All of it in ONE transaction, under a lock on the sale row:
 *   - the corrected rows are updated in place (they keep the day they were
 *     received, so the cash report and the fees of that month read the truth);
 *   - removed rows are soft-deleted;
 *   - new rows are inserted, received by whoever corrects, today;
 *   - each change is written on the row itself (`corrected_at`, `corrected_by`,
 *     `corrections`: what it was, what it became, why, who and when);
 *   - the sale's paid and balance are recomputed;
 *   - the CASH difference of each store is one «correction» line in that
 *     store's OPEN register (opened on the spot if none is), with the sale's
 *     number. A register already closed and signed is never edited: its count
 *     stays the one that was signed, and the correction shows up today.
 *
 * If the payments changed between the plan and the lock (someone collected
 * or corrected at the same time) nothing is written: `payments_changed`.
 * After the commit, as every other money write of the till: the order's
 * stamps, the dashboards' rows, the audit log and the Sheet.
 */
import type { Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, generateEntityId } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { recordAudit } from "./audit";
import { ensureStoreSession } from "./cash";
import { syncOrderToSheet } from "./gsheet-sync";
import { getSale, listPaymentMethods, PosError, stampOrder, type SaleRow } from "./pos-data";
import { isCustomerPayment, paymentsStamp, planPaymentCorrection, type CorrectionPlan, type CorrectionReason, type StoredPayment } from "./payment-correction";
import { projectOrder } from "./sale-facts";

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
const logOf = (c: MedusaContainer) => c.resolve<Logger>(ContainerRegistrationKeys.LOGGER);

const storedOf = (r: Record<string, unknown>): StoredPayment => ({
  id: String(r.id),
  method_code: String(r.method_code),
  amount_cents: Math.round(Number(r.amount_cents) || 0),
  reference: (r.reference as string | null) ?? null,
  details: (r.details as Record<string, unknown> | null) ?? null,
  kind: String(r.kind ?? "deposit"),
  fee_cents: Math.round(Number(r.fee_cents) || 0),
  counts_as_cash: r.counts_as_cash === true,
  establishment_id: (r.establishment_id as string | null) ?? null,
  cash_session_id: (r.cash_session_id as string | null) ?? null,
});

const PAYMENT_COLUMNS = ["id", "method_code", "amount_cents", "reference", "details", "kind", "fee_cents", "counts_as_cash", "establishment_id", "cash_session_id"];

async function livePayments(db: Knex | Knex.Transaction, saleId: string): Promise<StoredPayment[]> {
  const rows = (await db("pos_sale_payment").where({ sale_id: saleId }).whereNull("deleted_at").orderBy("created_at", "asc").select(PAYMENT_COLUMNS)) as Array<Record<string, unknown>>;
  return rows.map(storedOf);
}

export interface CorrectionInput {
  payments: unknown;
  why: CorrectionReason;
  note: string | null;
  /** What the person saw as paid (dollars); a different figure now = someone else changed it. */
  seenPaid?: unknown;
}

export interface CorrectionResult {
  sale: SaleRow;
  plan: Pick<CorrectionPlan, "before_paid_cents" | "paid_cents" | "balance_cents" | "cash"> & { updated: number; removed: number; added: number };
}

/** A summary of a row for the history kept on it and in the audit log (no reference data beyond the one-line summary). */
const brief = (p: { method_code: string; amount_cents: number; reference: string | null }) => ({ method_code: p.method_code, amount_cents: p.amount_cents, reference: p.reference });

export async function correctSalePayments(container: MedusaContainer, sale: SaleRow, input: CorrectionInput, actorId: string): Promise<CorrectionResult> {
  if (sale.status === "voided") throw new PosError("sale_voided", 409);
  if (sale.deleted_at) throw new PosError("sale_not_found", 404);
  if (input.seenPaid !== undefined && input.seenPaid !== null && Math.round(Number(input.seenPaid) * 100) !== Math.round(sale.paid * 100)) {
    throw new PosError("payments_changed", 409);
  }
  const pg = pgOf(container);
  const methods = await listPaymentMethods(container);
  const [row] = (await pg("pos_sale").where({ id: sale.id }).whereNull("deleted_at").select("total_cents", "insurance_cents", "establishment_id", "number", "terminal_id")) as Array<Record<string, unknown>>;
  if (!row) throw new PosError("sale_not_found", 404);
  const stored = await livePayments(pg, sale.id);
  const plan = planPaymentCorrection(stored, input.payments, methods, {
    total_cents: Number(row.total_cents),
    insurance_cents: Number(row.insurance_cents),
    establishment_id: String(row.establishment_id),
  });
  if ("reason" in plan) throw new PosError(plan.reason, 422, { ...(plan.method ? { method: plan.method } : {}), ...(plan.max !== undefined ? { max: plan.max / 100 } : {}) });
  const stamp = paymentsStamp(stored.filter((p) => isCustomerPayment(p, methods)));

  // The registers that take a line or a new cash row: open (or opened) BEFORE
  // the transaction, the same way a cash payment opens the day's register.
  const saleStore = String(row.establishment_id);
  const needsSession = new Set<string>(plan.cash.map((c) => c.establishment_id));
  for (const u of plan.update) if (u.after.counts_as_cash && !u.before.counts_as_cash) needsSession.add(u.before.establishment_id || saleStore);
  if (plan.add.some((r) => r.counts_as_cash)) needsSession.add(saleStore);
  const sessions = new Map<string, string>();
  for (const store of needsSession) {
    try {
      sessions.set(store, await ensureStoreSession(container, { establishmentId: store, terminalId: store === saleStore ? ((row.terminal_id as string | null) ?? null) : null, actorId }));
    } catch (e) {
      logOf(container).error(`[pos] correction of ${sale.number}: register of ${store} could not be opened: ${(e as Error).message}`);
      throw new PosError("cash_unavailable", 503);
    }
  }

  const now = new Date();
  const entry = (action: "edit" | "delete" | "add", from: ReturnType<typeof brief> | null, to: ReturnType<typeof brief> | null) => ({ at: now.toISOString(), by: actorId, action, reason: input.why, note: input.note, from, to });
  const history = (r: Knex | Knex.Transaction, e: ReturnType<typeof entry>) => r.raw(`COALESCE(corrections, '[]'::jsonb) || ?::jsonb`, [JSON.stringify([e])]);

  await pg.transaction(async (trx) => {
    const locked = (await trx("pos_sale").where({ id: sale.id }).whereNull("deleted_at").forUpdate().select("status", "insurance_cents", "total_cents")) as Array<Record<string, unknown>>;
    if (!locked[0]) throw new PosError("sale_not_found", 404);
    if (locked[0].status === "voided") throw new PosError("sale_voided", 409);
    if (Number(locked[0].total_cents) !== Number(row.total_cents) || Number(locked[0].insurance_cents) !== Number(row.insurance_cents)) throw new PosError("payments_changed", 409);
    const nowRows = await livePayments(trx, sale.id);
    if (paymentsStamp(nowRows.filter((p) => isCustomerPayment(p, methods))) !== stamp) throw new PosError("payments_changed", 409);

    for (const u of plan.update) {
      const store = u.before.establishment_id || saleStore;
      const becomesCash = u.after.counts_as_cash && !u.before.counts_as_cash;
      await trx("pos_sale_payment")
        .where({ id: u.before.id })
        .update({
          method_code: u.after.method_code,
          amount_cents: u.after.amount_cents,
          reference: u.after.reference,
          details: JSON.stringify(u.after.details),
          fee_cents: u.after.fee_cents,
          counts_as_cash: u.after.counts_as_cash,
          // A row that becomes cash belongs to today's register; one that stays cash keeps the register it entered.
          cash_session_id: u.after.counts_as_cash ? (becomesCash ? sessions.get(store) ?? null : u.before.cash_session_id) : null,
          corrected_at: now,
          corrected_by: actorId,
          corrections: history(trx, entry("edit", brief(u.before), brief(u.after))),
          updated_at: now,
        });
    }
    for (const p of plan.remove) {
      await trx("pos_sale_payment")
        .where({ id: p.id })
        .update({ deleted_at: now, corrected_at: now, corrected_by: actorId, corrections: history(trx, entry("delete", brief(p), null)), updated_at: now });
    }
    if (plan.add.length) {
      await trx("pos_sale_payment").insert(
        plan.add.map((r) => ({
          id: generateEntityId("", "pospay"),
          sale_id: sale.id,
          method_code: r.method_code,
          amount_cents: r.amount_cents,
          reference: r.reference,
          kind: r.kind,
          establishment_id: saleStore,
          received_by: actorId,
          fee_cents: r.fee_cents,
          counts_as_cash: r.counts_as_cash,
          details: JSON.stringify(r.details),
          cash_session_id: r.counts_as_cash ? sessions.get(saleStore) ?? null : null,
          corrected_at: now,
          corrected_by: actorId,
          corrections: JSON.stringify([entry("add", null, brief(r))]),
          created_at: now,
          updated_at: now,
        }))
      );
    }
    for (const c of plan.cash) {
      const session = sessions.get(c.establishment_id);
      if (!session) throw new PosError("cash_unavailable", 503);
      await trx("cash_movement").insert({
        id: generateEntityId("", "cashm"),
        session_id: session,
        kind: c.cents > 0 ? "in" : "out",
        amount_cents: Math.abs(c.cents),
        category: "correction",
        note: String(row.number),
        created_by: actorId,
        sale_id: sale.id,
        // Not tied to one payment row: the unique index on payment_id is for the line each cash payment writes.
        payment_id: null,
        terminal_id: c.establishment_id === saleStore ? ((row.terminal_id as string | null) ?? null) : null,
        created_at: now,
        updated_at: now,
      });
    }
    await trx("pos_sale")
      .where({ id: sale.id })
      .update({ paid_cents: plan.paid_cents, balance_cents: plan.balance_cents, edited_at: now, edited_by: actorId, updated_at: now });
  });

  // After the commit: best-effort, the money is already recorded.
  if (sale.order_id) {
    await stampOrder(container, sale.order_id, { balance_due_cents: plan.balance_cents, paid_cents: plan.paid_cents + Number(row.insurance_cents) }).catch((e) => logOf(container).warn(`[pos] correction ${sale.number}: order not stamped: ${(e as Error).message}`));
    try {
      await projectOrder(container, sale.order_id);
    } catch (e) {
      logOf(container).warn(`[pos] correction ${sale.number}: facts not reprojected: ${(e as Error).message}`);
    }
  }
  await recordAudit(container, {
    actorId,
    action: "payment.correct",
    entity: "pos_sale",
    entityId: sale.id,
    establishmentId: sale.establishment_id,
    before: { paid_cents: plan.before_paid_cents, balance_cents: Number(row.total_cents) - Number(row.insurance_cents) - plan.before_paid_cents, payments: [...plan.update.map((u) => brief(u.before)), ...plan.remove.map(brief)] },
    after: { paid_cents: plan.paid_cents, balance_cents: plan.balance_cents, reason: input.why, note: input.note, payments: [...plan.update.map((u) => brief(u.after)), ...plan.add.map(brief)], removed: plan.remove.length, cash: plan.cash },
  });
  if (sale.order_id) void syncOrderToSheet(container, sale.order_id, "pagos corregidos", undefined, { history: true });

  return {
    sale: (await getSale(container, sale.id)) as SaleRow,
    plan: { before_paid_cents: plan.before_paid_cents, paid_cents: plan.paid_cents, balance_cents: plan.balance_cents, cash: plan.cash, updated: plan.update.length, removed: plan.remove.length, added: plan.add.length },
  };
}

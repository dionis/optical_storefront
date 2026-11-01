import type { IUserModuleService, Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { POS_MODULE } from "../modules/pos";
import type PosModuleService from "../modules/pos/service";
import { emitAlert } from "./alerts-data";
import { recordAudit, type AuditAction } from "./audit";
import { peopleOf, type Person } from "./cash-report";
import { sendCashEmail } from "./email/cash-emails";
import { listEstablishments } from "./establishments";
import { listTerminals, PosError } from "./pos-data";

/**
 * The STORE's cash register (HU-32; owner, 2026-11: "opening and closing are
 * for the whole store, not for one till").
 *
 * THE LEDGER RULE — `cash_movement` is the single source of truth of what
 * went through the drawer while a session is open:
 *
 *   - every cash payment  → one `in`  line, category `sale_payment`
 *     (pos-data.ts calls `recordSalePayments` right after the ledger row);
 *   - every cash refund   → one `out` line, category `sale_refund`;
 *   - money put in / taken out by hand → one line with a CASH_CATEGORIES reason;
 *   - the opening float   → one `in` line `opening_float` that MIRRORS
 *     `opening_cents` so the printed list is complete; it is NOT summed again.
 *
 *   expected = opening_cents + Σ in − Σ out   (opening_float excluded)
 *
 * `pos_sale_payment.counts_as_cash` is no longer summed anywhere for the
 * register: it only tells the cash report which method the money came by.
 *
 * Opening: explicit (POST /admin/pos/cash-sessions with float + initials) or
 * automatic on the first cash payment of the day (`ensureStoreSession`), with
 * the previous session's count as float. Closing: count + initials; a
 * difference leaves the session `pending_approval` until the owner (or a
 * superadmin) signs it with their initials, in the same call or later.
 */

/** Why cash moved by hand (owner's list). The reasons a person may pick. */
export const CASH_CATEGORIES = ["supplier_payment", "expense", "owner_withdrawal", "bank_deposit", "change_fund", "refund", "correction", "other"] as const;
export type CashCategory = (typeof CASH_CATEGORIES)[number];
/** Lines the system writes on its own; never offered in the movement form. */
export const AUTO_CASH_CATEGORIES = ["sale_payment", "sale_refund", "opening_float"] as const;
export type AutoCashCategory = (typeof AUTO_CASH_CATEGORIES)[number];

export const isCashCategory = (v: unknown): v is CashCategory => typeof v === "string" && (CASH_CATEGORIES as readonly string[]).includes(v);
export const isAutoCategory = (v: unknown): v is AutoCashCategory => typeof v === "string" && (AUTO_CASH_CATEGORIES as readonly string[]).includes(v);

export const SESSION_STATUSES = ["open", "closed", "pending_approval"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export interface LedgerLine {
  kind: "in" | "out" | string;
  amount: number;
  category?: string | null;
}

/** Pure: what should be in the drawer. The opening float line mirrors `opening` and is skipped. */
export function expectedCash(opening: number, movements: LedgerLine[]): number {
  return opening + movements.reduce((s, m) => (m.category === "opening_float" ? s : s + (m.kind === "in" ? m.amount : -m.amount)), 0);
}

/** Initials for a digital signature: 2–4 letters, upper-cased; null when not one. */
export function cleanSignature(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return /^[A-ZÑÁÉÍÓÚ]{2,4}$/.test(s) ? s : null;
}

/** Initials derived from a person's name (first letters of up to three words), or of the email's local part. */
export function initialsOf(name: string | null | undefined, email?: string | null): string {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  const fromName = words.map((w) => w[0]).join("").toUpperCase().replace(/[^A-ZÑÁÉÍÓÚ]/g, "").slice(0, 3);
  if (fromName.length >= 2) return fromName;
  const local = String(email ?? "").split("@")[0].replace(/[^a-zA-Z]/g, "").toUpperCase();
  const fromEmail = (fromName + local).slice(0, 2);
  return fromEmail.length >= 2 ? fromEmail : "XX";
}

const svc = (c: MedusaContainer) => c.resolve<PosModuleService>(POS_MODULE);
const log = (c: MedusaContainer) => c.resolve<Logger>(ContainerRegistrationKeys.LOGGER);

export interface MovementView {
  id: string;
  session_id: string;
  kind: string;
  amount: number;
  amount_cents: number;
  category: string | null;
  /** True for the lines the system wrote (sale_payment, sale_refund, opening_float). */
  auto: boolean;
  note: string | null;
  created_by: string | null;
  by: Person | null;
  created_at: string;
  sale_id: string | null;
  payment_id: string | null;
  terminal_id: string | null;
  terminal_code: string | null;
}

export interface CashSessionView {
  id: string;
  establishment_id: string;
  /** Till of a pre-store-level session; null since CreatePos5. */
  terminal_id: string | null;
  status: SessionStatus;
  opened_by: string | null;
  opened_by_person: Person | null;
  opened_at: string;
  opened_signature: string | null;
  opening_note: string | null;
  opening: number;
  closed_at: string | null;
  closed_by: string | null;
  closed_by_person: Person | null;
  closed_signature: string | null;
  expected: number;
  counted: number | null;
  diff: number | null;
  note: string | null;
  approval_signature: string | null;
  approved_by: string | null;
  approved_by_person: Person | null;
  approved_at: string | null;
  /** Net cash from sales: payments − refunds. */
  cash_in_sales: number;
  cash_payments_count: number;
  refunds: number;
  manual_in: number;
  manual_out: number;
  movements: MovementView[];
}

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const n = (v: unknown): number => Math.round(Number(v) || 0);

/** Totals of a ledger, in cents. */
export function ledgerTotals(movements: Array<{ kind: string; amount_cents: number; category: string | null }>) {
  const t = { cash_payments: 0, cash_payments_count: 0, refunds: 0, manual_in: 0, manual_out: 0 };
  for (const m of movements) {
    const c = m.category;
    if (c === "opening_float") continue;
    if (c === "sale_payment") {
      t.cash_payments += m.amount_cents;
      t.cash_payments_count += 1;
    } else if (c === "sale_refund") t.refunds += m.amount_cents;
    else if (m.kind === "in") t.manual_in += m.amount_cents;
    else t.manual_out += m.amount_cents;
  }
  return t;
}

/** Builds the views of several sessions with the fewest queries: ledgers, people and tills in one batch each. */
async function views(container: MedusaContainer, rows: Record<string, unknown>[]): Promise<CashSessionView[]> {
  if (!rows.length) return [];
  const p = svc(container);
  const ids = rows.map((s) => String(s.id));
  const movements = (await p.listCashMovements({ session_id: ids }, { take: 20000, order: { created_at: "ASC" } })) as unknown as Record<string, unknown>[];
  const storeIds = [...new Set(rows.map((s) => String(s.establishment_id)))];
  const [terminals, people] = await Promise.all([
    listTerminals(container, storeIds).catch(() => []),
    peopleOf(container, [
      ...rows.flatMap((s) => [s.opened_by, s.closed_by, s.approved_by].map((v) => (v ? String(v) : ""))),
      ...movements.map((m) => (m.created_by ? String(m.created_by) : "")),
    ]),
  ]);
  const person = (id: unknown): Person | null => (id ? people.find((x) => x.id === String(id)) ?? { id: String(id), name: String(id), code: null } : null);
  const termCode = (id: unknown): string | null => (id ? terminals.find((t) => t.id === String(id))?.code ?? null : null);
  const bySession = new Map<string, MovementView[]>();
  for (const m of movements) {
    const list = bySession.get(String(m.session_id)) ?? [];
    list.push({
      id: String(m.id),
      session_id: String(m.session_id),
      kind: String(m.kind),
      amount: n(m.amount_cents) / 100,
      amount_cents: n(m.amount_cents),
      category: (m.category as string | null) ?? null,
      auto: isAutoCategory(m.category),
      note: (m.note as string | null) ?? null,
      created_by: (m.created_by as string | null) ?? null,
      by: person(m.created_by),
      created_at: iso(m.created_at) as string,
      sale_id: (m.sale_id as string | null) ?? null,
      payment_id: (m.payment_id as string | null) ?? null,
      terminal_id: (m.terminal_id as string | null) ?? null,
      terminal_code: termCode(m.terminal_id),
    });
    bySession.set(String(m.session_id), list);
  }
  return rows.map((s) => {
    const mv = bySession.get(String(s.id)) ?? [];
    const t = ledgerTotals(mv);
    const expected = s.closed_at ? n(s.expected_cents) : expectedCash(n(s.opening_cents), mv.map((m) => ({ kind: m.kind, amount: m.amount_cents, category: m.category })));
    return {
      id: String(s.id),
      establishment_id: String(s.establishment_id),
      terminal_id: (s.terminal_id as string | null) ?? null,
      status: (SESSION_STATUSES as readonly string[]).includes(String(s.status)) ? (s.status as SessionStatus) : s.closed_at ? "closed" : "open",
      opened_by: (s.opened_by as string | null) ?? null,
      opened_by_person: person(s.opened_by),
      opened_at: iso(s.opened_at) as string,
      opened_signature: (s.opened_signature as string | null) ?? null,
      opening_note: (s.opening_note as string | null) ?? null,
      opening: n(s.opening_cents) / 100,
      closed_at: iso(s.closed_at),
      closed_by: (s.closed_by as string | null) ?? null,
      closed_by_person: person(s.closed_by),
      closed_signature: (s.closed_signature as string | null) ?? null,
      expected: expected / 100,
      counted: s.counted_cents == null ? null : n(s.counted_cents) / 100,
      diff: s.diff_cents == null ? null : n(s.diff_cents) / 100,
      note: (s.note as string | null) ?? null,
      approval_signature: (s.approval_signature as string | null) ?? null,
      approved_by: (s.approved_by as string | null) ?? null,
      approved_by_person: person(s.approved_by),
      approved_at: iso(s.approved_at),
      cash_in_sales: (t.cash_payments - t.refunds) / 100,
      cash_payments_count: t.cash_payments_count,
      refunds: t.refunds / 100,
      manual_in: t.manual_in / 100,
      manual_out: t.manual_out / 100,
      movements: mv,
    };
  });
}

/** The store's open session id, if any. */
export async function openSessionFor(container: MedusaContainer, establishmentId: string): Promise<string | null> {
  const [s] = await svc(container).listCashSessions({ establishment_id: establishmentId, closed_at: null } as never, { take: 1, order: { opened_at: "DESC" } });
  return s?.id ?? null;
}

export async function listSessions(container: MedusaContainer, establishmentIds: string[] | null, take = 30): Promise<CashSessionView[]> {
  const where = establishmentIds === null ? {} : { establishment_id: establishmentIds };
  const rows = await svc(container).listCashSessions(where as never, { take, order: { opened_at: "DESC" } });
  return views(container, rows as unknown as Record<string, unknown>[]);
}

export async function getSession(container: MedusaContainer, id: string): Promise<CashSessionView | null> {
  const [s] = await svc(container).listCashSessions({ id }, { take: 1 });
  if (!s) return null;
  const [v] = await views(container, [s as unknown as Record<string, unknown>]);
  return v ?? null;
}

/** What the last closed (or counted, pending approval) session of the store left in the drawer. */
export async function lastCountedCents(container: MedusaContainer, establishmentId: string): Promise<number> {
  const [s] = await svc(container).listCashSessions({ establishment_id: establishmentId, status: ["closed", "pending_approval"] } as never, { take: 1, order: { closed_at: "DESC" } });
  return s?.counted_cents == null ? 0 : n(s.counted_cents);
}

/** Name and email of a panel user, for the automatic signature. */
async function userLabel(container: MedusaContainer, userId: string | null): Promise<{ name: string | null; email: string | null }> {
  if (!userId) return { name: null, email: null };
  try {
    const [u] = await container.resolve<IUserModuleService>(Modules.USER).listUsers({ id: userId }, { take: 1 });
    return u ? { name: [u.first_name, u.last_name].filter(Boolean).join(" ") || null, email: u.email ?? null } : { name: null, email: null };
  } catch {
    return { name: null, email: null };
  }
}

const audit = (container: MedusaContainer, action: string, s: { id: string; establishment_id: string }, actorId: string | null, after: unknown, before?: unknown) =>
  recordAudit(container, { actorId, action: action as AuditAction, entity: "cash_session", entityId: s.id, establishmentId: s.establishment_id, after, before });

/** Mails the opening / closing document to the owner and the admin list; never blocks the till. */
function notify(container: MedusaContainer, sessionId: string, kind: "open" | "close"): void {
  sendCashEmail(container, sessionId, kind).catch((e: Error) => log(container).warn(`[cash] ${kind} email for ${sessionId} not sent: ${e.message}`));
}

export interface OpenInput {
  establishmentId: string;
  /** null = carry over the last count of the store (automatic opening). */
  openingCents: number | null;
  actorId: string | null;
  /** Required on an explicit opening; derived from the actor's name on an automatic one. */
  signature: string | null;
  note: string | null;
  terminalId?: string | null;
}

/** Opens the store's register. 409 `cash_already_open` when one is open. */
export async function openSession(container: MedusaContainer, input: OpenInput): Promise<CashSessionView> {
  if (await openSessionFor(container, input.establishmentId)) throw new PosError("cash_already_open", 409);
  const store = (await listEstablishments(container)).find((s) => s.id === input.establishmentId && s.is_active);
  if (!store) throw new PosError("store_not_found", 404);
  const opening = input.openingCents === null ? await lastCountedCents(container, input.establishmentId) : input.openingCents;
  let signature = cleanSignature(input.signature);
  if (!signature) {
    if (input.signature !== null) throw new PosError("cash_signature_required");
    const u = await userLabel(container, input.actorId);
    signature = initialsOf(u.name, u.email);
  }
  const s = svc(container);
  const row = await s.createCashSessions({
    establishment_id: input.establishmentId,
    terminal_id: null,
    opened_by: input.actorId,
    opened_at: new Date(),
    opening_cents: opening,
    opened_signature: signature,
    opening_note: input.note,
    status: "open",
  } as never);
  if (opening > 0) {
    await s.createCashMovements({
      session_id: row.id,
      kind: "in",
      amount_cents: opening,
      category: "opening_float",
      note: input.note,
      created_by: input.actorId,
      terminal_id: input.terminalId ?? null,
    } as never);
  }
  await audit(container, "cash.open", { id: row.id, establishment_id: input.establishmentId }, input.actorId, { opening_cents: opening, signature, auto: input.openingCents === null, note: input.note });
  notify(container, row.id, "open");
  return (await getSession(container, row.id)) as CashSessionView;
}

/**
 * The store's open register, opened on the spot when there is none — the
 * owner's rule: the opening is the operator's first operation, i.e. the first
 * cash payment. Used by pos-data.ts; returns the session id.
 */
export async function ensureStoreSession(container: MedusaContainer, args: { establishmentId: string; terminalId: string | null; actorId: string | null }): Promise<string> {
  const open = await openSessionFor(container, args.establishmentId);
  if (open) return open;
  try {
    const s = await openSession(container, { establishmentId: args.establishmentId, openingCents: null, actorId: args.actorId, signature: null, note: "auto", terminalId: args.terminalId });
    return s.id;
  } catch (e) {
    // Two tills paid at once: the unique index let one through; use it.
    const again = await openSessionFor(container, args.establishmentId);
    if (again) return again;
    throw e;
  }
}

/** Writes the ledger lines of the cash payments (or refunds) of a sale just recorded. */
export async function recordSalePayments(
  container: MedusaContainer,
  args: { sessionId: string; saleId: string; terminalId: string | null; actorId: string | null; payments: Array<{ id: string; amount_cents: number }> }
): Promise<void> {
  const rows = args.payments.filter((p) => p.amount_cents !== 0);
  if (!rows.length) return;
  const s = svc(container);
  const [sale] = await s.listPosSales({ id: args.saleId }, { take: 1, select: ["id", "number"] as never });
  const number = sale?.number ?? null;
  await s.createCashMovements(
    rows.map((p) => ({
      session_id: args.sessionId,
      kind: p.amount_cents < 0 ? "out" : "in",
      amount_cents: Math.abs(p.amount_cents),
      category: p.amount_cents < 0 ? "sale_refund" : "sale_payment",
      note: number,
      created_by: args.actorId,
      sale_id: args.saleId,
      payment_id: p.id,
      terminal_id: args.terminalId,
    })) as never
  );
}

export async function addMovement(
  container: MedusaContainer,
  session: CashSessionView,
  input: { kind: "in" | "out"; amountCents: number; category: unknown; note: string | null; actorId: string; terminalId?: string | null }
): Promise<CashSessionView> {
  if (session.closed_at) throw new PosError("cash_closed", 409);
  if (!isCashCategory(input.category)) throw new PosError("bad_category");
  await svc(container).createCashMovements({
    session_id: session.id,
    kind: input.kind,
    amount_cents: input.amountCents,
    category: input.category,
    note: input.note,
    created_by: input.actorId,
    terminal_id: input.terminalId ?? null,
  } as never);
  return (await getSession(container, session.id)) as CashSessionView;
}

export interface CloseInput {
  countedCents: number;
  note: string | null;
  actorId: string;
  sellerCode: string | null;
  /** Initials of whoever counted; required. */
  signature: unknown;
  /** Owner's initials, accepted only from an admin; closes a difference on the spot. */
  approvalSignature?: unknown;
  isAdmin: boolean;
}

/**
 * Closes with the count and the closer's initials. No difference → `closed`.
 * A difference → `pending_approval` (recorded, audited, alerted), unless an
 * admin signs the approval in the same call. The session stops taking
 * payments either way: the next cash payment opens the next one.
 */
export async function closeSession(container: MedusaContainer, session: CashSessionView, input: CloseInput): Promise<CashSessionView> {
  if (session.closed_at) throw new PosError("cash_closed", 409);
  const signature = cleanSignature(input.signature);
  if (!signature) throw new PosError("cash_signature_required");
  const approval = input.approvalSignature == null || input.approvalSignature === "" ? null : cleanSignature(input.approvalSignature);
  if (input.approvalSignature != null && input.approvalSignature !== "" && !approval) throw new PosError("cash_signature_required");
  if (approval && !input.isAdmin) throw new PosError("forbidden_role", 403);
  const expected = Math.round(session.expected * 100);
  const diff = input.countedCents - expected;
  const approved = diff === 0 || Boolean(approval);
  const now = new Date();
  await svc(container).updateCashSessions({
    id: session.id,
    closed_at: now,
    closed_by: input.actorId,
    closed_signature: signature,
    expected_cents: expected,
    counted_cents: input.countedCents,
    diff_cents: diff,
    note: input.note,
    status: approved ? "closed" : "pending_approval",
    approval_signature: diff !== 0 && approval ? approval : null,
    approved_by: diff !== 0 && approval ? input.actorId : null,
    approved_at: diff !== 0 && approval ? now : null,
  } as never);
  await audit(container, "cash.close", session, input.actorId, {
    expected_cents: expected,
    counted_cents: input.countedCents,
    diff_cents: diff,
    signature,
    status: approved ? "closed" : "pending_approval",
    approval_signature: diff !== 0 && approval ? approval : null,
  });
  if (diff !== 0) {
    const store = (await listEstablishments(container)).find((s) => s.id === session.establishment_id);
    await emitAlert(container, {
      event: "cash.diff",
      key: `cash:${session.id}`,
      establishment_id: session.establishment_id,
      seller_id: input.actorId,
      data: { amount: diff / 100, store_code: store?.code ?? null, store_name: store?.name ?? null, seller_code: input.sellerCode },
    });
  }
  notify(container, session.id, "close");
  return (await getSession(container, session.id)) as CashSessionView;
}

/** The owner (or a superadmin) authorises a difference with their initials. */
export async function approveSession(container: MedusaContainer, session: CashSessionView, input: { approvalSignature: unknown; actorId: string }): Promise<CashSessionView> {
  if (session.status !== "pending_approval") throw new PosError("cash_not_pending", 409);
  const approval = cleanSignature(input.approvalSignature);
  if (!approval) throw new PosError("cash_signature_required");
  const now = new Date();
  await svc(container).updateCashSessions({ id: session.id, status: "closed", approval_signature: approval, approved_by: input.actorId, approved_at: now } as never);
  await audit(container, "cash.approve", session, input.actorId, { diff_cents: Math.round((session.diff ?? 0) * 100), approval_signature: approval }, { status: "pending_approval" });
  notify(container, session.id, "close");
  return (await getSession(container, session.id)) as CashSessionView;
}

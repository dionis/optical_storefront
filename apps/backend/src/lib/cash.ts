import type { MedusaContainer } from "@medusajs/framework/types";
import { POS_MODULE } from "../modules/pos";
import type PosModuleService from "../modules/pos/service";
import { emitAlert } from "./alerts-data";
import { recordAudit } from "./audit";
import { listEstablishments } from "./establishments";
import { listTerminals, PosError } from "./pos-data";

/**
 * Cash register per till (HU-32). Only payments with methods that count as
 * cash enter the expected amount (owner's document: cash is the only thing
 * that counts to square the register).
 */

/** Pure: what should be in the drawer. */
export function expectedCash(opening: number, cashPayments: number[], movements: Array<{ kind: "in" | "out"; amount: number }>): number {
  return opening + cashPayments.reduce((s, v) => s + v, 0) + movements.reduce((s, m) => s + (m.kind === "in" ? m.amount : -m.amount), 0);
}

const svc = (c: MedusaContainer) => c.resolve<PosModuleService>(POS_MODULE);

export interface CashSessionView {
  id: string;
  establishment_id: string;
  terminal_id: string;
  opened_by: string | null;
  opened_at: string;
  opening: number;
  closed_at: string | null;
  closed_by: string | null;
  expected: number;
  counted: number | null;
  diff: number | null;
  note: string | null;
  cash_in_sales: number;
  movements: Array<{ kind: string; amount: number; note: string | null; created_at: string }>;
}

async function view(container: MedusaContainer, s: Record<string, unknown>): Promise<CashSessionView> {
  const p = svc(container);
  const [payments, movements] = await Promise.all([
    p.listPosSalePayments({ cash_session_id: s.id as string } as never, { take: 5000 }),
    p.listCashMovements({ session_id: s.id as string }, { take: 500, order: { created_at: "ASC" } }),
  ]);
  const cashPayments = payments.filter((x) => x.counts_as_cash).map((x) => Number(x.amount_cents));
  const mv = movements.map((m) => ({ kind: m.kind as "in" | "out", amount: Number(m.amount_cents) }));
  const expected = s.closed_at ? Number(s.expected_cents) : expectedCash(Number(s.opening_cents), cashPayments, mv);
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    id: String(s.id),
    establishment_id: String(s.establishment_id),
    terminal_id: String(s.terminal_id),
    opened_by: (s.opened_by as string | null) ?? null,
    opened_at: iso(s.opened_at) as string,
    opening: Number(s.opening_cents) / 100,
    closed_at: iso(s.closed_at),
    closed_by: (s.closed_by as string | null) ?? null,
    expected: expected / 100,
    counted: s.counted_cents == null ? null : Number(s.counted_cents) / 100,
    diff: s.diff_cents == null ? null : Number(s.diff_cents) / 100,
    note: (s.note as string | null) ?? null,
    cash_in_sales: cashPayments.reduce((a, b) => a + b, 0) / 100,
    movements: movements.map((m) => ({ kind: m.kind, amount: Number(m.amount_cents) / 100, note: m.note ?? null, created_at: iso(m.created_at) as string })),
  };
}

export async function openSessionFor(container: MedusaContainer, terminalId: string): Promise<string | null> {
  const [s] = await svc(container).listCashSessions({ terminal_id: terminalId, closed_at: null } as never, { take: 1 });
  return s?.id ?? null;
}

export async function listSessions(container: MedusaContainer, establishmentIds: string[] | null, take = 30): Promise<CashSessionView[]> {
  const where = establishmentIds === null ? {} : { establishment_id: establishmentIds };
  const rows = await svc(container).listCashSessions(where as never, { take, order: { opened_at: "DESC" } });
  return Promise.all(rows.map((r) => view(container, r as unknown as Record<string, unknown>)));
}

export async function getSession(container: MedusaContainer, id: string): Promise<CashSessionView | null> {
  const [s] = await svc(container).listCashSessions({ id }, { take: 1 });
  return s ? view(container, s as unknown as Record<string, unknown>) : null;
}

export async function openSession(container: MedusaContainer, input: { establishmentId: string; terminalId: string; openingCents: number; actorId: string }): Promise<CashSessionView> {
  const terminal = (await listTerminals(container, [input.establishmentId])).find((t) => t.id === input.terminalId && t.is_active);
  if (!terminal) throw new PosError("bad_terminal");
  if (await openSessionFor(container, terminal.id)) throw new PosError("cash_already_open", 409);
  const s = await svc(container).createCashSessions({
    establishment_id: input.establishmentId,
    terminal_id: terminal.id,
    opened_by: input.actorId,
    opened_at: new Date(),
    opening_cents: input.openingCents,
  });
  return view(container, s as unknown as Record<string, unknown>);
}

export async function addMovement(container: MedusaContainer, session: CashSessionView, input: { kind: "in" | "out"; amountCents: number; note: string | null; actorId: string }): Promise<CashSessionView> {
  if (session.closed_at) throw new PosError("cash_closed", 409);
  await svc(container).createCashMovements({ session_id: session.id, kind: input.kind, amount_cents: input.amountCents, note: input.note, created_by: input.actorId });
  return (await getSession(container, session.id)) as CashSessionView;
}

/** Closes with the count; a difference is recorded, audited and alerted (cash.diff). */
export async function closeSession(container: MedusaContainer, session: CashSessionView, input: { countedCents: number; note: string | null; actorId: string; sellerCode: string | null }): Promise<CashSessionView> {
  if (session.closed_at) throw new PosError("cash_closed", 409);
  const expected = Math.round(session.expected * 100);
  const diff = input.countedCents - expected;
  await svc(container).updateCashSessions({
    id: session.id,
    closed_at: new Date(),
    closed_by: input.actorId,
    expected_cents: expected,
    counted_cents: input.countedCents,
    diff_cents: diff,
    note: input.note,
  } as never);
  await recordAudit(container, {
    actorId: input.actorId,
    action: "cash.close",
    entity: "cash_session",
    entityId: session.id,
    establishmentId: session.establishment_id,
    after: { expected_cents: expected, counted_cents: input.countedCents, diff_cents: diff },
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
  return (await getSession(container, session.id)) as CashSessionView;
}

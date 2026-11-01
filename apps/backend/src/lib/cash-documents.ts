import type { MedusaContainer } from "@medusajs/framework/types";
import { getSession, ledgerTotals, type CashSessionView, type MovementView } from "./cash";
import type { Person } from "./cash-report";
import { listEstablishments } from "./establishments";
import { PosError } from "./pos-data";
import { tenant } from "./tenant";

/**
 * The opening and closing documents of a store's cash session (owner:
 * "the accounting close must be clear and detailed … a double report, two
 * copies, emailed to the owner, for both the close and the opening").
 *
 * `buildCashDocument` loads; `cashDocumentOf` is pure (tested) so the email
 * (email/cash-emails.ts) and the panel's two-up print (PosCash.jsx) render the
 * same numbers. Amounts in cents. Display data only: no customer contact
 * details, no prescription, no insurance data.
 */

export type CashDocumentKind = "open" | "close";

export interface CashDocument {
  kind: CashDocumentKind;
  generated_at: string;
  business: { name: string; timezone: string };
  store: { id: string; code: string; name: string; address: string | null; phone: string | null; color: string | null };
  session: {
    id: string;
    status: string;
    opened_at: string;
    closed_at: string | null;
    approved_at: string | null;
    opening_cents: number;
    opening_note: string | null;
    expected_cents: number;
    counted_cents: number | null;
    diff_cents: number | null;
    note: string | null;
    opened_signature: string | null;
    closed_signature: string | null;
    approval_signature: string | null;
  };
  opened_by: Person | null;
  closed_by: Person | null;
  approved_by: Person | null;
  totals: {
    opening_cents: number;
    cash_payments_count: number;
    cash_payments_cents: number;
    refunds_count: number;
    refunds_cents: number;
    manual_in_cents: number;
    manual_out_cents: number;
    expected_cents: number;
    counted_cents: number | null;
    diff_cents: number | null;
  };
  /** Net cash from sales (payments − refunds) by till. */
  by_terminal: Array<{ terminal_id: string | null; code: string | null; count: number; cents: number }>;
  /** Net cash from sales by whoever received it. */
  by_seller: Array<{ person: Person | null; count: number; cents: number }>;
  /** Manual lines grouped by reason, with their notes. */
  manual: Array<{ kind: string; category: string | null; count: number; cents: number; notes: string[] }>;
  /** Every ledger line, oldest first. */
  movements: MovementView[];
}

export function cashDocumentOf(
  session: CashSessionView,
  store: { id: string; code: string; name: string; address?: string | null; phone?: string | null; color?: string | null },
  kind: CashDocumentKind,
  now = new Date()
): CashDocument {
  const mv = session.movements;
  const t = ledgerTotals(mv.map((m) => ({ kind: m.kind, amount_cents: m.amount_cents, category: m.category })));
  const expected = Math.round(session.expected * 100);
  const counted = session.counted == null ? null : Math.round(session.counted * 100);
  const diff = session.diff == null ? null : Math.round(session.diff * 100);

  const byTerminal = new Map<string, { terminal_id: string | null; code: string | null; count: number; cents: number }>();
  const bySeller = new Map<string, { person: Person | null; count: number; cents: number }>();
  const manual = new Map<string, { kind: string; category: string | null; count: number; cents: number; notes: string[] }>();
  let refundsCount = 0;
  for (const m of mv) {
    if (m.category === "opening_float") continue;
    if (m.category === "sale_payment" || m.category === "sale_refund") {
      const signed = m.category === "sale_refund" ? -m.amount_cents : m.amount_cents;
      if (m.category === "sale_refund") refundsCount += 1;
      const tk = m.terminal_id ?? "";
      const tr = byTerminal.get(tk) ?? { terminal_id: m.terminal_id, code: m.terminal_code, count: 0, cents: 0 };
      tr.count += 1;
      tr.cents += signed;
      byTerminal.set(tk, tr);
      const sk = m.created_by ?? "";
      const sr = bySeller.get(sk) ?? { person: m.by, count: 0, cents: 0 };
      sr.count += 1;
      sr.cents += signed;
      bySeller.set(sk, sr);
      continue;
    }
    const key = `${m.kind}|${m.category ?? ""}`;
    const row = manual.get(key) ?? { kind: m.kind, category: m.category, count: 0, cents: 0, notes: [] };
    row.count += 1;
    row.cents += m.amount_cents;
    if (m.note) row.notes.push(m.note);
    manual.set(key, row);
  }

  return {
    kind,
    generated_at: now.toISOString(),
    business: { name: tenant().name, timezone: tenant().timezone },
    store: { id: store.id, code: store.code, name: store.name, address: store.address ?? null, phone: store.phone ?? null, color: store.color ?? null },
    session: {
      id: session.id,
      status: session.status,
      opened_at: session.opened_at,
      closed_at: session.closed_at,
      approved_at: session.approved_at,
      opening_cents: Math.round(session.opening * 100),
      opening_note: session.opening_note,
      expected_cents: expected,
      counted_cents: counted,
      diff_cents: diff,
      note: session.note,
      opened_signature: session.opened_signature,
      closed_signature: session.closed_signature,
      approval_signature: session.approval_signature,
    },
    opened_by: session.opened_by_person,
    closed_by: session.closed_by_person,
    approved_by: session.approved_by_person,
    totals: {
      opening_cents: Math.round(session.opening * 100),
      cash_payments_count: t.cash_payments_count,
      cash_payments_cents: t.cash_payments,
      refunds_count: refundsCount,
      refunds_cents: t.refunds,
      manual_in_cents: t.manual_in,
      manual_out_cents: t.manual_out,
      expected_cents: expected,
      counted_cents: counted,
      diff_cents: diff,
    },
    by_terminal: [...byTerminal.values()].sort((a, b) => b.cents - a.cents),
    by_seller: [...bySeller.values()].sort((a, b) => b.cents - a.cents),
    manual: [...manual.values()].sort((a, b) => (a.kind === b.kind ? b.cents - a.cents : a.kind === "in" ? -1 : 1)),
    movements: [...mv].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)),
  };
}

export async function buildCashDocument(container: MedusaContainer, sessionId: string, kind: CashDocumentKind): Promise<CashDocument> {
  const session = await getSession(container, sessionId);
  if (!session) throw new PosError("cash_not_found", 404);
  if (kind === "close" && !session.closed_at) throw new PosError("cash_not_closed", 409);
  const store = (await listEstablishments(container)).find((s) => s.id === session.establishment_id);
  return cashDocumentOf(session, store ?? { id: session.establishment_id, code: "?", name: session.establishment_id }, kind);
}

import type { IUserModuleService, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { listPaymentMethods, type PaymentMethodRow } from "./pos-data";
import { profilesByUser } from "./staff-profile-data";
import { tenant } from "./tenant";

/**
 * Cash report (owner: "all the movements of the register, summarised by
 * card, debit, Zelle, cash… with the reasons, by day / week / month / year").
 *
 * Three sources, one period in the tenant's local dates:
 *   - pos_sale_payment: what customers paid, per method (refunds of voided
 *     sales are negative rows, so a deposit taken in October and refunded in
 *     November shows in each month where the money actually moved);
 *   - cash_movement: the register's ledger (lib/cash.ts) — cash put in / taken
 *     out by hand with its category, plus the automatic lines of each cash
 *     payment, refund and opening float. The automatic lines mirror the
 *     payments above, so only the manual ones enter "cash in / cash out";
 *   - cash_session: the closings (expected vs counted, signatures, approval).
 *
 * Receivable methods (the insurer's part) are listed per method but never
 * counted as money collected: nothing entered the till or the bank yet.
 *
 * `buildCashReport` is pure (tested); `cashReport` loads the rows with SQL.
 */

export interface CashReportFilter {
  /** Local dates, inclusive. */
  from: string;
  to: string;
  /** null = every store. */
  stores: string[] | null;
  /** Users who received the payment / recorded the movement; null = everyone. */
  sellers: string[] | null;
  /** Tills whose closings are listed; null = every till of the stores. */
  terminals: string[] | null;
}

export interface PaymentRow {
  id: string;
  /** Local date YYYY-MM-DD. */
  day: string;
  method_code: string;
  amount_cents: number;
  fee_cents: number;
  kind: "deposit" | "balance" | "refund" | string;
  counts_as_cash: boolean;
  received_by: string | null;
  establishment_id: string | null;
}

export interface MovementRow {
  id: string;
  at: string;
  day: string;
  session_id: string;
  establishment_id: string;
  terminal_code: string | null;
  kind: "in" | "out" | string;
  category: string | null;
  amount_cents: number;
  note: string | null;
  created_by: string | null;
  /** Automatic lines (sale_payment / sale_refund) point at their sale and ledger payment. */
  sale_id?: string | null;
  payment_id?: string | null;
  terminal_id?: string | null;
}

export interface SessionRow {
  id: string;
  establishment_id: string;
  terminal_code: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_cents: number;
  expected_cents: number | null;
  counted_cents: number | null;
  diff_cents: number | null;
  note: string | null;
  status?: string | null;
  opened_by?: string | null;
  closed_by?: string | null;
  approved_by?: string | null;
  opened_signature?: string | null;
  closed_signature?: string | null;
  approval_signature?: string | null;
  approved_at?: string | null;
}

export type MethodLike = Pick<PaymentMethodRow, "code" | "label" | "label_en" | "kind" | "counts_as_cash" | "builtin"> & { receivable?: boolean };

export interface Person {
  id: string;
  name: string;
  code: string | null;
}

export interface CashReport {
  from: string;
  to: string;
  by_method: Array<{
    code: string;
    label: { es: string | null; en: string | null };
    builtin: boolean;
    kind: string;
    counts_as_cash: boolean;
    receivable: boolean;
    in_count: number;
    in_cents: number;
    refund_cents: number;
    fee_cents: number;
    net_cents: number;
  }>;
  movements: Array<{
    id: string;
    at: string;
    session_id: string;
    establishment_id: string;
    terminal_code: string | null;
    kind: string;
    category: string | null;
    amount_cents: number;
    note: string | null;
    by: Person | null;
    /** True for the lines the register wrote itself (sale payments, refunds, opening float). */
    auto: boolean;
    sale_id: string | null;
    payment_id: string | null;
    terminal_id: string | null;
  }>;
  by_category: Array<{ category: string | null; kind: string; count: number; cents: number }>;
  sessions: Array<{
    id: string;
    establishment_id: string;
    terminal_code: string | null;
    opened_at: string;
    closed_at: string | null;
    opening_cents: number;
    expected_cents: number | null;
    counted_cents: number | null;
    diff_cents: number | null;
    note: string | null;
    status: string;
    opened_by: Person | null;
    closed_by: Person | null;
    approved_by: Person | null;
    opened_signature: string | null;
    closed_signature: string | null;
    approval_signature: string | null;
    approved_at: string | null;
  }>;
  series: Array<{ date: string; payments_cents: number; cash_in_cents: number; cash_out_cents: number; cash_net_cents: number }>;
  totals: {
    payments_cents: number;
    cash_payments_cents: number;
    card_cents: number;
    other_cents: number;
    receivable_cents: number;
    movements_in_cents: number;
    movements_out_cents: number;
    cash_net_cents: number;
    fees_cents: number;
    sessions_diff_cents: number;
  };
  /** Users seen in the period (for the seller filter). */
  people: Person[];
  /**
   * The movement LIST hit MAX_MOVEMENTS. The totals, `by_category` and the
   * per-day series are still complete: `cashReport` reads them from a separate
   * SQL aggregate over the whole period, not from the list.
   */
  truncated: boolean;
}

export const MAX_MOVEMENTS = 5000;

/**
 * One row of the complete ledger aggregate: every `cash_movement` of the
 * period grouped by local day, direction and reason, straight from SQL.
 *
 * The movement LIST is capped at `MAX_MOVEMENTS`; the totals, the per-reason
 * table and the per-day series must not be. With this aggregate they are
 * computed from the whole period even when the list is cut, so "cash in /
 * cash out" is never quietly short of a few thousand lines.
 */
export interface MovementAggRow {
  /** Local date YYYY-MM-DD. */
  day: string;
  kind: "in" | "out" | string;
  category: string | null;
  count: number;
  cents: number;
}

const CARD_KINDS = new Set(["debit", "credit", "card"]);
/** Ledger lines written by the register itself: listed, grouped, but never added on top of the payments they mirror. */
const AUTO_CATEGORIES = new Set(["sale_payment", "sale_refund", "opening_float"]);

const n = (v: unknown): number => Math.round(Number(v) || 0);

/** Pure aggregation of already-scoped rows. */
export function buildCashReport(input: {
  from: string;
  to: string;
  payments: PaymentRow[];
  movements: MovementRow[];
  sessions: SessionRow[];
  methods: MethodLike[];
  people?: Person[];
  truncated?: boolean;
  /** Complete ledger aggregate of the period; without it the (possibly capped) list is used. */
  movementAgg?: MovementAggRow[];
}): CashReport {
  const methods = new Map(input.methods.map((m) => [m.code, m]));
  const people = new Map((input.people ?? []).map((p) => [p.id, p]));
  const isReceivable = (code: string): boolean => {
    const m = methods.get(code);
    return Boolean(m && (m.kind === "insurance" || m.receivable));
  };
  /**
   * Did this money go into the drawer? The flag STORED ON THE ROW decides,
   * because it is the one the till used when it wrote (or did not write) the
   * `cash_movement` line, so it is what the count has to match. The method's
   * current flag is only a fallback for rows written before it existed: using
   * it would make the register disagree with itself the day the owner unticks
   * "counts as cash" on a method.
   */
  const isCash = (p: PaymentRow): boolean => p.counts_as_cash || Boolean(methods.get(p.method_code)?.counts_as_cash);
  /**
   * Signed amount of a payment: a refund is money going OUT, whatever sign it
   * was stored with. `voidSale` writes refunds negative, but a hand-fixed row
   * (or a future partial refund) must not be able to turn a refund into income.
   */
  const signedOf = (p: PaymentRow): number => {
    const amount = n(p.amount_cents);
    return p.kind === "refund" ? -Math.abs(amount) : amount;
  };

  // Per method ----------------------------------------------------------------
  type Agg = { in_count: number; in_cents: number; refund_cents: number; fee_cents: number };
  const byMethod = new Map<string, Agg>();
  for (const p of input.payments) {
    const a = byMethod.get(p.method_code) ?? { in_count: 0, in_cents: 0, refund_cents: 0, fee_cents: 0 };
    const signed = signedOf(p);
    if (signed < 0) a.refund_cents += -signed;
    else {
      a.in_count += 1;
      a.in_cents += signed;
    }
    a.fee_cents += n(p.fee_cents);
    byMethod.set(p.method_code, a);
  }
  const order = [...input.methods.map((m) => m.code), ...[...byMethod.keys()].filter((c) => !methods.has(c))];
  const by_method = order
    .filter((code) => byMethod.has(code))
    .map((code) => {
      const m = methods.get(code);
      const a = byMethod.get(code) as Agg;
      return {
        code,
        label: { es: m?.label ?? null, en: m?.label_en ?? null },
        builtin: Boolean(m?.builtin),
        kind: m?.kind ?? "other",
        counts_as_cash: Boolean(m?.counts_as_cash),
        receivable: isReceivable(code),
        in_count: a.in_count,
        in_cents: a.in_cents,
        refund_cents: a.refund_cents,
        fee_cents: a.fee_cents,
        net_cents: a.in_cents - a.refund_cents,
      };
    });

  // Totals of what was collected ------------------------------------------------
  const totals = {
    payments_cents: 0,
    cash_payments_cents: 0,
    card_cents: 0,
    other_cents: 0,
    receivable_cents: 0,
    movements_in_cents: 0,
    movements_out_cents: 0,
    cash_net_cents: 0,
    fees_cents: 0,
    sessions_diff_cents: 0,
  };
  for (const m of by_method) {
    if (m.receivable) {
      // The insurer's part: listed per method, never counted as collected —
      // nothing has reached the till or the bank yet.
      totals.receivable_cents += m.net_cents;
      continue;
    }
    totals.payments_cents += m.net_cents;
    totals.fees_cents += m.fee_cents;
  }
  // Cash / card / other split off the ROWS, with the same `isCash` the per-day
  // series uses, so `Σ series.cash_net` and `totals.cash_net_cents` agree even
  // when a method's "counts as cash" flag was changed after the fact.
  for (const p of input.payments) {
    if (isReceivable(p.method_code)) continue;
    const signed = signedOf(p);
    if (isCash(p)) totals.cash_payments_cents += signed;
    else if (CARD_KINDS.has(methods.get(p.method_code)?.kind ?? "other")) totals.card_cents += signed;
    else totals.other_cents += signed;
  }

  // Movements: the manual ones count as cash in / out; the automatic lines
  // (sale payments, refunds, opening float) are the ledger's mirror of the
  // payments above and the session's float, so they are listed, not re-added.
  //
  // The figures come from `movementAgg` when the caller passed it (the whole
  // period, straight from SQL) and from the list only as a fallback — the list
  // is capped at MAX_MOVEMENTS and a capped list would understate cash out.
  const ledger: Array<{ day: string; kind: string; category: string | null; count: number; cents: number }> =
    input.movementAgg ?? input.movements.map((mv) => ({ day: mv.day, kind: mv.kind, category: mv.category ?? null, count: 1, cents: n(mv.amount_cents) }));
  const byCat = new Map<string, { category: string | null; kind: string; count: number; cents: number }>();
  for (const row of ledger) {
    const amount = n(row.cents);
    if (!AUTO_CATEGORIES.has(row.category ?? "")) {
      if (row.kind === "in") totals.movements_in_cents += amount;
      else totals.movements_out_cents += amount;
    }
    const key = `${row.kind}|${row.category ?? ""}`;
    const c = byCat.get(key) ?? { category: row.category, kind: row.kind, count: 0, cents: 0 };
    c.count += row.count;
    c.cents += amount;
    byCat.set(key, c);
  }
  const by_category = [...byCat.values()].sort((a, b) => (a.kind === b.kind ? b.cents - a.cents : a.kind === "out" ? -1 : 1));
  const movements = [...input.movements]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .map((mv) => ({
      id: mv.id,
      at: mv.at,
      session_id: mv.session_id,
      establishment_id: mv.establishment_id,
      terminal_code: mv.terminal_code,
      kind: mv.kind,
      category: mv.category,
      amount_cents: n(mv.amount_cents),
      note: mv.note,
      by: mv.created_by ? people.get(mv.created_by) ?? { id: mv.created_by, name: mv.created_by, code: null } : null,
      auto: AUTO_CATEGORIES.has(mv.category ?? ""),
      sale_id: mv.sale_id ?? null,
      payment_id: mv.payment_id ?? null,
      terminal_id: mv.terminal_id ?? null,
    }));

  // Closings --------------------------------------------------------------------
  const who = (id: string | null | undefined): Person | null => (id ? people.get(id) ?? { id, name: id, code: null } : null);
  const sessions = [...input.sessions]
    .sort((a, b) => (a.opened_at < b.opened_at ? 1 : a.opened_at > b.opened_at ? -1 : 0))
    .map((s) => ({
      id: s.id,
      establishment_id: s.establishment_id,
      terminal_code: s.terminal_code,
      opened_at: s.opened_at,
      closed_at: s.closed_at,
      opening_cents: n(s.opening_cents),
      expected_cents: s.expected_cents == null ? null : n(s.expected_cents),
      counted_cents: s.counted_cents == null ? null : n(s.counted_cents),
      diff_cents: s.diff_cents == null ? null : n(s.diff_cents),
      note: s.note,
      status: s.status ?? (s.closed_at ? "closed" : "open"),
      opened_by: who(s.opened_by),
      closed_by: who(s.closed_by),
      approved_by: who(s.approved_by),
      opened_signature: s.opened_signature ?? null,
      closed_signature: s.closed_signature ?? null,
      approval_signature: s.approval_signature ?? null,
      approved_at: s.approved_at ?? null,
    }));
  totals.sessions_diff_cents = sessions.reduce((sum, s) => sum + (s.diff_cents ?? 0), 0);

  // Per day ---------------------------------------------------------------------
  const days = new Map<string, { date: string; payments_cents: number; cash_in_cents: number; cash_out_cents: number; cash_net_cents: number }>();
  const day = (d: string) => {
    const row = days.get(d) ?? { date: d, payments_cents: 0, cash_in_cents: 0, cash_out_cents: 0, cash_net_cents: 0 };
    days.set(d, row);
    return row;
  };
  for (const p of input.payments) {
    if (isReceivable(p.method_code)) continue;
    const row = day(p.day);
    const signed = signedOf(p);
    row.payments_cents += signed;
    if (isCash(p)) row.cash_net_cents += signed;
  }
  for (const mv of ledger) {
    if (AUTO_CATEGORIES.has(mv.category ?? "")) continue;
    const row = day(mv.day);
    const amount = n(mv.cents);
    if (mv.kind === "in") {
      row.cash_in_cents += amount;
      row.cash_net_cents += amount;
    } else {
      row.cash_out_cents += amount;
      row.cash_net_cents -= amount;
    }
  }
  const series = [...days.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  totals.cash_net_cents = totals.cash_payments_cents + totals.movements_in_cents - totals.movements_out_cents;

  const seen = new Set<string>();
  for (const p of input.payments) if (p.received_by) seen.add(p.received_by);
  for (const mv of input.movements) if (mv.created_by) seen.add(mv.created_by);
  const peopleOut = [...seen].map((id) => people.get(id) ?? { id, name: id, code: null }).sort((a, b) => a.name.localeCompare(b.name));

  return { from: input.from, to: input.to, by_method, movements, by_category, sessions, series, totals, people: peopleOut, truncated: Boolean(input.truncated) };
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const isoOf = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();

/** The day after a YYYY-MM-DD, as YYYY-MM-DD (exclusive upper bound). */
export function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);
}

/** Names of panel users, for "who" columns and the seller filter. */
export async function peopleOf(container: MedusaContainer, ids: string[]): Promise<Person[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const users = container.resolve<IUserModuleService>(Modules.USER);
  const [rows, profiles] = await Promise.all([users.listUsers({ id: unique }, { take: unique.length }).catch(() => []), profilesByUser(container, unique)]);
  const byId = new Map(rows.map((u) => [u.id, u]));
  return unique.map((id) => {
    const u = byId.get(id);
    const name = u ? [u.first_name, u.last_name].filter(Boolean).join(" ") || String(u.email ?? "").split("@")[0] || id : id;
    return { id, name, code: profiles.get(id)?.seller_code ?? null };
  });
}

export async function cashReport(container: MedusaContainer, f: CashReportFilter): Promise<CashReport> {
  const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  const tz = tenant().timezone;
  const lo = pg.raw("(?::timestamp AT TIME ZONE ?)", [`${f.from} 00:00:00`, tz]);
  const hi = pg.raw("(?::timestamp AT TIME ZONE ?)", [`${nextDay(f.to)} 00:00:00`, tz]);
  const localDay = (col: string) => pg.raw(`to_char(${col} AT TIME ZONE ?, 'YYYY-MM-DD') AS day`, [tz]);

  const payQ = pg("pos_sale_payment as p")
    .join("pos_sale as s", "s.id", "p.sale_id")
    .whereNull("p.deleted_at")
    .whereNull("s.deleted_at")
    .where("p.created_at", ">=", lo)
    .where("p.created_at", "<", hi)
    .select("p.id", "p.method_code", "p.amount_cents", "p.fee_cents", "p.kind", "p.counts_as_cash", "p.received_by")
    .select(pg.raw("COALESCE(p.establishment_id, s.establishment_id) AS establishment_id"))
    .select(localDay("p.created_at"));
  if (f.stores) payQ.whereRaw("COALESCE(p.establishment_id, s.establishment_id) IN (" + f.stores.map(() => "?").join(",") + ")", f.stores);
  if (f.sellers) payQ.whereIn("p.received_by", f.sellers);

  // The till is the movement's own (where the money went through); sessions from before the store-level register fall back to theirs.
  const mvQ = pg("cash_movement as m")
    .join("cash_session as cs", "cs.id", "m.session_id")
    .leftJoin("pos_terminal as t", "t.id", pg.raw("COALESCE(m.terminal_id, cs.terminal_id)"))
    .whereNull("m.deleted_at")
    .where("m.created_at", ">=", lo)
    .where("m.created_at", "<", hi)
    .select("m.id", "m.created_at", "m.session_id", "cs.establishment_id", "t.code as terminal_code", "m.kind", "m.category", "m.amount_cents", "m.note", "m.created_by", "m.sale_id", "m.payment_id")
    .select(pg.raw("COALESCE(m.terminal_id, cs.terminal_id) AS terminal_id"))
    .select(localDay("m.created_at"))
    .orderBy("m.created_at", "desc")
    .limit(MAX_MOVEMENTS + 1);
  if (f.stores) mvQ.whereIn("cs.establishment_id", f.stores);
  if (f.sellers) mvQ.whereIn("m.created_by", f.sellers);
  if (f.terminals) mvQ.whereRaw("COALESCE(m.terminal_id, cs.terminal_id) IN (" + f.terminals.map(() => "?").join(",") + ")", f.terminals);

  // The same ledger, grouped in the database: the totals and the per-day
  // series are built from this, so they stay complete when the LIST is capped.
  const aggQ = pg("cash_movement as m")
    .join("cash_session as cs", "cs.id", "m.session_id")
    .whereNull("m.deleted_at")
    .where("m.created_at", ">=", lo)
    .where("m.created_at", "<", hi)
    .groupByRaw("1, 2, 3")
    .select(localDay("m.created_at"), "m.kind", "m.category")
    .select(pg.raw("COUNT(*)::int AS count"), pg.raw("COALESCE(SUM(m.amount_cents), 0)::bigint AS cents"));
  if (f.stores) aggQ.whereIn("cs.establishment_id", f.stores);
  if (f.sellers) aggQ.whereIn("m.created_by", f.sellers);
  if (f.terminals) aggQ.whereRaw("COALESCE(m.terminal_id, cs.terminal_id) IN (" + f.terminals.map(() => "?").join(",") + ")", f.terminals);

  // Closings: sessions opened in the period (a register open overnight belongs to the day it opened).
  const sesQ = pg("cash_session as cs")
    .leftJoin("pos_terminal as t", "t.id", "cs.terminal_id")
    .whereNull("cs.deleted_at")
    .where("cs.opened_at", ">=", lo)
    .where("cs.opened_at", "<", hi)
    .select("cs.id", "cs.establishment_id", "t.code as terminal_code", "cs.opened_at", "cs.closed_at", "cs.opening_cents", "cs.expected_cents", "cs.counted_cents", "cs.diff_cents", "cs.note")
    .select("cs.status", "cs.opened_by", "cs.closed_by", "cs.approved_by", "cs.opened_signature", "cs.closed_signature", "cs.approval_signature", "cs.approved_at")
    .orderBy("cs.opened_at", "desc")
    .limit(2000);
  // Sessions are the store's (not a till's) since CreatePos5: a till filter never hides them.
  if (f.stores) sesQ.whereIn("cs.establishment_id", f.stores);

  const [payRows, mvRowsAll, aggRows, sesRows, methods] = await Promise.all([
    payQ as unknown as Promise<Record<string, unknown>[]>,
    mvQ as unknown as Promise<Record<string, unknown>[]>,
    aggQ as unknown as Promise<Record<string, unknown>[]>,
    sesQ as unknown as Promise<Record<string, unknown>[]>,
    listPaymentMethods(container),
  ]);
  const truncated = mvRowsAll.length > MAX_MOVEMENTS;
  const mvRows = truncated ? mvRowsAll.slice(0, MAX_MOVEMENTS) : mvRowsAll;

  const payments: PaymentRow[] = payRows.map((r) => ({
    id: String(r.id),
    day: String(r.day),
    method_code: String(r.method_code),
    amount_cents: n(r.amount_cents),
    fee_cents: n(r.fee_cents),
    kind: String(r.kind ?? "deposit"),
    counts_as_cash: Boolean(r.counts_as_cash),
    received_by: (r.received_by as string | null) ?? null,
    establishment_id: (r.establishment_id as string | null) ?? null,
  }));
  const movements: MovementRow[] = mvRows.map((r) => ({
    id: String(r.id),
    at: isoOf(r.created_at),
    day: String(r.day),
    session_id: String(r.session_id),
    establishment_id: String(r.establishment_id),
    terminal_code: (r.terminal_code as string | null) ?? null,
    kind: String(r.kind),
    category: (r.category as string | null) ?? null,
    amount_cents: n(r.amount_cents),
    note: (r.note as string | null) ?? null,
    created_by: (r.created_by as string | null) ?? null,
    sale_id: (r.sale_id as string | null) ?? null,
    payment_id: (r.payment_id as string | null) ?? null,
    terminal_id: (r.terminal_id as string | null) ?? null,
  }));
  const sessions: SessionRow[] = sesRows.map((r) => ({
    id: String(r.id),
    establishment_id: String(r.establishment_id),
    terminal_code: (r.terminal_code as string | null) ?? null,
    opened_at: isoOf(r.opened_at),
    closed_at: r.closed_at ? isoOf(r.closed_at) : null,
    opening_cents: n(r.opening_cents),
    expected_cents: r.expected_cents == null ? null : n(r.expected_cents),
    counted_cents: r.counted_cents == null ? null : n(r.counted_cents),
    diff_cents: r.diff_cents == null ? null : n(r.diff_cents),
    note: (r.note as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    opened_by: (r.opened_by as string | null) ?? null,
    closed_by: (r.closed_by as string | null) ?? null,
    approved_by: (r.approved_by as string | null) ?? null,
    opened_signature: (r.opened_signature as string | null) ?? null,
    closed_signature: (r.closed_signature as string | null) ?? null,
    approval_signature: (r.approval_signature as string | null) ?? null,
    approved_at: r.approved_at ? isoOf(r.approved_at) : null,
  }));
  const people = await peopleOf(container, [
    ...payments.map((p) => p.received_by ?? ""),
    ...movements.map((m) => m.created_by ?? ""),
    ...sessions.flatMap((s) => [s.opened_by ?? "", s.closed_by ?? "", s.approved_by ?? ""]),
  ]);
  const movementAgg: MovementAggRow[] = aggRows.map((r) => ({
    day: String(r.day),
    kind: String(r.kind),
    category: (r.category as string | null) ?? null,
    count: n(r.count),
    cents: n(r.cents),
  }));
  return buildCashReport({ from: f.from, to: f.to, payments, movements, sessions, methods, people, truncated, movementAgg });
}

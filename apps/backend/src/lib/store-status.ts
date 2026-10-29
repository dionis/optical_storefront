import type { MedusaContainer } from "@medusajs/framework/types";
import { localParts } from "./alerts";
import { listSessions } from "./cash";
import type { EstablishmentRow } from "./establishments";
import { listApprovals, listClaims, listSales, listTerminals } from "./pos-data";
import { readyToHand, type ReadySale } from "./ready-orders";
import { salesBreakdown, salesSummary, type Summary } from "./sales-analytics";
import { listSellers } from "./sellers";
import { tenant } from "./tenant";

/**
 * Store status: one store right now, for its owner and managers — sales today
 * against the day before, week and month; who is selling; each till with its
 * register; what is waiting on someone (approvals, void requests, balances,
 * insurers, orders back from the lab); the latest sales; and a short list of
 * what needs attention. Read-only: every action stays in its own tab.
 */

/** Register open longer than this is flagged: it was probably not closed last night. */
export const LONG_OPEN_REGISTER_HOURS = 14;

export interface TillStatus {
  id: string;
  code: string;
  name: string | null;
  is_active: boolean;
  /** Open register on this till, null when closed. */
  register: { id: string; opened_at: string; opening: number; expected: number; cash_in_sales: number } | null;
  /** Seller records assigned to it. */
  sellers: Array<{ id: string; code: string; name: string; active: boolean }>;
}

export interface SellerStatus {
  id: string;
  code: string;
  name: string;
  active: boolean;
  /** A panel user sells at the counter with this record. */
  has_user: boolean;
  terminal_code: string | null;
  today_total: number;
  today_count: number;
}

export type AttentionKind =
  | "no_active_till"
  | "register_open_long"
  | "approvals_pending"
  | "voids_requested"
  | "ready_to_hand"
  | "counter_seller_inactive"
  | "till_without_register";

export interface Attention {
  kind: AttentionKind;
  /** How many things, or hours for register_open_long. */
  n: number;
  /** Code of the till or seller concerned, when it is one. */
  ref?: string;
  tone: "bad" | "warn" | "info";
}

/**
 * What needs someone's attention in the store, most urgent first. Pure: the
 * route passes what it loaded. `now` is injectable for tests.
 */
export function storeAttention(
  input: {
    tills: Array<Pick<TillStatus, "code" | "is_active" | "register">>;
    sellers: Array<Pick<SellerStatus, "code" | "active" | "has_user">>;
    approvals_pending: number;
    voids_requested: number;
    ready: number;
  },
  now = new Date()
): Attention[] {
  const out: Attention[] = [];
  const active = input.tills.filter((t) => t.is_active);
  if (!active.length) out.push({ kind: "no_active_till", n: 0, tone: "bad" });
  for (const t of input.tills) {
    if (!t.register) continue;
    const hours = Math.floor((now.getTime() - Date.parse(t.register.opened_at)) / 3_600_000);
    if (hours >= LONG_OPEN_REGISTER_HOURS) out.push({ kind: "register_open_long", n: hours, ref: t.code, tone: "bad" });
  }
  if (input.approvals_pending) out.push({ kind: "approvals_pending", n: input.approvals_pending, tone: "warn" });
  if (input.voids_requested) out.push({ kind: "voids_requested", n: input.voids_requested, tone: "warn" });
  // A user who sells with an inactive record is locked out of the counter.
  for (const s of input.sellers) if (s.has_user && !s.active) out.push({ kind: "counter_seller_inactive", n: 0, ref: s.code, tone: "warn" });
  if (input.ready) out.push({ kind: "ready_to_hand", n: input.ready, tone: "info" });
  const closed = active.filter((t) => !t.register).length;
  if (active.length && closed === active.length) out.push({ kind: "till_without_register", n: closed, tone: "info" });
  return out;
}

export interface StoreStatus {
  store: { id: string; code: string; name: string; is_active: boolean };
  today: Summary;
  /** The day before, for the comparison. */
  yesterday: Summary;
  week: Summary;
  month: Summary;
  balance_due: number;
  insurance_due: number;
  tills: TillStatus[];
  sellers: SellerStatus[];
  pending: {
    approvals: number;
    voids: number;
    with_balance: { count: number; amount: number };
    insurance_claims: number;
    ready: ReadySale[];
  };
  recent: Array<{ id: string; number: string; seller_code: string | null; terminal_code: string | null; total: number; balance: number; status: string; delivered: boolean; created_at: string }>;
  attention: Attention[];
}

export async function storeStatus(container: MedusaContainer, store: EstablishmentRow): Promise<StoreStatus> {
  const tz = tenant().timezone;
  const today = localParts(new Date(), tz);
  const back = (days: number) => new Date(Date.parse(`${today.date}T00:00:00Z`) - days * 86400_000).toISOString().slice(0, 10);
  const weekStart = back((today.weekday + 6) % 7); // Monday
  const monthStart = `${today.date.slice(0, 8)}01`;
  const base = { to: today.date, stores: [store.id], sellers: null };

  const [d, w, m, bySeller, tills, sessions, allSellers, approvals, claims, recentSales, openSales] = await Promise.all([
    salesSummary(container, { ...base, from: today.date }),
    salesSummary(container, { ...base, from: weekStart }),
    salesSummary(container, { ...base, from: monthStart }),
    salesBreakdown(container, { ...base, from: today.date }, "seller", 100),
    listTerminals(container, [store.id]),
    listSessions(container, [store.id], 50),
    listSellers(container),
    listApprovals(container, { status: "pending", establishmentIds: [store.id] }, 200),
    listClaims(container, { establishmentIds: [store.id] }),
    listSales(container, { establishmentIds: [store.id] }, 10),
    listSales(container, { establishmentIds: [store.id], status: "completed" }, 300),
  ]);

  const open = new Map(sessions.filter((s) => !s.closed_at).map((s) => [s.terminal_id, s]));
  const sellers = allSellers.filter((s) => s.establishment_id === store.id);
  const tillCode = new Map(tills.map((t) => [t.id, t.code]));
  const todayByCode = new Map(bySeller.map((r) => [String(r.key ?? "").toUpperCase(), r]));

  const tillRows: TillStatus[] = tills
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    .map((t) => {
      const s = open.get(t.id);
      return {
        id: t.id,
        code: t.code,
        name: t.name,
        is_active: t.is_active,
        register: s ? { id: s.id, opened_at: s.opened_at, opening: s.opening, expected: s.expected, cash_in_sales: s.cash_in_sales } : null,
        sellers: sellers.filter((x) => x.terminal_id === t.id).map((x) => ({ id: x.id, code: x.code, name: x.name, active: x.active })),
      };
    });

  const sellerRows: SellerStatus[] = sellers
    .map((s) => {
      const r = todayByCode.get(s.code);
      return {
        id: s.id,
        code: s.code,
        name: s.name,
        active: s.active,
        has_user: Boolean(s.user_id),
        terminal_code: s.terminal_id ? tillCode.get(s.terminal_id) ?? null : null,
        today_total: r?.total ?? 0,
        today_count: r?.count ?? 0,
      };
    })
    .sort((a, b) => b.today_total - a.today_total || Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "es"));

  const withBalance = openSales.filter((s) => s.balance > 0);
  const voids = openSales.filter((s) => s.void_requested_at).length;
  const ready = await readyToHand(container, openSales);
  const insuranceClaims = claims.filter((c) => c.status === "pending" || c.status === "submitted").length;

  return {
    store: { id: store.id, code: store.code, name: store.name, is_active: store.is_active },
    today: d.current,
    yesterday: d.previous,
    week: w.current,
    month: m.current,
    balance_due: m.balance_due,
    insurance_due: m.insurance_due,
    tills: tillRows,
    sellers: sellerRows,
    pending: {
      approvals: approvals.length,
      voids,
      with_balance: { count: withBalance.length, amount: Math.round(withBalance.reduce((a, s) => a + s.balance, 0) * 100) / 100 },
      insurance_claims: insuranceClaims,
      ready,
    },
    recent: recentSales.map((s) => ({
      id: s.id,
      number: s.number,
      seller_code: s.seller_code,
      terminal_code: s.terminal_id ? tillCode.get(s.terminal_id) ?? null : null,
      total: s.total,
      balance: s.balance,
      status: s.status,
      delivered: Boolean(s.delivered_at),
      created_at: s.created_at,
    })),
    attention: storeAttention({ tills: tillRows, sellers: sellerRows, approvals_pending: approvals.length, voids_requested: voids, ready: ready.length }),
  };
}

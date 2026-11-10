import { commissionResolverOf } from "./commission-pct";
import { loadDefaultCommissionPct } from "./store-cost-toggle";
import type { Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { localParts } from "./alerts";
import { loadCostingContext } from "./costing";
import type { EstablishmentRow } from "./establishments";
import { loadProductMetadata } from "./frame-specs";
import { fetchBoardOrdersByIds } from "./order-board";
import { deriveOrderProgress, stageIndex, type OrderStage } from "./order-status";
import { canSellAt, sellableStores } from "./pos";
import { PosError } from "./pos-data";
import type { AnalyticsFilter } from "./sales-analytics";
import {
  insightAccess,
  lineEconomics,
  linesQuery,
  MAX_INSIGHT_LINES,
  orderTotalsQuery,
  saleFeesQuery,
  type InsightAccess,
  type InsightLine,
  type LineEconomics,
} from "./sales-insights";
import { findSellerById, findSellerByCode, sellerStats, type SourceStatRow } from "./sellers";
import { profilesByUser } from "./staff-profile-data";
import type { StaffScope } from "./staff-scope";
import { tenant } from "./tenant";

/**
 * The start map (GET /admin/pos/start-map): the one screen that opens the
 * panel. Everything on it is a door to where the person operates, so it
 * carries only numbers, each with the range or rule behind it:
 *
 *   periods   sales of yesterday, today, this week, last week, this month and
 *             last month, each against its previous equivalent (today against
 *             yesterday, this week against last week, this month against last
 *             month…), with the cost, profit and commission of the same lines
 *             (lib/sales-insights.ts lineEconomics) when the caller may see them;
 *   pending   what is waiting on someone: orders in the laboratory, glasses
 *             back from it and not yet handed over, the money "on the street"
 *             (balances customers still owe), the ones already past their
 *             promised date, discounts to approve, registers still open;
 *   stores    one line per store (admins, supervisors and managers; never a
 *             seller, who by the owner's rule sees no store's general status).
 *
 * Scope (the owner's permission matrix, lib/pos-route.ts): owner and
 * superadmin everything (`?store=` narrows to one store or the web);
 * supervisor and manager their stores; a seller ONLY their own sales — except
 * the money on the street and the overdue balances, which cover their store
 * because they may collect a colleague's balance at the counter.
 *
 * One seller (`?seller=<id|code>`, the seller panel of the Executive): the same
 * map restricted to that seller's sales (lines with their code: counter sales
 * and web referrals), their pending lab buckets and the balances of THEIR
 * sales, and `subject` describing them (resolveSubjectScope). Admins,
 * supervisors and managers may ask for a seller of their stores; a seller only
 * for themselves.
 *
 * Lab rule (documented here because the lab has no digital trail): a counter
 * sale is "in the laboratory" while it is completed, not handed over
 * (`delivered_at` null) and its Medusa order has not reached the `shipped`
 * stage (lib/order-status.ts: `metadata.lab_stage` set from the order board,
 * or inferred); once the order is `shipped` or later it is "to deliver" until
 * the seller marks the sale delivered. A sale whose order cannot be read counts
 * as in the lab (the conservative side); a canceled order counts nowhere.
 * Amounts are in cents.
 */

export const PERIOD_KEYS = ["yesterday", "today", "this_week", "last_week", "this_month", "last_month"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export interface DayRange {
  from: string;
  to: string;
}

export interface PeriodRanges {
  ranges: Record<PeriodKey, DayRange>;
  /** The previous equivalent of each period; null when it falls before `span` (not loaded). */
  previous: Record<PeriodKey, DayRange | null>;
  /** The whole stretch of days the lines are read for: first day of last month to today. */
  span: DayRange;
  today: string;
}

const DAY_MS = 86400_000;
const ymdOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const shift = (ymd: string, days: number) => ymdOf(Date.parse(`${ymd}T00:00:00Z`) + days * DAY_MS);
const monthStart = (ymd: string) => `${ymd.slice(0, 8)}01`;

/** The ranges of the map for a local calendar day. `weekday` is 0 = Sunday … 6 = Saturday; weeks start on Monday. Pure. */
export function periodRanges(today: string, weekday: number): PeriodRanges {
  const yesterday = shift(today, -1);
  const monday = shift(today, -((weekday + 6) % 7));
  const lastMonday = shift(monday, -7);
  const lastMonthEnd = shift(monthStart(today), -1);
  const lastMonthStart = monthStart(lastMonthEnd);
  const span = { from: lastMonthStart, to: today };
  const ranges: Record<PeriodKey, DayRange> = {
    today: { from: today, to: today },
    yesterday: { from: yesterday, to: yesterday },
    this_week: { from: monday, to: today },
    last_week: { from: lastMonday, to: shift(monday, -1) },
    this_month: { from: monthStart(today), to: today },
    last_month: { from: lastMonthStart, to: lastMonthEnd },
  };
  const inSpan = (r: DayRange): DayRange | null => (r.from >= span.from ? r : null);
  const previous: Record<PeriodKey, DayRange | null> = {
    today: ranges.yesterday,
    yesterday: inSpan({ from: shift(yesterday, -1), to: shift(yesterday, -1) }),
    this_week: ranges.last_week,
    last_week: inSpan({ from: shift(lastMonday, -7), to: shift(lastMonday, -1) }),
    this_month: ranges.last_month,
    // The month before last is outside the span: no comparison for last month.
    last_month: null,
  };
  return { ranges, previous, span, today };
}

export interface PeriodFigures extends DayRange {
  sales_cents: number;
  count: number;
  units: number;
  /**
   * Cost of those lines INCLUDING the payment fee: materials, the fixed costs
   * per order and the fee of the collection. The Executive splits the two
   * (`cost` and `fee`), so `cost_cents = Executive cost + Executive fee` —
   * `fee_cents` below carries the fee on its own so the two screens can be
   * reconciled line by line. Null when the caller may not see costs
   * (lib/sales-insights.ts insightAccess).
   */
  cost_cents: number | null;
  /** The payment fee already inside `cost_cents`; null with the cost. */
  fee_cents: number | null;
  profit_cents: number | null;
  /** null when the caller may not see commissions; a seller gets their own. */
  commission_cents: number | null;
  /** Sales over orders; 0 without orders. */
  avg_ticket_cents: number;
  /** Profit over orders; null when the caller may not see profit. */
  avg_profit_per_sale_cents: number | null;
  /** The previous equivalent period, for the delta; null when it was not loaded. */
  prev: { sales_cents: number; count: number; cost_cents: number | null; fee_cents: number | null; profit_cents: number | null; commission_cents: number | null } | null;
}

interface Tally {
  sales: number;
  units: number;
  /** Materials and per-order fixed costs plus the payment fee (see PeriodFigures.cost_cents). */
  cost: number;
  fee: number;
  profit: number;
  commission: number;
  orders: Set<string>;
}

const newTally = (): Tally => ({ sales: 0, units: 0, cost: 0, fee: 0, profit: 0, commission: 0, orders: new Set() });

/** Key of a line's store: the web store is "web". */
export const storeKeyOf = (l: Pick<InsightLine, "channel" | "establishment_id">): string => (l.channel === "web" ? "web" : l.establishment_id ?? "none");

export interface StoreSales {
  today_cents: number;
  week_cents: number;
  month_cents: number;
}

/**
 * The periods and the per-store sales out of the lines of `span`, with their
 * economics when given (null = the caller may not see them; then cost, profit
 * and commission stay null). Pure.
 */
export function aggregateSales(
  lines: InsightLine[],
  econ: LineEconomics[] | null,
  pr: PeriodRanges,
  access: Pick<InsightAccess, "profit" | "commission">
): { periods: Record<PeriodKey, PeriodFigures>; byStore: Map<string, StoreSales> } {
  // day → store → tally; an order lives on one day in one store.
  const days = new Map<string, Map<string, Tally>>();
  lines.forEach((l, i) => {
    const day = l.sold_date_local;
    if (!days.has(day)) days.set(day, new Map());
    const stores = days.get(day)!;
    const key = storeKeyOf(l);
    if (!stores.has(key)) stores.set(key, newTally());
    const t = stores.get(key)!;
    t.sales += l.total_cents;
    t.units += l.qty;
    t.orders.add(l.order_id);
    const e = econ?.[i];
    if (e) {
      t.cost += e.cost + e.fee;
      t.fee += e.fee;
      t.profit += e.profit;
      t.commission += e.commission;
    }
  });

  const sum = (r: DayRange, store?: string): Tally => {
    const out = newTally();
    for (const [day, stores] of days) {
      if (day < r.from || day > r.to) continue;
      for (const [key, t] of stores) {
        if (store && key !== store) continue;
        out.sales += t.sales;
        out.units += t.units;
        out.cost += t.cost;
        out.fee += t.fee;
        out.profit += t.profit;
        out.commission += t.commission;
        for (const o of t.orders) out.orders.add(o);
      }
    }
    return out;
  };
  const money = (t: Tally) => ({
    sales_cents: t.sales,
    count: t.orders.size,
    cost_cents: econ && access.profit ? t.cost : null,
    fee_cents: econ && access.profit ? t.fee : null,
    profit_cents: econ && access.profit ? t.profit : null,
    commission_cents: econ && access.commission ? t.commission : null,
  });

  const per = (v: number, n: number) => (n ? Math.round(v / n) : 0);
  const periods = {} as Record<PeriodKey, PeriodFigures>;
  for (const k of PERIOD_KEYS) {
    const cur = sum(pr.ranges[k]);
    const prev = pr.previous[k];
    const m = money(cur);
    periods[k] = {
      ...pr.ranges[k],
      ...m,
      units: cur.units,
      avg_ticket_cents: per(m.sales_cents, m.count),
      avg_profit_per_sale_cents: m.profit_cents === null ? null : per(m.profit_cents, m.count),
      prev: prev ? money(sum(prev)) : null,
    };
  }

  const byStore = new Map<string, StoreSales>();
  const keys = new Set<string>();
  for (const stores of days.values()) for (const k of stores.keys()) keys.add(k);
  for (const key of keys) {
    byStore.set(key, {
      today_cents: sum(pr.ranges.today, key).sales,
      week_cents: sum(pr.ranges.this_week, key).sales,
      month_cents: sum(pr.ranges.this_month, key).sales,
    });
  }
  return { periods, byStore };
}

// ── Pending ──────────────────────────────────────────────────────────────────

/** A counter sale as the pending rules read it (pos_sale columns, cents). */
export interface OpenSaleRow {
  id: string;
  establishment_id: string;
  seller_id: string | null;
  order_id: string | null;
  status: string;
  total_cents: number;
  balance_cents: number;
  /** YYYY-MM-DD the glasses were promised for. */
  promised_on: string | null;
  delivered_at: string | null;
}

export interface Bucket {
  count: number;
  /** Value of those sales (their totals). */
  cents: number;
  /** What customers still owe on them. */
  balance_cents: number;
}

export interface Pending {
  in_lab: Bucket;
  to_deliver: Bucket;
  /** Balances customers still owe on completed sales (delivered or not): `cents` = the balance. */
  on_street: { count: number; cents: number };
  /** Balances past their promised date. */
  overdue_balances: { count: number; cents: number };
  approvals: number;
  open_tills: number;
}

export interface StorePending {
  on_street_cents: number;
  in_lab: number;
  to_deliver: number;
}

/** The stage of a sale's order: an OrderStage, "terminal" (canceled/refunded) or undefined (not read). */
export type StageLookup = (orderId: string | null) => OrderStage | "terminal" | undefined;

/** What is "in the lab" or "to deliver" by the lab rule above (an open, completed sale). Pure. */
export function labBucketOf(sale: Pick<OpenSaleRow, "status" | "delivered_at" | "order_id">, stage: OrderStage | "terminal" | undefined): "in_lab" | "to_deliver" | null {
  if (sale.status !== "completed" || sale.delivered_at) return null;
  if (stage === "terminal") return null;
  if (stage && stageIndex(stage) >= stageIndex("shipped")) return "to_deliver";
  return "in_lab";
}

/**
 * The pending figures out of the open sales. `ownSellerId` restricts the lab
 * buckets to that seller's sales (a seller's map); `collectStores` restricts
 * the balances to those stores (null = every store read). Pure.
 */
export function pendingOf(
  sales: OpenSaleRow[],
  stageOf: StageLookup,
  opts: { today: string; ownSellerId: string | null; collectStores: string[] | null }
): { pending: Omit<Pending, "approvals" | "open_tills">; byStore: Map<string, StorePending> } {
  const bucket = (): Bucket => ({ count: 0, cents: 0, balance_cents: 0 });
  const out = { in_lab: bucket(), to_deliver: bucket(), on_street: { count: 0, cents: 0 }, overdue_balances: { count: 0, cents: 0 } };
  const byStore = new Map<string, StorePending>();
  const storeOf = (id: string) => {
    if (!byStore.has(id)) byStore.set(id, { on_street_cents: 0, in_lab: 0, to_deliver: 0 });
    return byStore.get(id)!;
  };
  for (const s of sales) {
    if (s.status !== "completed") continue;
    const mine = !opts.ownSellerId || s.seller_id === opts.ownSellerId;
    if (mine) {
      const b = labBucketOf(s, stageOf(s.order_id));
      if (b) {
        out[b].count += 1;
        out[b].cents += s.total_cents;
        out[b].balance_cents += s.balance_cents;
        storeOf(s.establishment_id)[b] += 1;
      }
    }
    const collectable = !opts.collectStores || opts.collectStores.includes(s.establishment_id);
    if (collectable && s.balance_cents > 0) {
      out.on_street.count += 1;
      out.on_street.cents += s.balance_cents;
      storeOf(s.establishment_id).on_street_cents += s.balance_cents;
      if (s.promised_on && s.promised_on < opts.today) {
        out.overdue_balances.count += 1;
        out.overdue_balances.cents += s.balance_cents;
      }
    }
  }
  return { pending: out, byStore };
}

// ── Scope ────────────────────────────────────────────────────────────────────

/** An order of the online store that is not finished: its stage and what it is worth. */
export interface OpenWebOrder {
  id: string;
  total_cents: number;
  stage: OrderStage;
  terminal: string | null;
}

/**
 * The online store's part of the lab buckets. A web order is paid when placed
 * and has no till sale, so the rule of the stages applies (lib/order-status.ts):
 * confirmed or in the laboratory → "in the lab"; packed or on its way → "to
 * deliver"; delivered, canceled, refunded or not paid → nowhere. Pure.
 */
export function webPendingOf(orders: OpenWebOrder[]): { in_lab: Bucket; to_deliver: Bucket } {
  const out = { in_lab: { count: 0, cents: 0, balance_cents: 0 }, to_deliver: { count: 0, cents: 0, balance_cents: 0 } };
  for (const o of orders) {
    if (o.terminal) continue;
    const i = stageIndex(o.stage);
    if (i >= stageIndex("delivered")) continue;
    const b = i >= stageIndex("shipped") ? out.to_deliver : out.in_lab;
    b.count += 1;
    b.cents += o.total_cents;
  }
  return out;
}

export interface StartScope {
  /** Filter of the sales lines (lib/sales-analytics.ts applyFilter). */
  sales: Pick<AnalyticsFilter, "stores" | "sellers" | "sellerCodes">;
  /** Stores whose open sales are read; null = every store. ["-"] = none (the web). */
  pendingStores: string[] | null;
  /** A seller: only their own sales in the lab buckets. */
  ownSellerId: string | null;
  /** Stores whose balances the person may collect (a seller: their store). */
  collectStores: string[] | null;
  /** Per-store lines go out (never to a seller). */
  showStores: boolean;
  /** The online store's unfinished orders count in the lab buckets (an administrator looking at everything or at the web). */
  webPending?: boolean;
}

const NONE = ["-"];

/**
 * What the map covers for `scope` and `?store=` ("all" or empty, "web" or a
 * store id). Throws PosError `forbidden_store` for a store outside the
 * person's scope (and the web for anyone but an admin). Pure.
 */
export function resolveStartScope(
  scope: Pick<StaffScope, "is_admin" | "role" | "establishment_ids" | "user_id" | "seller">,
  stores: Array<Pick<EstablishmentRow, "id" | "is_active">>,
  storeParam: string
): StartScope {
  const param = (storeParam || "all").trim();
  const seller = !scope.is_admin && scope.role === "seller";
  if (param === "web") {
    if (!scope.is_admin) throw new PosError("forbidden_store", 403);
    return { sales: { stores: ["web"], sellers: null }, pendingStores: NONE, ownSellerId: null, collectStores: NONE, showStores: true, webPending: true };
  }
  if (param !== "all") {
    if (!stores.some((s) => s.id === param) || !canSellAt(scope, param)) throw new PosError("forbidden_store", 403);
    return seller
      ? { sales: { stores: [param], sellers: [scope.user_id] }, pendingStores: [param], ownSellerId: scope.user_id, collectStores: [param], showStores: false }
      : { sales: { stores: [param], sellers: null }, pendingStores: [param], ownSellerId: null, collectStores: [param], showStores: true };
  }
  if (scope.is_admin) return { sales: { stores: null, sellers: null }, pendingStores: null, ownSellerId: null, collectStores: null, showStores: true, webPending: true };
  const mine = sellableStores(scope, stores).map((s) => s.id);
  if (seller) {
    // Their own sales wherever they made them; the balances of the store they sell in.
    const home = scope.seller?.establishment_id ? [scope.seller.establishment_id] : mine.length ? mine : NONE;
    return { sales: { stores: null, sellers: [scope.user_id] }, pendingStores: null, ownSellerId: scope.user_id, collectStores: home, showStores: false };
  }
  const ids = mine.length ? mine : NONE;
  return { sales: { stores: ids, sellers: null }, pendingStores: ids, ownSellerId: null, collectStores: ids, showStores: true };
}

/** The seller the map is about (`?seller=`): the seller record, as lib/sellers.ts projects it. */
export interface SubjectSeller {
  id: string;
  code: string;
  name: string;
  user_id: string | null;
  establishment_id: string | null;
  commission_pct: number;
  active: boolean;
}

/**
 * The scope of one seller's map (`?seller=`): the caller's own scope
 * (resolveStartScope) narrowed to the lines that carry the seller's code —
 * counter sales and web referrals alike — and to the open sales they made.
 * Permission: an admin asks for anyone; a supervisor or manager only for a
 * seller of a store they run (`forbidden_store`); a seller only for
 * themselves (`forbidden_role`). Store lines never go out: the map is about
 * a person. Pure.
 */
export function resolveSubjectScope(
  scope: Pick<StaffScope, "is_admin" | "role" | "establishment_ids" | "user_id" | "seller">,
  stores: Array<Pick<EstablishmentRow, "id" | "is_active">>,
  storeParam: string,
  seller: SubjectSeller
): StartScope {
  const self = !scope.is_admin && scope.role === "seller";
  if (self) {
    const own = (seller.user_id !== null && seller.user_id === scope.user_id) || (scope.seller?.id !== undefined && scope.seller?.id === seller.id);
    if (!own) throw new PosError("forbidden_role", 403);
  } else if (!scope.is_admin) {
    if (!seller.establishment_id || !canSellAt(scope, seller.establishment_id)) throw new PosError("forbidden_store", 403);
  }
  const base = resolveStartScope(scope, stores, storeParam);
  // A seller with no panel user (referral only) made no counter sale: "-" matches none.
  const ownSellerId = seller.user_id ?? "-";
  return {
    sales: { stores: base.sales.stores, sellers: null, sellerCodes: [seller.code] },
    pendingStores: base.pendingStores,
    ownSellerId,
    // The balances of THEIR sales (the on-street money the panel shows), inside the caller's stores.
    collectStores: base.pendingStores,
    showStores: false,
  };
}

// ── Loading ──────────────────────────────────────────────────────────────────

export interface StartMapStore {
  id: string;
  code: string;
  name: string;
  color: string | null;
  today_cents: number;
  week_cents: number;
  month_cents: number;
  on_street_cents: number;
  in_lab: number;
  to_deliver: number;
}

/** Who a `?seller=` map is about. */
export interface StartSubject {
  id: string;
  code: string;
  name: string;
  active: boolean;
  user_id: string | null;
  store_id: string | null;
  store_code: string | null;
  store_name: string | null;
  color: string | null;
  commission_pct: number;
  /** Where their web referrals came from over the span (lib/sellers.ts); [] when the board could not be read. */
  by_source: SourceStatRow[];
}

export interface StartMap {
  today: string;
  periods: Record<PeriodKey, PeriodFigures>;
  pending: Pending;
  stores: StartMapStore[];
  me: {
    role: string | null;
    seller_code: string | null;
    store_code: string | null;
    store_name: string | null;
    store_color: string | null;
    /** The CALLER's own commission this month; null unless the map covers their own sales (never the chain's bill). */
    commission_month_cents: number | null;
  };
  /** The seller of a `?seller=` map; null on the caller's own map. */
  subject: StartSubject | null;
  access: InsightAccess;
  /** More lines than read in the span: the month figures are partial. */
  truncated: boolean;
  /** More open sales than MAX_OPEN_SALES: the `pending` buckets and the money on the street are partial. */
  pending_truncated: boolean;
}

/** Open sales read for the pending figures. */
const MAX_OPEN_SALES = 2000;

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

async function loadLines(pg: Knex, f: AnalyticsFilter, tz: string): Promise<{ lines: InsightLine[]; truncated: boolean }> {
  // Same reader as the sales panel (MAX_INSIGHT_LINES + 1 rows): past it the month figures are partial.
  const rows = (await linesQuery(pg, f, tz)) as Array<Record<string, unknown>>;
  const truncated = rows.length > MAX_INSIGHT_LINES;
  const kept = truncated ? rows.slice(0, MAX_INSIGHT_LINES) : rows;
  const meta = await loadProductMetadata(pg, [...new Set(kept.map((r) => String(r.product_id ?? "")).filter(Boolean))]);
  return {
    truncated,
    lines: kept.map((r) => {
      const m = meta.get(String(r.product_id ?? "")) ?? {};
      return {
        ...(r as unknown as InsightLine),
        brand_slug: ((m.brand_slug ?? m.collection_slug) as string | undefined) ?? null,
        qty: Number(r.qty),
        total_cents: Number(r.total_cents),
        tax_cents: Number(r.tax_cents),
        hour: Number(r.hour),
      };
    }),
  };
}

/** The lines of the span with their economics (lib/sales-insights.ts), or without them when the caller may see none. */
async function loadEconomics(container: MedusaContainer, f: AnalyticsFilter, access: InsightAccess): Promise<{ lines: InsightLine[]; econ: LineEconomics[] | null; truncated: boolean }> {
  const pg = pgOf(container);
  const cur = await loadLines(pg, f, tenant().timezone);
  if (!access.profit && !access.commission) return { ...cur, econ: null };
  const [orderRows, feeRows, costing] = await Promise.all([
    orderTotalsQuery(pg, f) as Promise<Array<Record<string, unknown>>>,
    saleFeesQuery(pg, f) as Promise<Array<Record<string, unknown>>>,
    loadCostingContext(container),
  ]);
  const sellerIds = [...new Set(cur.lines.map((l) => l.seller_id).filter((v): v is string => Boolean(v)))];
  // One precedence everywhere (lib/commission-pct.ts): profile, seller record, default.
  const [profiles, defaultPct] = await Promise.all([profilesByUser(container, sellerIds), loadDefaultCommissionPct(container)]);
  const commissionPct = commissionResolverOf(profiles, costing.sellerByCode, defaultPct);
  const econ = lineEconomics(cur.lines, {
    rules: costing.rules,
    orders: new Map(orderRows.map((r) => [String(r.order_id), { gross: Number(r.gross), net: Number(r.net), lines: Number(r.lines) }])),
    saleFees: new Map(feeRows.map((r) => [String(r.sale_id), Number(r.fee)])),
    commissionPct,
  });
  return { ...cur, econ };
}

/**
 * Completed sales not handed over or still owed, in `stores` (null = all) or
 * sold by `sellerId`; with `both`, in those stores AND by that seller (a
 * seller's map).
 */
async function loadOpenSales(pg: Knex, stores: string[] | null, sellerId: string | null, both = false): Promise<OpenSaleRow[]> {
  const q = pg("pos_sale")
    .whereNull("deleted_at")
    .where("status", "completed")
    .where((w) => { w.whereNull("delivered_at").orWhere("balance_cents", ">", 0); })
    .select("id", "establishment_id", "seller_id", "order_id", "status", "total_cents", "balance_cents", "promised_on", "delivered_at")
    .orderBy("created_at", "desc")
    // One row over the cap, so the caller can SAY the pending figures are short
    // instead of quietly understating the money on the street.
    .limit(MAX_OPEN_SALES + 1);
  if (both) {
    if (stores) q.whereIn("establishment_id", stores);
    q.where("seller_id", sellerId ?? "-");
  } else if (stores || sellerId) {
    q.where((w) => {
      if (stores) w.orWhereIn("establishment_id", stores);
      if (sellerId) w.orWhere("seller_id", sellerId);
    });
  }
  const rows = (await q) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    establishment_id: String(r.establishment_id),
    seller_id: (r.seller_id as string | null) ?? null,
    order_id: (r.order_id as string | null) ?? null,
    status: String(r.status),
    total_cents: Number(r.total_cents ?? 0),
    balance_cents: Number(r.balance_cents ?? 0),
    promised_on: r.promised_on ? String(r.promised_on).slice(0, 10) : null,
    delivered_at: r.delivered_at ? new Date(r.delivered_at as string).toISOString() : null,
  }));
}

/** The stage of each order (same derivation as the order board and the tracking page). */
async function orderStages(container: MedusaContainer, orderIds: string[]): Promise<StageLookup> {
  const ids = [...new Set(orderIds)];
  const map = new Map<string, OrderStage | "terminal">();
  if (ids.length) {
    const { data } = await container.resolve(ContainerRegistrationKeys.QUERY).graph({
      entity: "order",
      fields: ["id", "status", "payment_status", "fulfillment_status", "metadata"],
      filters: { id: ids },
    });
    for (const o of data as Array<Record<string, unknown>>) {
      const p = deriveOrderProgress(o as never);
      map.set(String(o.id), p.terminal === "canceled" || p.terminal === "refunded" ? "terminal" : p.stage);
    }
  }
  return (id) => (id ? map.get(id) : undefined);
}

/** Web orders older than this are not looked at: one that old and still open is a forgotten test, not work in the lab. */
const WEB_PENDING_DAYS = 120;
/** The stage needs the order's payment and shipment (one board read, lib/order-board.ts), not a column: keep the read small. */
const MAX_OPEN_WEB = 200;

/**
 * The online store's orders that may still be in progress: not canceled, not
 * a till sale, nothing delivered yet, of the last WEB_PENDING_DAYS. Their
 * stage comes from the same projection as the order board (payment +
 * shipment + the lab note), so the map and «Pedidos» never disagree. One row
 * over the cap so the caller can say the figures are short.
 */
async function loadOpenWebOrders(container: MedusaContainer, pg: Knex): Promise<{ orders: OpenWebOrder[]; truncated: boolean }> {
  const since = new Date(Date.now() - WEB_PENDING_DAYS * 86_400_000);
  const rows = (await pg("order as o")
    .whereNull("o.deleted_at")
    .whereNot("o.status", "canceled")
    .where("o.created_at", ">=", since)
    .whereRaw("COALESCE(o.metadata->>'source', '') <> 'pos'")
    .whereNotExists(pg("pos_sale as s").whereRaw("s.order_id = o.id").select(pg.raw("1")))
    .whereNotExists(
      pg("order_fulfillment as l")
        .join("fulfillment as f", "f.id", "l.fulfillment_id")
        .whereRaw("l.order_id = o.id")
        .whereNull("l.deleted_at")
        .whereNotNull("f.delivered_at")
        .whereNull("f.canceled_at")
        .select(pg.raw("1"))
    )
    .orderBy("o.created_at", "desc")
    .limit(MAX_OPEN_WEB + 1)
    .select("o.id")) as Array<{ id: string }>;
  const truncated = rows.length > MAX_OPEN_WEB;
  const board = await fetchBoardOrdersByIds(container, rows.slice(0, MAX_OPEN_WEB).map((r) => String(r.id)));
  return {
    truncated,
    orders: board.map((o) => ({ id: o.id, total_cents: Math.round(Number(o.total ?? 0) * 100), stage: o.stage, terminal: o.terminal })),
  };
}

async function countWhere(q: Knex.QueryBuilder): Promise<number> {
  const [row] = (await q.count<{ n: string | number }[]>({ n: "*" })) as Array<{ n: string | number }>;
  return Number(row?.n ?? 0);
}

/** The seller behind `?seller=` (an id or a code), or null when none is asked for. Throws `seller_not_found`. */
async function resolveSubject(container: MedusaContainer, sellerParam: string): Promise<SubjectSeller | null> {
  const key = sellerParam.trim();
  if (!key) return null;
  const row = (await findSellerById(container, key)) ?? (await findSellerByCode(container, key));
  if (!row) throw new PosError("seller_not_found", 404);
  return { id: row.id, code: row.code, name: row.name, user_id: row.user_id, establishment_id: row.establishment_id, commission_pct: row.commission_pct, active: row.active };
}

/** The seller's web referrals by network over the span; [] when the board cannot be read (the map still goes out). */
async function subjectSources(container: MedusaContainer, subject: SubjectSeller, span: DayRange, storeParam: string): Promise<SourceStatRow[]> {
  try {
    const store = storeParam && storeParam !== "all" ? storeParam : null;
    const stats = await sellerStats(container, { from: `${span.from}T00:00:00.000Z`, to: `${span.to}T23:59:59.999Z`, store });
    return stats.sellers.find((s) => s.id === subject.id)?.by_source ?? [];
  } catch {
    return [];
  }
}

export async function startMap(container: MedusaContainer, scope: StaffScope, stores: EstablishmentRow[], storeParam: string, sellerParam = ""): Promise<StartMap> {
  const pg = pgOf(container);
  const tz = tenant().timezone;
  const now = new Date();
  const local = localParts(now, tz);
  const pr = periodRanges(local.date, local.weekday);
  const subject = await resolveSubject(container, sellerParam);
  const ss = subject ? resolveSubjectScope(scope, stores, storeParam, subject) : resolveStartScope(scope, stores, storeParam);
  const access = insightAccess(scope);
  const filter: AnalyticsFilter = { from: pr.span.from, to: pr.span.to, stores: ss.sales.stores, sellers: ss.sales.sellers, sellerCodes: ss.sales.sellerCodes ?? null };
  const seller = ss.ownSellerId !== null;

  const approvalsQ = pg("discount_approval").whereNull("deleted_at").where("status", "pending").where("expires_at", ">", now);
  const tillsQ = pg("cash_session").whereNull("deleted_at").whereNull("closed_at");
  if (subject) approvalsQ.where("requested_by", subject.user_id ?? "-");
  else if (seller) approvalsQ.where("requested_by", scope.user_id);
  else if (ss.pendingStores) approvalsQ.whereIn("establishment_id", ss.pendingStores);
  if (ss.collectStores) tillsQ.whereIn("establishment_id", ss.collectStores);

  const [sales, open, approvals, openTills, sources, web] = await Promise.all([
    loadEconomics(container, filter, access),
    subject ? loadOpenSales(pg, ss.pendingStores, ss.ownSellerId, true) : loadOpenSales(pg, seller ? ss.collectStores : ss.pendingStores, ss.ownSellerId),
    countWhere(approvalsQ),
    // Registers are a store's, not a person's: a seller's map carries none.
    subject ? Promise.resolve(0) : countWhere(tillsQ),
    subject ? subjectSources(container, subject, pr.span, storeParam) : Promise.resolve([]),
    // The online store's orders in progress. A failure here must not take the map down: the till figures still go out.
    !subject && ss.webPending
      ? loadOpenWebOrders(container, pg).catch((e: Error) => {
          container.resolve<Logger>(ContainerRegistrationKeys.LOGGER).warn(`[start-map] web orders in progress not read: ${e.message}`);
          return { orders: [] as OpenWebOrder[], truncated: false };
        })
      : Promise.resolve({ orders: [] as OpenWebOrder[], truncated: false }),
  ]);
  const pendingTruncated = open.length > MAX_OPEN_SALES || web.truncated;
  const openSales = pendingTruncated ? open.slice(0, MAX_OPEN_SALES) : open;
  const stageOf = await orderStages(container, openSales.filter((s) => !s.delivered_at && s.order_id).map((s) => s.order_id as string));

  const agg = aggregateSales(sales.lines, sales.econ, pr, access);
  const pend = pendingOf(openSales, stageOf, { today: pr.today, ownSellerId: ss.ownSellerId, collectStores: ss.collectStores });
  // The online store's orders join the same two buckets (and its own line of the per-store table).
  const webPend = webPendingOf(web.orders);
  for (const k of ["in_lab", "to_deliver"] as const) {
    pend.pending[k].count += webPend[k].count;
    pend.pending[k].cents += webPend[k].cents;
  }
  if (webPend.in_lab.count || webPend.to_deliver.count) {
    pend.byStore.set("web", { on_street_cents: 0, in_lab: webPend.in_lab.count, to_deliver: webPend.to_deliver.count });
  }

  const storeRows: StartMapStore[] = [];
  if (ss.showStores) {
    const wanted = ss.sales.stores ?? [...stores.filter((s) => s.is_active).map((s) => s.id), "web"];
    for (const id of wanted) {
      const est = stores.find((s) => s.id === id);
      if (id !== "web" && !est) continue;
      const s = agg.byStore.get(id);
      const p = pend.byStore.get(id);
      storeRows.push({
        id,
        code: est?.code ?? "WEB",
        name: est?.name ?? "",
        color: est?.color ?? null,
        today_cents: s?.today_cents ?? 0,
        week_cents: s?.week_cents ?? 0,
        month_cents: s?.month_cents ?? 0,
        on_street_cents: p?.on_street_cents ?? 0,
        in_lab: p?.in_lab ?? 0,
        to_deliver: p?.to_deliver ?? 0,
      });
    }
    storeRows.sort((a, b) => b.month_cents - a.month_cents || a.code.localeCompare(b.code));
  }

  // "My commission this month" is the CALLER's own, so it only goes out when
  // the lines aggregated are the caller's own sales. An owner's map covers
  // every store: showing the chain's whole commission bill under `me` read as
  // the owner's personal commission.
  const ownLines = !subject && ss.ownSellerId !== null && ss.ownSellerId === scope.user_id;
  const homeId = scope.seller?.establishment_id ?? (ss.collectStores && ss.collectStores.length === 1 && ss.collectStores[0] !== "-" ? ss.collectStores[0] : null);
  const home = homeId ? stores.find((s) => s.id === homeId) ?? null : null;
  const subjectStore = subject?.establishment_id ? stores.find((s) => s.id === subject.establishment_id) ?? null : null;

  return {
    today: pr.today,
    periods: agg.periods,
    pending: { ...pend.pending, approvals, open_tills: openTills },
    stores: storeRows,
    me: {
      role: scope.role,
      seller_code: scope.seller_code,
      store_code: home?.code ?? null,
      store_name: home?.name ?? null,
      store_color: home?.color ?? null,
      commission_month_cents: ownLines && access.commission ? agg.periods.this_month.commission_cents : null,
    },
    subject: subject
      ? {
        id: subject.id,
        code: subject.code,
        name: subject.name,
        active: subject.active,
        user_id: subject.user_id,
        store_id: subject.establishment_id,
        store_code: subjectStore?.code ?? null,
        store_name: subjectStore?.name ?? null,
        color: subjectStore?.color ?? null,
        commission_pct: subject.commission_pct,
        by_source: sources,
      }
      : null,
    access,
    truncated: sales.truncated,
    pending_truncated: pendingTruncated,
  };
}

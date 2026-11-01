import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { computeCostSheet, isPaymentFeeRule, loadCostingContext, type CostRule } from "./costing";
import { listEstablishments } from "./establishments";
import { loadProductMetadata } from "./frame-specs";
import { applyFilter, previousPeriod, type AnalyticsFilter, type Breakdown, type SaleListRow } from "./sales-analytics";
import { hasPrivilege } from "./staff-profile";
import { profilesByUser } from "./staff-profile-data";
import { tenant } from "./tenant";

/**
 * Sales panel: sales and profit over time (hour of day, day, ISO week, month,
 * year) and by store, seller, product or any other dimension of sale_fact.
 *
 * Profit here is gross profit, the store P&L's contribution before its manual
 * variable items (lib/store-pnl.ts), and it can be cut by hour or product
 * because each part belongs to a sale:
 *
 *   net         line total minus sales tax
 *   cost        frame and lens cost rules, plus the per-order fixed rules
 *   fee         till: the fee recorded with the sale's payments;
 *               web: the gateway rules applied to the order's lines
 *   commission  the seller's % of the net
 *   profit      net − cost − fee − commission
 *
 * Alongside them the totals carry the till: `paid` and `balance`, counted once
 * per sale, so the panel reads what was collected and what is still owed
 * without downloading the whole list of sales to add it up itself.
 *
 * Rent and other monthly costs have no hour or product: they stay in the P&L.
 * Costs come from the current rules, as in the P&L, so a changed rule also
 * changes past figures, and a hand-typed cost sheet on one order is not used.
 */

export const GRAINS = ["hour", "day", "week", "month", "year"] as const;
export type Grain = (typeof GRAINS)[number];

/** Lines read per period; an optical chain takes years to reach it, and `truncated` says so if it does. */
export const MAX_INSIGHT_LINES = 50000;
/** Ranges longer than this are refused: every day of the range becomes a bucket. */
export const MAX_RANGE_DAYS = 3700;
const COMPARE_SERIES = 5;
const MAX_ROWS = 100;

export interface InsightLine {
  order_id: string;
  sale_id: string | null;
  channel: string;
  establishment_id: string | null;
  terminal_id: string | null;
  seller_id: string | null;
  seller_code: string | null;
  product_id: string | null;
  sku: string | null;
  title: string | null;
  brand: string | null;
  brand_slug: string | null;
  category: string;
  lens_design: string | null;
  lens_material: string | null;
  lens_photo: string | null;
  lens_ar: string | null;
  payment_methods: string[] | null;
  qty: number;
  total_cents: number;
  tax_cents: number;
  sold_date_local: string;
  hour: number;
}

/** Whole-order figures: a filter can select one line of a sale, whose fee and fixed costs belong to all of it. */
export interface OrderTotals {
  gross: number;
  net: number;
  lines: number;
}

export interface EconomicsContext {
  rules: CostRule[];
  orders: Map<string, OrderTotals>;
  /** Recorded fees of till sales by sale id, in cents. */
  saleFees: Map<string, number>;
  /**
   * Collected and still owed per till sale, by sale id, in cents (pos_sale).
   * Optional because the callers that only want profit (lib/start-map.ts) never
   * load it; without it a sale reads as paid in full, as a web order does.
   */
  saleCash?: Map<string, { paid: number; balance: number }>;
  /** Commission % of the line's seller; null when none is defined. */
  commissionPct: (line: InsightLine) => number | null;
}

export interface LineEconomics {
  net: number;
  cost: number;
  fee: number;
  commission: number;
  profit: number;
  /**
   * Cash of the WHOLE sale this line belongs to, in cents, repeated on every
   * line of it: money is collected per sale, never per line. Whoever adds these
   * up must count them once per order (see `add`).
   */
  paid: number;
  balance: number;
  /** A frame or lens of the line has no cost defined yet, so its profit reads too high. */
  missing_cost: boolean;
}

const MATERIAL_KINDS = new Set(["frame_brand", "frame_sku", "lens_design", "lens_material", "lens_photo", "lens_ar"]);

/**
 * Splits `amount` cents among `weights` so the parts add up to `amount`
 * EXACTLY: the proportional part of each weight, floored, and the leftover
 * cents handed to the biggest remainders (largest remainder / Hare quota,
 * the same rule as lib/store-costs.ts allocateShared). Equal parts when every
 * weight is zero. A negative amount is split with the sign kept. Pure.
 *
 * Rounding each part on its own would lose or invent a cent on a sale with
 * several lines, and a statement that is off by a cent is a statement nobody
 * trusts.
 */
export function allocateCents(amount: number, weights: readonly number[]): number[] {
  const count = weights.length;
  if (!count) return [];
  const whole = Math.round(amount);
  if (whole === 0) return weights.map(() => 0);
  const sign = whole < 0 ? -1 : 1;
  const abs = Math.abs(whole);
  let w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  let total = w.reduce((s, x) => s + x, 0);
  if (total === 0) {
    w = weights.map(() => 1);
    total = count;
  }
  const raw = w.map((x) => (abs * x) / total);
  const parts = raw.map((v) => Math.floor(v));
  let left = abs - parts.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts.map((v) => v * sign);
}

/** The money of each line, in cents. Pure. */
export function lineEconomics(lines: InsightLine[], ctx: EconomicsContext): LineEconomics[] {
  // computeCostSheet drops the inactive rules itself (ruleIndex), so an
  // inactive material rule leaves its line "without a cost defined" — the same
  // answer the Costs tab gives.
  const materials = ctx.rules.filter((r) => MATERIAL_KINDS.has(r.kind));
  const active = ctx.rules.filter((r) => r.active);
  const orderFixed = active.filter((r) => r.kind === "order_fixed").reduce((s, r) => s + Math.round(r.amount * 100), 0);
  const gatewayPct = active.filter(isPaymentFeeRule).reduce((s, r) => s + r.amount, 0);
  const gatewayFixed = active.filter((r) => r.kind === "payment_fixed").reduce((s, r) => s + Math.round(r.amount * 100), 0);

  const memo = new Map<string, { cost: number; missing: boolean }>();
  const materialCost = (l: InsightLine) => {
    // The store is part of the key: each store may hold its own cost for a
    // model (store_frame_cost_variation), so two stores selling the same
    // frame must not share a memo entry — that would cost one with the
    // other's money.
    const key = [l.establishment_id, l.sku, l.brand_slug, l.category, l.lens_design, l.lens_material, l.lens_photo, l.lens_ar, l.qty].join("|");
    const hit = memo.get(key);
    if (hit) return hit;
    const sheet = computeCostSheet(
      {
        // Which store sold it: the frame's cost is resolved against that
        // store's own cost first, then the chain's (lib/frame-cost.ts).
        establishment_id: l.establishment_id,
        items: [{
          quantity: l.qty,
          sku: l.sku,
          brand_slug: l.brand_slug,
          lens: { design_code: l.lens_design, material_code: l.lens_material, photo_code: l.lens_photo, ar_code: l.lens_ar },
        }],
      },
      materials,
      null,
      null,
      null
    );
    // The frame of an own_frame line is the customer's: nothing to define.
    const lacking = sheet.lines.filter((x) => x.undefined_cost && !(l.category === "own_frame" && x.key.startsWith("frame:")));
    const out = { cost: Math.round(sheet.materials_total * 100), missing: lacking.length > 0 };
    memo.set(key, out);
    return out;
  };

  const nets = lines.map((l) => l.total_cents - l.tax_cents);

  // The payment fee and the per-order fixed costs belong to the WHOLE sale, so
  // they are charged once and split among its lines in proportion to their net.
  // A filter that selects part of a sale (one product, one lens design) only
  // carries the matching share: `coverage` is how much of the sale is here.
  const byOrder = new Map<string, number[]>();
  lines.forEach((l, i) => {
    const group = byOrder.get(l.order_id);
    if (group) group.push(i);
    else byOrder.set(l.order_id, [i]);
  });
  const fixedOf = new Array<number>(lines.length).fill(0);
  const feeOf = new Array<number>(lines.length).fill(0);
  const paidOf = new Array<number>(lines.length).fill(0);
  const balanceOf = new Array<number>(lines.length).fill(0);
  for (const [orderId, idx] of byOrder) {
    const first = lines[idx[0]];
    const order = ctx.orders.get(orderId) ?? { gross: first.total_cents, net: nets[idx[0]], lines: idx.length };
    const presentNet = idx.reduce((s, i) => s + nets[i], 0);
    // A sale that left no net (a 100 % discount) is split by line count instead,
    // and never beyond the whole of it.
    const coverage = order.net > 0 ? presentNet / order.net : Math.min(1, idx.length / Math.max(1, order.lines));
    const weights = order.net > 0 ? idx.map((i) => nets[i]) : idx.map(() => 1);
    // Till sale: the fee recorded with its payments. Web order: the gateway's
    // % of what the customer was charged, plus its fixed fee.
    const feeTotal = first.sale_id ? ctx.saleFees.get(first.sale_id) ?? 0 : Math.round((order.gross * gatewayPct) / 100) + gatewayFixed;
    const fixedParts = allocateCents(orderFixed * coverage, weights);
    const feeParts = allocateCents(feeTotal * coverage, weights);
    // Cash, with the same answer /admin/sales-analytics/sales puts on a row
    // (lib/sales-analytics.ts saleListRowOf): a till sale knows what it took and
    // what it still owes, while a web order was charged in full when it was
    // placed, so what is here is collected and nothing is owed. A till sale
    // whose pos_sale row is not loaded falls back the same way the list does.
    const cash = first.sale_id ? ctx.saleCash?.get(first.sale_id) : undefined;
    const presentGross = idx.reduce((s, i) => s + lines[i].total_cents, 0);
    idx.forEach((i, k) => {
      fixedOf[i] = fixedParts[k];
      feeOf[i] = feeParts[k];
      paidOf[i] = cash ? cash.paid : presentGross;
      balanceOf[i] = cash ? cash.balance : 0;
    });
  }

  return lines.map((l, i) => {
    const net = nets[i];
    const material = materialCost(l);
    const cost = material.cost + fixedOf[i];
    const fee = feeOf[i];
    const commission = Math.round((net * (ctx.commissionPct(l) ?? 0)) / 100);
    return { net, cost, fee, commission, profit: net - cost - fee - commission, paid: paidOf[i], balance: balanceOf[i], missing_cost: material.missing };
  });
}

/** Sensible grain for a range: one day by hour, up to two months by day, up to six months by week, up to two years by month. */
export function grainFor(from: string, to: string): Grain {
  const days = spanDays(from, to);
  if (days <= 1) return "hour";
  if (days <= 62) return "day";
  if (days <= 182) return "week";
  if (days <= 731) return "month";
  return "year";
}

export function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000) + 1;
}

const DAY_MS = 86400_000;
const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * ISO week of a local calendar day: "YYYY-Www", Monday to Sunday, week 1 the
 * one holding January 4th. The year is the ISO year, so "2024-12-30" is
 * "2025-W01" and "2027-01-01" is "2026-W53".
 */
export function isoWeekOf(ymd: string): string {
  const d = new Date(Date.parse(`${ymd}T00:00:00Z`));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow); // the Thursday decides the year
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7);
  return `${year}-W${pad2(week)}`;
}

/** The Monday of an ISO week key ("2026-W44" → "2026-10-26"), for display. */
export function weekStart(key: string): string {
  const [y, w] = key.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const monday1 = jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * DAY_MS;
  return new Date(monday1 + (w - 1) * 7 * DAY_MS).toISOString().slice(0, 10);
}

/** Hour of the day (all days of the range added up), "YYYY-MM-DD", "YYYY-Www", "YYYY-MM" or "YYYY". */
export function bucketOf(line: Pick<InsightLine, "sold_date_local" | "hour">, grain: Grain): string {
  if (grain === "hour") return String(line.hour).padStart(2, "0");
  if (grain === "week") return isoWeekOf(line.sold_date_local);
  if (grain === "month") return line.sold_date_local.slice(0, 7);
  if (grain === "year") return line.sold_date_local.slice(0, 4);
  return line.sold_date_local;
}

/** Every bucket of the range, so an empty day shows as a zero and not as a gap. Hours span the first to the last with sales. */
export function bucketsOf(from: string, to: string, grain: Grain, seen: Iterable<string>): string[] {
  if (grain === "hour") {
    const hours = [...seen].map(Number);
    if (!hours.length) return [];
    const out: string[] = [];
    for (let h = Math.min(...hours); h <= Math.max(...hours); h++) out.push(String(h).padStart(2, "0"));
    return out;
  }
  const size = grain === "day" ? 10 : grain === "month" ? 7 : 4;
  const out = new Set<string>();
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.add(grain === "week" ? isoWeekOf(day) : day.slice(0, size));
  }
  return [...out];
}

export interface Figures {
  sales: number;
  net: number;
  tax: number;
  cost: number;
  fee: number;
  commission: number;
  profit: number;
  /** Profit over the net, in %. */
  margin_pct: number | null;
  /**
   * Cash of the period's sales, in dollars: what they collected and what they
   * still owe, counted once per sale. `paid + balance` is what those sales were
   * charged (`sales`) whenever every line of them is in the filter.
   */
  paid: number;
  balance: number;
  count: number;
  units: number;
  avg_ticket: number;
}

interface Tally {
  sales: number;
  net: number;
  tax: number;
  cost: number;
  fee: number;
  commission: number;
  profit: number;
  paid: number;
  balance: number;
  units: number;
  orders: Set<string>;
}

const newTally = (): Tally => ({ sales: 0, net: 0, tax: 0, cost: 0, fee: 0, commission: 0, profit: 0, paid: 0, balance: 0, units: 0, orders: new Set() });

function add(t: Tally, l: InsightLine, e: LineEconomics): void {
  t.sales += l.total_cents;
  t.net += e.net;
  t.tax += l.tax_cents;
  t.cost += e.cost;
  t.fee += e.fee;
  t.commission += e.commission;
  t.profit += e.profit;
  t.units += l.qty;
  // The cash on the line is the whole sale's, so it joins the tally with the
  // sale and not with each of its lines — the rule `count` already follows.
  if (!t.orders.has(l.order_id)) {
    t.paid += e.paid;
    t.balance += e.balance;
  }
  t.orders.add(l.order_id);
}

function figures(t: Tally): Figures {
  const d = (v: number) => v / 100;
  const count = t.orders.size;
  return {
    sales: d(t.sales),
    net: d(t.net),
    tax: d(t.tax),
    cost: d(t.cost),
    fee: d(t.fee),
    commission: d(t.commission),
    profit: d(t.profit),
    margin_pct: t.net > 0 ? Math.round((t.profit / t.net) * 1000) / 10 : null,
    paid: d(t.paid),
    balance: d(t.balance),
    count,
    units: t.units,
    avg_ticket: count ? Math.round(t.sales / count) / 100 : 0,
  };
}

function totalsOf(lines: InsightLine[], econ: LineEconomics[]): Figures {
  const t = newTally();
  lines.forEach((l, i) => add(t, l, econ[i]));
  return figures(t);
}

/** Keys of a line in a dimension. A sale paid two ways counts under both methods. */
export function keysOf(l: InsightLine, by: Breakdown): Array<string | null> {
  switch (by) {
    case "establishment": return [l.channel === "web" ? "web" : l.establishment_id];
    case "seller": return [l.seller_code];
    case "product": return [l.category === "own_frame" ? "own_frame" : l.product_id];
    case "brand": return [l.brand];
    case "category": return [l.category];
    case "lens_design": return [l.lens_design];
    case "lens_material": return [l.lens_material];
    case "lens_photo": return [l.lens_photo];
    case "lens_ar": return [l.lens_ar];
    case "terminal": return [l.terminal_id];
    case "payment_method": return l.payment_methods?.length ? l.payment_methods : [null];
  }
}

export interface Labels {
  store: (id: string) => { label: string; color: string | null } | null;
  sellerName: (code: string) => string | null;
}

export interface InsightRow extends Figures {
  key: string | null;
  label: string | null;
  color: string | null;
  /** % of the dimension's sales. */
  share: number;
}

export interface InsightPoint {
  /** "HH", "YYYY-MM-DD", "YYYY-Www", "YYYY-MM" or "YYYY" (bucketOf). */
  bucket: string;
  /** Week grain only: the Monday the bucket starts on, "YYYY-MM-DD". */
  start?: string;
  sales: number;
  profit: number;
  commission: number;
  count: number;
  units: number;
}

export interface CompareSeries {
  key: string;
  label: string | null;
  color: string | null;
  sales: number[];
  profit: number[];
  commission: number[];
}

export interface InsightBreakdown {
  rows: InsightRow[];
  /** The leaders of the dimension over time, aligned with `series`. */
  compare: CompareSeries[];
}

export interface Insights {
  grain: Grain;
  by: Breakdown;
  totals: Figures;
  previous: Figures;
  previous_range: { from: string; to: string };
  series: InsightPoint[];
  /** The rows of `by` — the same as `breakdowns[by].rows`. */
  rows: InsightRow[];
  /** The leaders of `by` over time, aligned with `series`. */
  compare: CompareSeries[];
  /** Every dimension asked for, `by` included, each over the same lines and buckets. */
  breakdowns: Partial<Record<Breakdown, InsightBreakdown>>;
  missing_cost_lines: number;
  cost_rules_missing: boolean;
  truncated: boolean;
}

/** All the figures of the panel from lines already costed. Pure. `bys` adds dimensions besides `by`. */
export function buildInsights(input: {
  from: string;
  to: string;
  grain: Grain;
  by: Breakdown;
  bys?: readonly Breakdown[];
  lines: InsightLine[];
  econ: LineEconomics[];
  previous: Figures;
  previousRange: { from: string; to: string };
  labels: Labels;
  costRulesMissing: boolean;
  truncated: boolean;
}): Insights {
  const { lines, econ, grain, by, labels } = input;
  const dims = [...new Set([by, ...(input.bys ?? [])])];
  const buckets = new Map<string, Tally>();
  type Group = { tally: Tally; title: string | null; perBucket: Map<string, Tally> };
  const groupsOf = new Map<Breakdown, Map<string | null, Group>>(dims.map((d) => [d, new Map()]));

  lines.forEach((l, i) => {
    const bucket = bucketOf(l, grain);
    if (!buckets.has(bucket)) buckets.set(bucket, newTally());
    add(buckets.get(bucket) as Tally, l, econ[i]);
    for (const dim of dims) {
      const groups = groupsOf.get(dim)!;
      for (const key of keysOf(l, dim)) {
        if (!groups.has(key)) groups.set(key, { tally: newTally(), title: l.title, perBucket: new Map() });
        const group = groups.get(key)!;
        add(group.tally, l, econ[i]);
        if (!group.perBucket.has(bucket)) group.perBucket.set(bucket, newTally());
        add(group.perBucket.get(bucket) as Tally, l, econ[i]);
      }
    }
  });

  const order = bucketsOf(input.from, input.to, grain, buckets.keys());
  const series = order.map((bucket) => {
    const f = figures(buckets.get(bucket) ?? newTally());
    return { bucket, ...(grain === "week" ? { start: weekStart(bucket) } : {}), sales: f.sales, profit: f.profit, commission: f.commission, count: f.count, units: f.units };
  });

  const breakdownOf = (dim: Breakdown, groups: Map<string | null, Group>): InsightBreakdown => {
    const describe = (key: string | null, title: string | null): { label: string | null; color: string | null } => {
      if (key === null) return { label: null, color: null };
      if (dim === "establishment") return labels.store(key) ?? { label: null, color: null };
      if (dim === "seller") return { label: labels.sellerName(key), color: null };
      if (dim === "product" && key !== "own_frame") return { label: title, color: null };
      return { label: null, color: null };
    };
    const sumSales = [...groups.values()].reduce((s, g) => s + g.tally.sales, 0) || 1;
    const ranked = [...groups.entries()].sort((a, b) => b[1].tally.sales - a[1].tally.sales);
    const rows = ranked.slice(0, MAX_ROWS).map(([key, g]) => ({
      ...figures(g.tally),
      key,
      ...describe(key, g.title),
      share: Math.round((g.tally.sales / sumSales) * 1000) / 10,
    }));
    const compare = ranked
      .filter(([key]) => key !== null)
      .slice(0, COMPARE_SERIES)
      .map(([key, g]) => {
        const points = order.map((bucket) => figures(g.perBucket.get(bucket) ?? newTally()));
        return {
          key: key as string,
          ...describe(key, g.title),
          sales: points.map((p) => p.sales),
          profit: points.map((p) => p.profit),
          commission: points.map((p) => p.commission),
        };
      });
    return { rows, compare };
  };
  const breakdowns: Partial<Record<Breakdown, InsightBreakdown>> = {};
  for (const dim of dims) breakdowns[dim] = breakdownOf(dim, groupsOf.get(dim)!);
  const main = breakdowns[by]!;

  return {
    grain,
    by,
    totals: totalsOf(lines, econ),
    previous: input.previous,
    previous_range: input.previousRange,
    series,
    rows: main.rows,
    compare: main.compare,
    breakdowns,
    missing_cost_lines: econ.filter((e) => e.missing_cost).length,
    cost_rules_missing: input.costRulesMissing,
    truncated: input.truncated,
  };
}

export interface InsightAccess {
  /** Cost, fees and profit: admins and whoever holds costs.view or costs.manage. */
  profit: boolean;
  /** Commissions: those people, and a seller over their own sales. */
  commission: boolean;
}

/** The rule the insights route applies: profit for admins and costs.view/costs.manage; a seller also sees their commission. */
export function insightAccess(scope: { is_admin: boolean; role: string | null; privileges?: readonly string[] }): InsightAccess & { role: string | null } {
  const profit = hasPrivilege(scope, "costs.view") || hasPrivilege(scope, "costs.manage");
  return { profit, commission: profit || scope.role === "seller", role: scope.role };
}

/**
 * Takes out what the caller may not see, here and not in the panel: hiding a
 * column in the browser would still send a store's margin to a seller. Pure.
 *
 * `sales`, `paid` and `balance` stay: they are the till, not the margin. What a
 * seller took in and what their customer still owes is theirs to chase, and the
 * sales list already hands them both rows (attachSaleEconomics keeps `paid` and
 * `balance` for every caller). Only cost, fee, profit, margin and — unless it is
 * their own — commission say what the store earns, and only those are hidden.
 */
export function redactInsights(data: Insights, access: InsightAccess): Insights {
  const figure = <T extends Figures>(f: T): T => ({
    ...f,
    cost: access.profit ? f.cost : 0,
    fee: access.profit ? f.fee : 0,
    profit: access.profit ? f.profit : 0,
    margin_pct: access.profit ? f.margin_pct : null,
    commission: access.commission ? f.commission : 0,
  });
  const zeros = (v: number[], allowed: boolean) => (allowed ? v : v.map(() => 0));
  const compare = (list: CompareSeries[]) => list.map((c) => ({ ...c, profit: zeros(c.profit, access.profit), commission: zeros(c.commission, access.commission) }));
  const breakdowns: Partial<Record<Breakdown, InsightBreakdown>> = {};
  for (const [dim, b] of Object.entries(data.breakdowns ?? {}) as Array<[Breakdown, InsightBreakdown]>) breakdowns[dim] = { rows: b.rows.map(figure), compare: compare(b.compare) };
  return {
    ...data,
    totals: figure(data.totals),
    previous: figure(data.previous),
    rows: data.rows.map(figure),
    series: data.series.map((p) => ({ ...p, profit: access.profit ? p.profit : 0, commission: access.commission ? p.commission : 0 })),
    compare: compare(data.compare),
    breakdowns,
    missing_cost_lines: access.profit ? data.missing_cost_lines : 0,
    cost_rules_missing: access.profit ? data.cost_rules_missing : false,
  };
}

// ── Per-sale economics (the list of sales of a store) ─────────────────────

/** The money of one sale, in cents: its lines added up (lineEconomics). */
export interface SaleEconomics {
  net: number;
  cost: number;
  fee: number;
  commission: number;
  profit: number;
  /** Some line has a frame or lens without a cost rule: the profit reads too high. */
  missing_cost: boolean;
}

/** Adds the lines of each order up. Pure. */
export function sumEconomicsByOrder(lines: InsightLine[], econ: LineEconomics[]): Map<string, SaleEconomics> {
  const out = new Map<string, SaleEconomics>();
  lines.forEach((l, i) => {
    const e = econ[i];
    const cur = out.get(l.order_id) ?? { net: 0, cost: 0, fee: 0, commission: 0, profit: 0, missing_cost: false };
    cur.net += e.net;
    cur.cost += e.cost;
    cur.fee += e.fee;
    cur.commission += e.commission;
    cur.profit += e.profit;
    cur.missing_cost = cur.missing_cost || e.missing_cost;
    out.set(l.order_id, cur);
  });
  return out;
}

/** A sale of the list with its money: null where the caller may not see it (redacted here, never in the panel). */
export interface SaleListEconomics extends SaleListRow {
  /** Total minus sales tax; null when the sale's lines were not read. Not redacted: it is not a cost. */
  net: number | null;
  cost: number | null;
  fee: number | null;
  commission: number | null;
  profit: number | null;
  /** Profit over the net, in %. */
  margin_pct: number | null;
  missing_cost: boolean | null;
}

/** Puts each sale's money on its row, in dollars, redacted by `access`. Pure. */
export function attachSaleEconomics(rows: SaleListRow[], econ: Map<string, SaleEconomics>, access: InsightAccess): SaleListEconomics[] {
  const d = (v: number) => v / 100;
  return rows.map((r) => {
    const e = econ.get(r.order_id);
    const profit = access.profit && e ? d(e.profit) : null;
    return {
      ...r,
      net: e ? d(e.net) : null,
      cost: access.profit && e ? d(e.cost) : null,
      fee: access.profit && e ? d(e.fee) : null,
      commission: access.commission && e ? d(e.commission) : null,
      profit,
      margin_pct: access.profit && e && e.net > 0 ? Math.round((e.profit / e.net) * 1000) / 10 : null,
      missing_cost: access.profit && e ? e.missing_cost : null,
    };
  });
}

// ── Loading ──────────────────────────────────────────────────────────────────

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

export function linesQuery(pg: Knex, f: AnalyticsFilter, tz: string): Knex.QueryBuilder {
  return applyFilter(pg("sale_fact"), f)
    .select(
      "sale_fact.order_id", "sale_fact.sale_id", "sale_fact.channel", "sale_fact.establishment_id", "sale_fact.terminal_id",
      "sale_fact.seller_id", "sale_fact.seller_code", "sale_fact.product_id", "sale_fact.sku", "sale_fact.title", "sale_fact.brand",
      "sale_fact.category", "sale_fact.lens_design", "sale_fact.lens_material", "sale_fact.lens_photo", "sale_fact.lens_ar",
      "sale_fact.payment_methods", "sale_fact.qty", "sale_fact.total_cents", "sale_fact.tax_cents", "sale_fact.sold_date_local",
      pg.raw("EXTRACT(HOUR FROM sale_fact.sold_at AT TIME ZONE ?)::int AS hour", [tz])
    )
    .orderBy("sale_fact.sold_at", "desc")
    .limit(MAX_INSIGHT_LINES + 1);
}

export function orderTotalsQuery(pg: Knex, f: AnalyticsFilter): Knex.QueryBuilder {
  return pg("sale_fact as o")
    .whereNull("o.deleted_at")
    .whereIn("o.order_id", applyFilter(pg("sale_fact"), f).select("sale_fact.order_id"))
    .groupBy("o.order_id")
    .select("o.order_id", pg.raw("SUM(o.total_cents)::bigint AS gross"), pg.raw("SUM(o.total_cents - o.tax_cents)::bigint AS net"), pg.raw("COUNT(*)::int AS lines"));
}

export function saleFeesQuery(pg: Knex, f: AnalyticsFilter): Knex.QueryBuilder {
  return pg("pos_sale_payment as p")
    .whereNull("p.deleted_at")
    .whereIn("p.sale_id", applyFilter(pg("sale_fact"), f).whereNotNull("sale_fact.sale_id").select("sale_fact.sale_id"))
    .groupBy("p.sale_id")
    .select("p.sale_id", pg.raw("COALESCE(SUM(p.fee_cents), 0)::bigint AS fee"));
}

/** What every till sale of the period collected and still owes — the same pos_sale columns the sales list reads. */
export function saleCashQuery(pg: Knex, f: AnalyticsFilter): Knex.QueryBuilder {
  return pg("pos_sale as s")
    .whereIn("s.id", applyFilter(pg("sale_fact"), f).whereNotNull("sale_fact.sale_id").select("sale_fact.sale_id"))
    .select("s.id", "s.paid_cents", "s.balance_cents");
}

async function loadLines(pg: Knex, f: AnalyticsFilter, tz: string, orderIds?: string[]): Promise<{ lines: InsightLine[]; truncated: boolean }> {
  const q = linesQuery(pg, f, tz);
  if (orderIds) q.whereIn("sale_fact.order_id", orderIds);
  const rows = (await q) as Array<Record<string, unknown>>;
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

async function loadOrderContext(pg: Knex, f: AnalyticsFilter, orderIds?: string[]): Promise<{ orders: Map<string, OrderTotals>; saleFees: Map<string, number>; saleCash: Map<string, { paid: number; balance: number }> }> {
  const totalsQ = orderTotalsQuery(pg, f);
  const feesQ = saleFeesQuery(pg, f);
  const cashQ = saleCashQuery(pg, f);
  if (orderIds) {
    const saleIds = pg("sale_fact").whereNull("sale_fact.deleted_at").whereIn("sale_fact.order_id", orderIds).whereNotNull("sale_fact.sale_id").select("sale_fact.sale_id");
    totalsQ.whereIn("o.order_id", orderIds);
    feesQ.whereIn("p.sale_id", saleIds.clone());
    cashQ.whereIn("s.id", saleIds.clone());
  }
  // The three aggregates at once: they are independent, and the panel waits for
  // the slowest of them instead of their sum.
  const [orderRows, feeRows, cashRows] = (await Promise.all([totalsQ, feesQ, cashQ])) as [Array<Record<string, unknown>>, Array<Record<string, unknown>>, Array<Record<string, unknown>>];
  return {
    orders: new Map(orderRows.map((r) => [String(r.order_id), { gross: Number(r.gross), net: Number(r.net), lines: Number(r.lines) }])),
    saleFees: new Map(feeRows.map((r) => [String(r.sale_id), Number(r.fee)])),
    saleCash: new Map(cashRows.map((r) => [String(r.id), { paid: Number(r.paid_cents), balance: Number(r.balance_cents) }])),
  };
}

/** Same precedence as the seller's own panel: their profile, then their seller record. */
async function commissionResolver(container: MedusaContainer, lines: InsightLine[], costing: Awaited<ReturnType<typeof loadCostingContext>>): Promise<(l: InsightLine) => number | null> {
  const sellerIds = [...new Set(lines.map((l) => l.seller_id).filter((v): v is string => Boolean(v)))];
  const profiles = await profilesByUser(container, sellerIds);
  return (l: InsightLine) => {
    const own = l.seller_id ? profiles.get(l.seller_id)?.commission_pct ?? null : null;
    if (own !== null) return own;
    return l.seller_code ? costing.sellerByCode.get(l.seller_code)?.commission_pct ?? null : null;
  };
}

/**
 * The money of the given sales (one page of the sales list), from the same
 * rules and lines as the panel, so the list and the figures agree. The sales
 * must be within `f` (the list was read with it); other lines of those orders
 * still count for the whole-order fee and fixed costs.
 */
export async function orderEconomics(container: MedusaContainer, f: AnalyticsFilter, orderIds: string[]): Promise<Map<string, SaleEconomics>> {
  const ids = [...new Set(orderIds)];
  if (!ids.length) return new Map();
  const pg = pgOf(container);
  const [cur, ctx, costing] = await Promise.all([loadLines(pg, f, tenant().timezone, ids), loadOrderContext(pg, f, ids), loadCostingContext(container)]);
  const commissionPct = await commissionResolver(container, cur.lines, costing);
  return sumEconomicsByOrder(cur.lines, lineEconomics(cur.lines, { rules: costing.rules, ...ctx, commissionPct }));
}

/** `by` is the main dimension; `bys` the others to group by in the same pass (one query, many tables). */
export async function salesInsights(container: MedusaContainer, f: AnalyticsFilter, grain: Grain, by: Breakdown, bys: readonly Breakdown[] = []): Promise<Insights> {
  const pg = pgOf(container);
  const tz = tenant().timezone;
  const prev = previousPeriod(f.from, f.to);
  const prevFilter = { ...f, ...prev };
  const [cur, old, curOrders, oldOrders, costing, stores] = await Promise.all([
    loadLines(pg, f, tz),
    loadLines(pg, prevFilter, tz),
    loadOrderContext(pg, f),
    loadOrderContext(pg, prevFilter),
    loadCostingContext(container),
    listEstablishments(container),
  ]);
  const commissionPct = await commissionResolver(container, [...cur.lines, ...old.lines], costing);
  const econ = lineEconomics(cur.lines, { rules: costing.rules, ...curOrders, commissionPct });
  const oldEcon = lineEconomics(old.lines, { rules: costing.rules, ...oldOrders, commissionPct });
  const byStore = new Map(stores.map((s) => [s.id, s]));
  return buildInsights({
    from: f.from,
    to: f.to,
    grain,
    by,
    bys,
    lines: cur.lines,
    econ,
    previous: totalsOf(old.lines, oldEcon),
    previousRange: prev,
    labels: {
      store: (id) => {
        const s = byStore.get(id);
        return s ? { label: `${s.code} · ${s.name}`, color: s.color } : null;
      },
      sellerName: (code) => costing.sellerByCode.get(code)?.name ?? null,
    },
    costRulesMissing: costing.rules.filter((r) => MATERIAL_KINDS.has(r.kind)).every((r) => !r.amount),
    truncated: cur.truncated || old.truncated,
  });
}

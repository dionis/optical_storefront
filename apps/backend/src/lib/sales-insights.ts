import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { computeCostSheet, isPaymentFeeRule, loadCostingContext, type CostRule } from "./costing";
import { listEstablishments } from "./establishments";
import { loadProductMetadata } from "./frame-specs";
import { applyFilter, previousPeriod, type AnalyticsFilter, type Breakdown } from "./sales-analytics";
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
  /** Commission % of the line's seller; null when none is defined. */
  commissionPct: (line: InsightLine) => number | null;
}

export interface LineEconomics {
  net: number;
  cost: number;
  fee: number;
  commission: number;
  profit: number;
  /** A frame or lens of the line has no cost defined yet, so its profit reads too high. */
  missing_cost: boolean;
}

const MATERIAL_KINDS = new Set(["frame_brand", "frame_sku", "lens_design", "lens_material", "lens_photo", "lens_ar"]);

/** The money of each line, in cents. Pure. */
export function lineEconomics(lines: InsightLine[], ctx: EconomicsContext): LineEconomics[] {
  const materials = ctx.rules.filter((r) => MATERIAL_KINDS.has(r.kind));
  const active = ctx.rules.filter((r) => r.active);
  const orderFixed = active.filter((r) => r.kind === "order_fixed").reduce((s, r) => s + Math.round(r.amount * 100), 0);
  const gatewayPct = active.filter(isPaymentFeeRule).reduce((s, r) => s + r.amount, 0);
  const gatewayFixed = active.filter((r) => r.kind === "payment_fixed").reduce((s, r) => s + Math.round(r.amount * 100), 0);

  const memo = new Map<string, { cost: number; missing: boolean }>();
  const materialCost = (l: InsightLine) => {
    const key = [l.sku, l.brand_slug, l.category, l.lens_design, l.lens_material, l.lens_photo, l.lens_ar, l.qty].join("|");
    const hit = memo.get(key);
    if (hit) return hit;
    const sheet = computeCostSheet(
      {
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

  return lines.map((l) => {
    const net = l.total_cents - l.tax_cents;
    const order = ctx.orders.get(l.order_id) ?? { gross: l.total_cents, net, lines: 1 };
    const share = order.net > 0 ? net / order.net : 1 / Math.max(1, order.lines);
    const orderFee = l.sale_id ? ctx.saleFees.get(l.sale_id) ?? 0 : Math.round((order.gross * gatewayPct) / 100) + gatewayFixed;
    const material = materialCost(l);
    const cost = material.cost + Math.round(orderFixed * share);
    const fee = Math.round(orderFee * share);
    const commission = Math.round((net * (ctx.commissionPct(l) ?? 0)) / 100);
    return { net, cost, fee, commission, profit: net - cost - fee - commission, missing_cost: material.missing };
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
  units: number;
  orders: Set<string>;
}

const newTally = (): Tally => ({ sales: 0, net: 0, tax: 0, cost: 0, fee: 0, commission: 0, profit: 0, units: 0, orders: new Set() });

function add(t: Tally, l: InsightLine, e: LineEconomics): void {
  t.sales += l.total_cents;
  t.net += e.net;
  t.tax += l.tax_cents;
  t.cost += e.cost;
  t.fee += e.fee;
  t.commission += e.commission;
  t.profit += e.profit;
  t.units += l.qty;
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

/**
 * Takes out what the caller may not see, here and not in the panel: hiding a
 * column in the browser would still send a store's margin to a seller. Pure.
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

async function loadLines(pg: Knex, f: AnalyticsFilter, tz: string): Promise<{ lines: InsightLine[]; truncated: boolean }> {
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

async function loadOrderContext(pg: Knex, f: AnalyticsFilter): Promise<{ orders: Map<string, OrderTotals>; saleFees: Map<string, number> }> {
  const orderRows = (await orderTotalsQuery(pg, f)) as Array<Record<string, unknown>>;
  const feeRows = (await saleFeesQuery(pg, f)) as Array<Record<string, unknown>>;
  return {
    orders: new Map(orderRows.map((r) => [String(r.order_id), { gross: Number(r.gross), net: Number(r.net), lines: Number(r.lines) }])),
    saleFees: new Map(feeRows.map((r) => [String(r.sale_id), Number(r.fee)])),
  };
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
  const sellerIds = [...new Set([...cur.lines, ...old.lines].map((l) => l.seller_id).filter((v): v is string => Boolean(v)))];
  const profiles = await profilesByUser(container, sellerIds);
  // Same precedence as the seller's own panel: their profile, then their seller record.
  const commissionPct = (l: InsightLine) => {
    const own = l.seller_id ? profiles.get(l.seller_id)?.commission_pct ?? null : null;
    if (own !== null) return own;
    return l.seller_code ? costing.sellerByCode.get(l.seller_code)?.commission_pct ?? null : null;
  };
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

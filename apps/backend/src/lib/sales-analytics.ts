import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";

/**
 * Dashboards over sale_fact (functional document E8, E9; HU-50 to HU-53,
 * HU-60 to HU-67, HU-115). Every query takes the same filters, and the
 * caller's scope is applied on top by the route (an owner sees everything,
 * a supervisor or manager their stores, a seller their own sales).
 *
 * Amounts are what was charged (tax included, after discount); counts are
 * sales (distinct orders); voided sales are left out unless asked for.
 */

export interface AnalyticsFilter {
  /** Local calendar days, inclusive (YYYY-MM-DD). */
  from: string;
  to: string;
  /** null = every store; "web" in the list = the online store. */
  stores: string[] | null;
  sellers?: string[] | null;
  products?: string[] | null;
  brands?: string[] | null;
  categories?: string[] | null;
  paymentMethods?: string[] | null;
  lensDesigns?: string[] | null;
  hasPrescription?: boolean | null;
  includeVoided?: boolean;
}

export const BREAKDOWNS = ["establishment", "seller", "product", "brand", "category", "lens_design", "lens_material", "lens_photo", "lens_ar", "payment_method", "terminal"] as const;
export type Breakdown = (typeof BREAKDOWNS)[number];

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

function applyFilter(q: Knex.QueryBuilder, f: AnalyticsFilter): Knex.QueryBuilder {
  q.whereNull("sale_fact.deleted_at").whereBetween("sale_fact.sold_date_local", [f.from, f.to]);
  if (!f.includeVoided) q.where("sale_fact.status", "active");
  if (f.stores) {
    const physical = f.stores.filter((s) => s !== "web");
    q.where((w) => {
      if (physical.length) w.orWhereIn("sale_fact.establishment_id", physical);
      if (f.stores!.includes("web")) w.orWhere("sale_fact.channel", "web");
      if (!physical.length && !f.stores!.includes("web")) w.whereRaw("false");
    });
  }
  if (f.sellers?.length) q.whereIn("sale_fact.seller_id", f.sellers);
  if (f.products?.length) q.whereIn("sale_fact.product_id", f.products);
  if (f.brands?.length) q.whereIn("sale_fact.brand", f.brands);
  if (f.categories?.length) q.whereIn("sale_fact.category", f.categories);
  if (f.lensDesigns?.length) q.whereIn("sale_fact.lens_design", f.lensDesigns);
  if (f.hasPrescription !== null && f.hasPrescription !== undefined) q.where("sale_fact.has_prescription", f.hasPrescription);
  if (f.paymentMethods?.length) {
    q.where((w) => {
      for (const m of f.paymentMethods!) w.orWhereRaw(`sale_fact.payment_methods @> ?::jsonb`, [JSON.stringify([m])]);
    });
  }
  return q;
}

export interface Summary {
  total: number;
  count: number;
  units: number;
  avg_ticket: number;
  discount: number;
}

async function summaryOf(pg: Knex, f: AnalyticsFilter): Promise<Summary> {
  const [row] = (await applyFilter(pg("sale_fact"), f).select(
    pg.raw("COALESCE(SUM(total_cents), 0)::bigint AS total"),
    pg.raw("COUNT(DISTINCT order_id)::int AS count"),
    pg.raw("COALESCE(SUM(qty), 0)::int AS units"),
    pg.raw("COALESCE(SUM(discount_cents), 0)::bigint AS discount")
  )) as Array<{ total: string; count: number; units: number; discount: string }>;
  const total = Number(row?.total ?? 0) / 100;
  const count = Number(row?.count ?? 0);
  return { total, count, units: Number(row?.units ?? 0), avg_ticket: count ? Math.round((total / count) * 100) / 100 : 0, discount: Number(row?.discount ?? 0) / 100 };
}

/** The same number of days just before `from` (HU-62: compare with the previous period). */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const day = 86400_000;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  const len = Math.round((b - a) / day) + 1;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(a - len * day), to: iso(a - day) };
}

export async function salesSummary(container: MedusaContainer, f: AnalyticsFilter): Promise<{ current: Summary; previous: Summary; balance_due: number; insurance_due: number }> {
  const pg = pgOf(container);
  const prev = previousPeriod(f.from, f.to);
  const [current, previous] = await Promise.all([summaryOf(pg, f), summaryOf(pg, { ...f, ...prev })]);
  // What customers and insurers still owe — outstanding today, not per period.
  const bal = pg("pos_sale").whereNull("deleted_at").where("status", "completed");
  const ins = pg("insurance_claim").whereNull("deleted_at").whereIn("status", ["pending", "submitted"]);
  if (f.stores) {
    const physical = f.stores.filter((s) => s !== "web");
    bal.whereIn("establishment_id", physical.length ? physical : ["-"]);
    ins.whereIn("establishment_id", physical.length ? physical : ["-"]);
  }
  if (f.sellers?.length) bal.whereIn("seller_id", f.sellers);
  const [[b], [i]] = await Promise.all([
    bal.select(pg.raw("COALESCE(SUM(balance_cents), 0)::bigint AS v")),
    f.sellers?.length ? Promise.resolve([{ v: 0 }]) : ins.select(pg.raw("COALESCE(SUM(covered_cents), 0)::bigint AS v")),
  ]) as Array<Array<{ v: string | number }>>;
  return { current, previous, balance_due: Number(b?.v ?? 0) / 100, insurance_due: Number(i?.v ?? 0) / 100 };
}

const COLUMN: Record<Exclude<Breakdown, "payment_method" | "establishment">, string> = {
  seller: "seller_code",
  product: "product_id",
  brand: "brand",
  category: "category",
  lens_design: "lens_design",
  lens_material: "lens_material",
  lens_photo: "lens_photo",
  lens_ar: "lens_ar",
  terminal: "terminal_id",
};

export interface BreakdownRow {
  key: string | null;
  label: string | null;
  total: number;
  count: number;
  units: number;
  share: number;
}

/** Ranking by a dimension (HU-63, HU-66, HU-115). */
export async function salesBreakdown(container: MedusaContainer, f: AnalyticsFilter, by: Breakdown, limit = 50): Promise<BreakdownRow[]> {
  const pg = pgOf(container);
  let q: Knex.QueryBuilder;
  if (by === "payment_method") {
    q = applyFilter(pg("sale_fact"), f)
      .joinRaw("CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(sale_fact.payment_methods, '[]'::jsonb)) AS pm(code)")
      .select(pg.raw("pm.code AS key"), pg.raw("NULL AS label"))
      .groupBy("pm.code");
  } else if (by === "establishment") {
    q = applyFilter(pg("sale_fact"), f)
      .select(pg.raw("CASE WHEN sale_fact.channel = 'web' THEN 'web' ELSE sale_fact.establishment_id END AS key"), pg.raw("NULL AS label"))
      .groupByRaw("CASE WHEN sale_fact.channel = 'web' THEN 'web' ELSE sale_fact.establishment_id END");
  } else {
    const col = `sale_fact.${COLUMN[by]}`;
    q = applyFilter(pg("sale_fact"), f)
      .select(pg.raw(`${col} AS key`), by === "product" ? pg.raw("MAX(sale_fact.title) AS label") : pg.raw("NULL AS label"))
      .groupBy(col);
  }
  const rows = (await q
    .select(
      pg.raw("COALESCE(SUM(sale_fact.total_cents), 0)::bigint AS total"),
      pg.raw("COUNT(DISTINCT sale_fact.order_id)::int AS count"),
      pg.raw("COALESCE(SUM(sale_fact.qty), 0)::int AS units")
    )
    .orderBy("total", "desc")
    .limit(limit)) as Array<{ key: string | null; label: string | null; total: string; count: number; units: number }>;
  const sum = rows.reduce((s, r) => s + Number(r.total), 0) || 1;
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    total: Number(r.total) / 100,
    count: Number(r.count),
    units: Number(r.units),
    share: Math.round((Number(r.total) / sum) * 1000) / 10,
  }));
}

/** Per local day, optionally per store (HU-62 charts). */
export async function salesTimeseries(container: MedusaContainer, f: AnalyticsFilter, byStore = false): Promise<Array<{ day: string; store: string | null; total: number; count: number }>> {
  const pg = pgOf(container);
  const q = applyFilter(pg("sale_fact"), f).select("sale_fact.sold_date_local as day");
  if (byStore) q.select(pg.raw("CASE WHEN sale_fact.channel = 'web' THEN 'web' ELSE sale_fact.establishment_id END AS store")).groupByRaw("sale_fact.sold_date_local, 2");
  else q.select(pg.raw("NULL AS store")).groupBy("sale_fact.sold_date_local");
  const rows = (await q
    .select(pg.raw("COALESCE(SUM(sale_fact.total_cents), 0)::bigint AS total"), pg.raw("COUNT(DISTINCT sale_fact.order_id)::int AS count"))
    .orderBy("day", "asc")) as Array<{ day: string; store: string | null; total: string; count: number }>;
  return rows.map((r) => ({ day: r.day, store: r.store, total: Number(r.total) / 100, count: Number(r.count) }));
}

export interface SaleListRow {
  order_id: string;
  sale_id: string | null;
  number: string | null;
  channel: string;
  establishment_id: string | null;
  seller_code: string | null;
  sold_at: string;
  total: number;
  discount: number;
  units: number;
  status: string;
  items: string;
}

/** The sales behind a number (HU-64: from a figure to the single sale). */
export async function salesList(container: MedusaContainer, f: AnalyticsFilter, take = 100, skip = 0): Promise<SaleListRow[]> {
  const pg = pgOf(container);
  const rows = (await applyFilter(pg("sale_fact"), f)
    .select(
      "sale_fact.order_id",
      pg.raw("MAX(sale_fact.sale_id) AS sale_id"),
      pg.raw("MAX(sale_fact.sale_number) AS number"),
      pg.raw("MAX(sale_fact.channel) AS channel"),
      pg.raw("MAX(sale_fact.establishment_id) AS establishment_id"),
      pg.raw("MAX(sale_fact.seller_code) AS seller_code"),
      pg.raw("MIN(sale_fact.sold_at) AS sold_at"),
      pg.raw("SUM(sale_fact.total_cents)::bigint AS total"),
      pg.raw("SUM(sale_fact.discount_cents)::bigint AS discount"),
      pg.raw("SUM(sale_fact.qty)::int AS units"),
      pg.raw("MAX(sale_fact.status) AS status"),
      pg.raw("STRING_AGG(sale_fact.title, ' · ') AS items")
    )
    .groupBy("sale_fact.order_id")
    .orderBy("sold_at", "desc")
    .limit(take)
    .offset(skip)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    order_id: String(r.order_id),
    sale_id: (r.sale_id as string | null) ?? null,
    number: (r.number as string | null) ?? null,
    channel: String(r.channel),
    establishment_id: (r.establishment_id as string | null) ?? null,
    seller_code: (r.seller_code as string | null) ?? null,
    sold_at: new Date(r.sold_at as string).toISOString(),
    total: Number(r.total) / 100,
    discount: Number(r.discount) / 100,
    units: Number(r.units),
    status: String(r.status),
    items: String(r.items ?? ""),
  }));
}

/** Lines as CSV (HU-65: export what is filtered). Excel opens it as is. */
export async function salesCsv(container: MedusaContainer, f: AnalyticsFilter, storeLabel: (id: string | null, channel: string) => string): Promise<string> {
  const pg = pgOf(container);
  const rows = (await applyFilter(pg("sale_fact"), f).select("sale_fact.*").orderBy("sold_at", "asc").limit(50000)) as Array<Record<string, unknown>>;
  const head = ["date", "sale", "store", "till", "seller", "product", "sku", "brand", "category", "lens_design", "lens_material", "photochromic", "anti_reflective", "rx", "qty", "list", "discount", "tax", "total", "payment_methods", "status"];
  const q = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.sold_date_local,
      r.sale_number ?? r.order_id,
      storeLabel((r.establishment_id as string | null) ?? null, String(r.channel)),
      r.terminal_id,
      r.seller_code,
      r.title,
      r.sku,
      r.brand,
      r.category,
      r.lens_design,
      r.lens_material,
      r.lens_photo,
      r.lens_ar,
      r.has_prescription ? "yes" : "no",
      r.qty,
      (Number(r.list_cents) / 100).toFixed(2),
      (Number(r.discount_cents) / 100).toFixed(2),
      (Number(r.tax_cents) / 100).toFixed(2),
      (Number(r.total_cents) / 100).toFixed(2),
      Array.isArray(r.payment_methods) ? (r.payment_methods as string[]).join("+") : "",
      r.status,
    ].map(q).join(",")
  );
  return [head.join(","), ...lines].join("\n");
}

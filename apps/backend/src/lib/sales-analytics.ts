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
  /** A row of the by-seller ranking is a code: web sales from a referral link have no user. */
  sellerCodes?: string[] | null;
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

export function applyFilter(q: Knex.QueryBuilder, f: AnalyticsFilter): Knex.QueryBuilder {
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
  if (f.sellerCodes?.length) q.whereIn("sale_fact.seller_code", f.sellerCodes);
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
  tax: number;
}

async function summaryOf(pg: Knex, f: AnalyticsFilter): Promise<Summary> {
  const [row] = (await applyFilter(pg("sale_fact"), f).select(
    pg.raw("COALESCE(SUM(total_cents), 0)::bigint AS total"),
    pg.raw("COUNT(DISTINCT order_id)::int AS count"),
    pg.raw("COALESCE(SUM(qty), 0)::int AS units"),
    pg.raw("COALESCE(SUM(discount_cents), 0)::bigint AS discount"),
    pg.raw("COALESCE(SUM(tax_cents), 0)::bigint AS tax")
  )) as Array<{ total: string; count: number; units: number; discount: string; tax: string }>;
  const total = Number(row?.total ?? 0) / 100;
  const count = Number(row?.count ?? 0);
  return { total, count, units: Number(row?.units ?? 0), avg_ticket: count ? Math.round((total / count) * 100) / 100 : 0, discount: Number(row?.discount ?? 0) / 100, tax: Number(row?.tax ?? 0) / 100 };
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

/**
 * Net (`total − tax`, integer cents) per panel user over a range of local
 * days — the base of the commission and of the monthly goal (HU-40), in one
 * query for every user asked. Users with no line get no entry.
 */
export async function netByUser(container: MedusaContainer, f: Pick<AnalyticsFilter, "from" | "to" | "stores">, userIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const pg = pgOf(container);
  const rows = (await applyFilter(pg("sale_fact"), { ...f, sellers: ids })
    .select("sale_fact.seller_id")
    .select(pg.raw("COALESCE(SUM(total_cents - tax_cents), 0)::bigint AS net"))
    .groupBy("sale_fact.seller_id")) as Array<{ seller_id: string; net: string | number }>;
  return new Map(rows.map((r) => [String(r.seller_id), Number(r.net) || 0]));
}

/**
 * Commission in integer cents over a filter: `pct` % of the net of EACH line,
 * rounded per line in SQL (`ROUND(numeric)`, half away from zero — the same
 * answer as `Math.round` for a positive amount), then added. It is what
 * lib/sales-insights.ts lineEconomics gives for the same lines, so the
 * seller's own panel and the Executive print the same cents; rounding once
 * over the month's net can differ by a cent. Pure over the connection.
 */
export async function lineCommissionCents(container: MedusaContainer, f: AnalyticsFilter, pct: number): Promise<number> {
  if (!pct || !Number.isFinite(pct)) return 0;
  const pg = pgOf(container);
  const [row] = (await applyFilter(pg("sale_fact"), f).select(
    pg.raw("COALESCE(SUM(ROUND(GREATEST(sale_fact.total_cents - sale_fact.tax_cents, 0) * ?::numeric / 100)), 0)::bigint AS cents", [pct])
  )) as Array<{ cents: string | number }>;
  return Number(row?.cents ?? 0) || 0;
}

/** One sale (order) of `sale_fact` as the seller stats read it: who sold it and what it took. */
export interface SellerFactOrder {
  order_id: string;
  channel: "pos" | "web";
  /** Panel user who sold at the till (`sale_fact.seller_id`); null on a web order. */
  seller_id: string | null;
  /** Referral code of a web order, or the till seller's receipt code (`staff_code`). */
  seller_code: string | null;
  /** ISO instant. */
  sold_at: string;
  /** Local calendar day of the sale (`sale_fact.sold_date_local`), the day every dashboard buckets on. */
  sold_date_local: string;
  /** Dollars: Σ `total_cents` (tax included, no shipping line exists in sale_fact). */
  total: number;
  /** Dollars: Σ `tax_cents`. */
  tax: number;
  /** Σ `qty`. */
  units: number;
  /**
   * Net of each line in cents (`total_cents − tax_cents`), so a commission can
   * be rounded per line exactly as lib/sales-insights.ts lineEconomics does;
   * rounding once over the order's net can differ from it by a cent.
   */
  net_cents_lines: number[];
}

/** `ARRAY_AGG` of integers as the driver hands it (an array, or "{1,2}" text on some paths), as cents. Pure. */
export function netLinesOf(value: unknown): number[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.replace(/^\{|\}$/g, "").split(",").filter(Boolean) : [];
  return list.map((v) => Math.round(Number(v)) || 0);
}

/** Most sales one seller-stats read aggregates; beyond it the response says `truncated`. */
export const MAX_SELLER_STAT_ORDERS = 20000;

/**
 * Every live sale in the filter, one row per order (lines summed), for
 * `lib/sellers.ts sellerStats`: the same rows and the same local-day filter as
 * the Executive (`applyFilter`), so Vendedores and Ejecutivo → Vendedores
 * agree. Till sales carry `seller_id`; web referrals only `seller_code`.
 */
export async function sellerFactOrders(container: MedusaContainer, f: Pick<AnalyticsFilter, "from" | "to" | "stores">): Promise<{ orders: SellerFactOrder[]; truncated: boolean }> {
  const pg = pgOf(container);
  const rows = (await applyFilter(pg("sale_fact"), { ...f, includeVoided: false })
    .select(
      "sale_fact.order_id",
      pg.raw("MAX(sale_fact.channel) AS channel"),
      pg.raw("MAX(sale_fact.seller_id) AS seller_id"),
      pg.raw("MAX(sale_fact.seller_code) AS seller_code"),
      pg.raw("MIN(sale_fact.sold_at) AS sold_at"),
      pg.raw("MIN(sale_fact.sold_date_local) AS sold_date_local"),
      pg.raw("COALESCE(SUM(sale_fact.total_cents), 0)::bigint AS total"),
      pg.raw("COALESCE(SUM(sale_fact.tax_cents), 0)::bigint AS tax"),
      pg.raw("COALESCE(SUM(sale_fact.qty), 0)::int AS units"),
      pg.raw("ARRAY_AGG(sale_fact.total_cents - sale_fact.tax_cents) AS net_lines")
    )
    .groupBy("sale_fact.order_id")
    .orderBy("sold_at", "desc")
    .limit(MAX_SELLER_STAT_ORDERS + 1)) as Array<{ order_id: string; channel: string | null; seller_id: string | null; seller_code: string | null; sold_at: string | Date; sold_date_local: string | null; total: string | number; tax: string | number; units: string | number; net_lines: unknown }>;
  const truncated = rows.length > MAX_SELLER_STAT_ORDERS;
  const kept = truncated ? rows.slice(0, MAX_SELLER_STAT_ORDERS) : rows;
  return {
    orders: kept.map((r) => ({
      order_id: String(r.order_id),
      channel: r.channel === "pos" ? "pos" : "web",
      seller_id: r.seller_id ? String(r.seller_id) : null,
      seller_code: r.seller_code ? String(r.seller_code) : null,
      sold_at: new Date(r.sold_at as string).toISOString(),
      sold_date_local: String(r.sold_date_local ?? ""),
      total: Number(r.total) / 100,
      tax: Number(r.tax) / 100,
      units: Number(r.units) || 0,
      net_cents_lines: netLinesOf(r.net_lines),
    })),
    truncated,
  };
}

/**
 * The network a web referral came from (`order.metadata.seller_source`, set
 * by the storefront from `?src=`), per order id. sale_fact does not carry it,
 * so the seller stats look it up only for the web orders that have a code.
 * Orders without a tag get no entry (the stats fall back to "link").
 */
export async function referralSourcesByOrder(container: MedusaContainer, orderIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(orderIds.filter(Boolean))];
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const pg = pgOf(container);
  for (let i = 0; i < ids.length; i += 500) {
    const rows = (await pg("order")
      .whereIn("id", ids.slice(i, i + 500))
      .select("id", pg.raw("metadata->>'seller_source' AS seller_source"))) as Array<{ id: string; seller_source: string | null }>;
    for (const r of rows) if (r.seller_source) out.set(String(r.id), String(r.seller_source));
  }
  return out;
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
      pg.raw("COALESCE(SUM(sale_fact.qty), 0)::int AS units"),
      // Share of the WHOLE dimension, not of the page: the window runs over
      // every group before LIMIT, so the 51st brand does not inflate the first
      // fifty. (lib/sales-insights.ts divides by the same kind of grand total.)
      pg.raw("COALESCE(SUM(SUM(sale_fact.total_cents)) OVER (), 0)::bigint AS grand_total")
    )
    .orderBy("total", "desc")
    .limit(limit)) as Array<{ key: string | null; label: string | null; total: string; count: number; units: number; grand_total: string }>;
  const sum = Number(rows[0]?.grand_total ?? 0) || 1;
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
  /** The customer's name (or email) when the sale has one. */
  customer: string | null;
  sold_at: string;
  total: number;
  discount: number;
  units: number;
  status: string;
  items: string;
  /** Collected so far: the till sale's payments; a web order is paid in full when placed. */
  paid: number;
  /** What the customer still owes (till sales only). */
  balance: number;
  /** The customer's phone when Medusa's customer has one (reports, not the dashboards). */
  customer_phone?: string | null;
  /** The frame sold: brand, model (product title; the customer's own description for an own frame), colour (variant), SKU. */
  frame_brand?: string | null;
  frame_model?: string | null;
  frame_color?: string | null;
  frame_sku?: string | null;
  /** Lenses mounted on a frame the customer brought. */
  own_frame?: boolean;
  /** Prescription lenses: a line with a prescription or a lens design other than frame-only. */
  has_rx?: boolean;
  /** Lens codes of the sale (design · material · photochromic · anti-reflective). */
  lens?: { design: string | null; material: string | null; photo: string | null; ar: string | null } | null;
  /** The same lenses as short labels in each language ("Monofocal · CR-39 · AR Premium"), codes when a label is missing. */
  lens_summary?: { es: string; en: string } | null;
}

/** What the aggregate query returns per order, before the lookups. */
export interface SaleListRaw {
  order_id: string;
  sale_id: string | null;
  number: string | null;
  channel: string;
  establishment_id: string | null;
  seller_code: string | null;
  customer_id: string | null;
  sold_at: string | Date;
  total: string | number;
  discount: string | number;
  units: string | number;
  status: string;
  items: string | null;
  frame_brand: string | null;
  frame_model: string | null;
  frame_sku: string | null;
  frame_line_id: string | null;
  own_frame: boolean | null;
  has_rx: boolean | null;
  lens_design: string | null;
  lens_material: string | null;
  lens_photo: string | null;
  lens_ar: string | null;
}

export interface SaleListLookups {
  sale?: { paid_cents: number | string; balance_cents: number | string } | null;
  customer?: { first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null } | null;
  /** The frame's order line: the variant title is the colour; an own frame keeps the customer's description in metadata. */
  line?: { variant_title?: string | null; metadata?: Record<string, unknown> | null } | null;
  labels?: LensLabelMaps;
}

type Bilingual = { label_es?: string | null; label_en?: string | null };
export type LensLabelMaps = { designs: Map<string, Bilingual>; materials: Map<string, Bilingual>; photos: Map<string, Bilingual>; ars: Map<string, Bilingual> };

/** "Monofocal · CR-39 · Fotocromático · AR" per language, with the code where a label is missing. Pure. */
export function lensSummaryOf(lens: { design: string | null; material: string | null; photo: string | null; ar: string | null }, labels?: LensLabelMaps): { es: string; en: string } | null {
  if (!lens.design && !lens.material && !lens.photo && !lens.ar) return null;
  const pick = (map: Map<string, Bilingual> | undefined, code: string | null, lang: "es" | "en") => {
    if (!code) return null;
    const l = map?.get(code);
    const v = lang === "es" ? l?.label_es ?? l?.label_en : l?.label_en ?? l?.label_es;
    return v && String(v).trim() ? String(v).trim() : code;
  };
  const build = (lang: "es" | "en") =>
    [pick(labels?.designs, lens.design, lang), pick(labels?.materials, lens.material, lang), pick(labels?.photos, lens.photo, lang), pick(labels?.ars, lens.ar, lang)].filter(Boolean).join(" · ");
  return { es: build("es"), en: build("en") };
}

/** One list row from the aggregate and its lookups. Pure, so the shape is testable without a database. */
export function saleListRowOf(r: SaleListRaw, x: SaleListLookups = {}): SaleListRow {
  const total = Number(r.total) / 100;
  const sale = x.sale ?? null;
  const c = x.customer ?? null;
  const ownMd = (x.line?.metadata?.own_frame ?? null) as { description?: string | null } | null;
  const own = Boolean(r.own_frame);
  const lens = { design: r.lens_design ?? null, material: r.lens_material ?? null, photo: r.lens_photo ?? null, ar: r.lens_ar ?? null };
  const hasLens = Boolean(lens.design || lens.material || lens.photo || lens.ar);
  const model = r.frame_model ?? (own ? (ownMd?.description && String(ownMd.description).trim()) || null : null);
  return {
    order_id: String(r.order_id),
    sale_id: r.sale_id ?? null,
    number: r.number ?? null,
    channel: String(r.channel),
    establishment_id: r.establishment_id ?? null,
    seller_code: r.seller_code ?? null,
    customer: c ? [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || c.email || null : null,
    sold_at: new Date(r.sold_at as string).toISOString(),
    total,
    discount: Number(r.discount) / 100,
    units: Number(r.units),
    status: String(r.status),
    items: String(r.items ?? ""),
    paid: sale ? Number(sale.paid_cents) / 100 : total,
    balance: sale ? Number(sale.balance_cents) / 100 : 0,
    customer_phone: c?.phone ? String(c.phone) : null,
    frame_brand: r.frame_brand ?? null,
    frame_model: model,
    frame_color: r.frame_model ? x.line?.variant_title ?? null : null,
    frame_sku: r.frame_sku ?? null,
    own_frame: own,
    has_rx: Boolean(r.has_rx),
    lens: hasLens ? lens : null,
    lens_summary: lensSummaryOf(lens, x.labels),
  };
}

/** Bilingual labels of the lens codes in use (same tables as the receipts; a table without `category` still answers). */
export async function lensLabelMaps(pg: Knex, codes: { designs: string[]; materials: string[]; photos: string[]; ars: string[] }): Promise<LensLabelMaps> {
  const fetch = async (table: string, list: string[]) => {
    const uniq = [...new Set(list.filter(Boolean))];
    if (!uniq.length) return new Map<string, Bilingual>();
    try {
      const rows = (await pg(table).whereIn("code", uniq).select("code", "label_es", "label_en")) as Array<{ code: string } & Bilingual>;
      return new Map(rows.map((r) => [String(r.code), r]));
    } catch {
      return new Map<string, Bilingual>();
    }
  };
  const [designs, materials, photos, ars] = await Promise.all([fetch("lens_design", codes.designs), fetch("lens_material", codes.materials), fetch("lens_photo_option", codes.photos), fetch("lens_ar_option", codes.ars)]);
  return { designs, materials, photos, ars };
}

/** Sales per page of the list by default, and the most a client may ask for. */
export const SALES_PAGE_DEFAULT = 100;
export const SALES_PAGE_MAX = 200;

/**
 * The page size the client asked for, clamped. A wider window is fewer round
 * trips for the panel; the cap is there because each row costs four lookups
 * (pos_sale, customer, order line, lens labels). Anything unreadable — absent,
 * empty, a word, zero, negative — falls back to the default instead of
 * returning nothing. Pure, so the route's contract is testable.
 */
export function salesPageSize(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return SALES_PAGE_DEFAULT;
  return Math.min(n, SALES_PAGE_MAX);
}

/**
 * How many sales the filter holds. One aggregate over the same rows as
 * `salesList` — the very COUNT(DISTINCT order_id) `summaryOf` already runs, no
 * join and none of the per-row lookups — so it is worth a round trip: knowing
 * the count up front lets a caller ask for every page at once instead of
 * walking them one by one until a short page tells it to stop.
 */
export async function salesListCount(container: MedusaContainer, f: AnalyticsFilter): Promise<number> {
  const pg = pgOf(container);
  const [row] = (await applyFilter(pg("sale_fact"), f).select(pg.raw("COUNT(DISTINCT sale_fact.order_id)::int AS count"))) as Array<{ count: number }>;
  return Number(row?.count ?? 0);
}

/** The sales behind a number (HU-64: from a figure to the single sale). */
export async function salesList(container: MedusaContainer, f: AnalyticsFilter, take = SALES_PAGE_DEFAULT, skip = 0): Promise<SaleListRow[]> {
  const pg = pgOf(container);
  const rows = (await applyFilter(pg("sale_fact"), f)
    .select(
      "sale_fact.order_id",
      pg.raw("MAX(sale_fact.sale_id) AS sale_id"),
      pg.raw("MAX(sale_fact.sale_number) AS number"),
      pg.raw("MAX(sale_fact.channel) AS channel"),
      pg.raw("MAX(sale_fact.establishment_id) AS establishment_id"),
      pg.raw("MAX(sale_fact.seller_code) AS seller_code"),
      pg.raw("MAX(sale_fact.customer_id) AS customer_id"),
      pg.raw("MIN(sale_fact.sold_at) AS sold_at"),
      pg.raw("SUM(sale_fact.total_cents)::bigint AS total"),
      pg.raw("SUM(sale_fact.discount_cents)::bigint AS discount"),
      pg.raw("SUM(sale_fact.qty)::int AS units"),
      pg.raw("MAX(sale_fact.status) AS status"),
      pg.raw("STRING_AGG(sale_fact.title, ' · ') AS items"),
      // The frame of the sale (one per till sale; the first frame line of a web order).
      pg.raw("MAX(sale_fact.brand) FILTER (WHERE sale_fact.category = 'frame') AS frame_brand"),
      pg.raw("MAX(sale_fact.title) FILTER (WHERE sale_fact.category = 'frame') AS frame_model"),
      pg.raw("MAX(sale_fact.sku) FILTER (WHERE sale_fact.category = 'frame') AS frame_sku"),
      pg.raw("MAX(sale_fact.line_item_id) FILTER (WHERE sale_fact.category IN ('frame', 'own_frame')) AS frame_line_id"),
      pg.raw("BOOL_OR(sale_fact.category = 'own_frame') AS own_frame"),
      pg.raw("BOOL_OR(sale_fact.has_prescription OR sale_fact.lens_design IS NOT NULL) AS has_rx"),
      pg.raw("MAX(sale_fact.lens_design) AS lens_design"),
      pg.raw("MAX(sale_fact.lens_material) AS lens_material"),
      pg.raw("MAX(sale_fact.lens_photo) AS lens_photo"),
      pg.raw("MAX(sale_fact.lens_ar) AS lens_ar")
    )
    .groupBy("sale_fact.order_id")
    .orderBy("sold_at", "desc")
    .limit(take)
    .offset(skip)) as SaleListRaw[];
  // Collected and owed come from the till sale; the customer's name and phone from Medusa's customer;
  // the colour from the frame's order line (variant title); lens labels from the lens tables.
  const uniq = (list: Array<string | null | undefined>) => [...new Set(list.filter((v): v is string => Boolean(v)))];
  const saleIds = uniq(rows.map((r) => r.sale_id));
  const customerIds = uniq(rows.map((r) => r.customer_id));
  const lineIds = uniq(rows.map((r) => r.frame_line_id));
  type CustomerRow = { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null };
  type LineRow = { id: string; variant_title: string | null; metadata: Record<string, unknown> | null };
  const [saleRows, customerRows, lineRows, labels] = await Promise.all([
    saleIds.length ? (pg("pos_sale").whereIn("id", saleIds).select("id", "paid_cents", "balance_cents") as Promise<Array<{ id: string; paid_cents: number | string; balance_cents: number | string }>>) : Promise.resolve([]),
    customerIds.length ? (pg("customer").whereIn("id", customerIds).select("id", "first_name", "last_name", "email", "phone") as Promise<CustomerRow[]>) : Promise.resolve([]),
    lineIds.length ? (pg("order_line_item").whereIn("id", lineIds).select("id", "variant_title", "metadata") as Promise<LineRow[]>).catch(() => [] as LineRow[]) : Promise.resolve([] as LineRow[]),
    lensLabelMaps(pg, { designs: uniq(rows.map((r) => r.lens_design)), materials: uniq(rows.map((r) => r.lens_material)), photos: uniq(rows.map((r) => r.lens_photo)), ars: uniq(rows.map((r) => r.lens_ar)) }),
  ]);
  const sales = new Map(saleRows.map((r) => [r.id, r]));
  const customers = new Map(customerRows.map((c) => [c.id, c]));
  const lines = new Map(lineRows.map((l) => [l.id, l]));
  return rows.map((r) =>
    saleListRowOf(r, {
      sale: r.sale_id ? sales.get(String(r.sale_id)) : null,
      customer: r.customer_id ? customers.get(String(r.customer_id)) : null,
      line: r.frame_line_id ? lines.get(String(r.frame_line_id)) : null,
      labels,
    })
  );
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

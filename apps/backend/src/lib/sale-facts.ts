import type { Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { POS_MODULE } from "../modules/pos";
import type PosModuleService from "../modules/pos/service";
import { SALES_ANALYTICS_MODULE } from "../modules/sales-analytics";
import type SalesAnalyticsModuleService from "../modules/sales-analytics/service";
import { localParts } from "./alerts";
import { loadProductMetadata } from "./frame-specs";
import { parseLensFinish } from "./lens-finish";
import { normalizeSellerCodeLoose } from "./order-board";
import { tenant } from "./tenant";

/**
 * The sale_fact projection: one row per sold line. Written when a till sale
 * is recorded and when a web order is placed, marked voided with the sale, and
 * rebuilt for history by src/scripts/backfill-sale-fact.ts. Best-effort: a
 * projection that fails is logged, the sale stands.
 */

const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);

export interface LineContext {
  orderId: string;
  channel: "pos" | "web";
  saleId: string | null;
  saleNumber: string | null;
  establishmentId: string | null;
  terminalId: string | null;
  sellerId: string | null;
  sellerCode: string | null;
  customerId: string | null;
  paymentMethods: string[];
  soldAt: Date;
  status: "active" | "voided";
  tz: string;
}

/**
 * The instant a sale happened, the one every day bucket is cut from. A till
 * sale's is `pos_sale.created_at`: the statement (lib/pos-statement.ts) and
 * the cash report already read that column, so the Executive's
 * `sold_date_local` must come from the same clock — the order row is written
 * a few hundred milliseconds earlier, and at 23:59:59 local those
 * milliseconds would put the same sale in two different days (and months).
 * A web order has only its own `created_at`. Pure.
 */
export function saleInstantOf(orderCreatedAt: string | Date, saleCreatedAt?: string | Date | null): Date {
  const sale = saleCreatedAt ? new Date(saleCreatedAt) : null;
  return sale && !Number.isNaN(sale.getTime()) ? sale : new Date(orderCreatedAt);
}

/** A line item as one fact. Pure. */
export function factFromLine(item: Record<string, unknown>, productMeta: Record<string, unknown>, ctx: LineContext) {
  const md = (item.metadata ?? {}) as Record<string, unknown>;
  const sel = (md.lens_config ?? {}) as Record<string, string | null>;
  const qty = Number(item.quantity ?? 1) || 1;
  const unit = cents(item.unit_price);
  const total = unit * qty;
  const tax = cents(md.tax_amount) * qty;
  const list = md.list_price !== undefined ? cents(md.list_price) * qty : total - tax;
  const slug = String(productMeta.brand_slug ?? productMeta.collection_slug ?? "");
  const own = md.kind === "own-frame";
  // A store frame off the catalog: a sold frame with no product; brand and model as typed.
  const offCat = (md.kind === "store-frame" ? md.store_frame ?? null : null) as { brand?: string | null; model?: string | null; description?: string | null } | null;
  const withLenses = Boolean(sel.design_code) && sel.design_code !== "frame-only";
  return {
    order_id: ctx.orderId,
    line_item_id: String(item.id),
    sale_id: ctx.saleId,
    sale_number: ctx.saleNumber,
    channel: ctx.channel,
    establishment_id: ctx.establishmentId,
    terminal_id: ctx.terminalId,
    seller_id: ctx.sellerId,
    seller_code: ctx.sellerCode,
    customer_id: ctx.customerId,
    product_id: own ? null : ((item.product_id as string | null) ?? null),
    variant_id: own ? null : ((item.variant_id as string | null) ?? null),
    sku: own ? null : ((item.variant_sku as string | null) ?? null),
    title: String(own ? "own_frame" : offCat ? offCat.model || offCat.description || item.title || "" : item.product_title ?? item.title ?? ""),
    brand: own ? null : offCat ? offCat.brand ?? null : ((productMeta.brand as string | undefined) ?? (slug || null)),
    category: own ? "own_frame" : slug === "case" ? "case" : "frame",
    lens_design: withLenses ? sel.design_code : null,
    lens_material: withLenses ? sel.material_code ?? null : null,
    lens_photo: withLenses ? sel.photo_code ?? null : null,
    lens_ar: withLenses ? sel.ar_code ?? null : null,
    lens_finish: withLenses ? parseLensFinish(sel.finish) : null,
    has_prescription: Boolean(md.prescription_id),
    qty,
    list_cents: list,
    discount_cents: Math.max(0, list - (total - tax)),
    tax_cents: tax,
    frame_cents: cents(md.frame_price) * qty,
    lenses_cents: cents(md.lens_addon) * qty,
    total_cents: total,
    payment_methods: ctx.paymentMethods as unknown as Record<string, unknown>,
    status: ctx.status,
    sold_at: ctx.soldAt,
    sold_date_local: localParts(ctx.soldAt, ctx.tz).date,
  };
}

/** (Re)writes the facts of one order. Idempotent: an order's rows are replaced. */
export async function projectOrder(container: MedusaContainer, orderId: string): Promise<number> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "created_at", "customer_id", "metadata", "status", "items.*"],
      filters: { id: orderId },
    });
    const order = data[0] as { id: string; created_at: string; customer_id?: string | null; metadata?: Record<string, unknown> | null; status?: string; items?: Array<Record<string, unknown>> } | undefined;
    if (!order) return 0;
    const md = order.metadata ?? {};
    const pos = container.resolve<PosModuleService>(POS_MODULE);
    const saleId = (md.pos_sale_id as string | undefined) ?? null;
    // By the stamped id, else by the order itself: a sale whose stamp on the
    // order failed (pos-data.ts stampOrder is best-effort) is still a till
    // sale, and without this it was projected as a web order of no store.
    const [sale] = saleId ? await pos.listPosSales({ id: saleId }, { take: 1 }) : await pos.listPosSales({ order_id: order.id } as never, { take: 1 });
    const payments = sale ? await pos.listPosSalePayments({ sale_id: sale.id }, { take: 100 }) : [];
    const isPos = md.source === "pos" || Boolean(sale);
    const ctx: LineContext = {
      orderId: order.id,
      channel: isPos ? "pos" : "web",
      saleId: sale?.id ?? null,
      saleNumber: sale?.number ?? null,
      establishmentId: isPos ? ((md.establishment_id as string | undefined) ?? sale?.establishment_id ?? null) : null,
      terminalId: (md.terminal_id as string | undefined) ?? sale?.terminal_id ?? null,
      sellerId: isPos ? ((md.seller_id as string | undefined) ?? sale?.seller_id ?? null) : null,
      // A web sale from a seller's referral link carries the code on the order.
      sellerCode: sale?.seller_code ?? normalizeSellerCodeLoose(md.seller_code),
      customerId: order.customer_id ?? null,
      paymentMethods: [...new Set(payments.filter((p) => p.kind !== "refund").map((p) => p.method_code))],
      soldAt: saleInstantOf(order.created_at, (sale as { created_at?: string | Date | null } | undefined)?.created_at ?? null),
      status: sale?.status === "voided" || order.status === "canceled" ? "voided" : "active",
      tz: tenant().timezone,
    };
    const items = order.items ?? [];
    const meta = await loadProductMetadata(container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION), items.map((i) => String(i.product_id ?? "")).filter(Boolean));
    const rows = items.map((it) => factFromLine(it, meta.get(String(it.product_id ?? "")) ?? {}, ctx));
    const svc = container.resolve<SalesAnalyticsModuleService>(SALES_ANALYTICS_MODULE);
    const existing = await svc.listSaleFacts({ order_id: order.id }, { take: 500 });
    if (existing.length) await svc.deleteSaleFacts(existing.map((r) => r.id));
    if (rows.length) await svc.createSaleFacts(rows as never);
    return rows.length;
  } catch (e) {
    logger.warn(`[sale-fact] order ${orderId}: ${(e as Error).message}`);
    return 0;
  }
}

/** A voided sale stays in the facts, marked voided (reports exclude it, history keeps it). */
export async function voidFacts(container: MedusaContainer, saleId: string): Promise<void> {
  try {
    const svc = container.resolve<SalesAnalyticsModuleService>(SALES_ANALYTICS_MODULE);
    const rows = await svc.listSaleFacts({ sale_id: saleId }, { take: 500 });
    if (rows.length) await svc.updateSaleFacts(rows.map((r) => ({ id: r.id, status: "voided" })) as never);
  } catch (e) {
    container.resolve<Logger>(ContainerRegistrationKeys.LOGGER).warn(`[sale-fact] void ${saleId}: ${(e as Error).message}`);
  }
}

/** How far back the reconciler looks for orders with no facts. */
export const RECONCILE_DAYS = 90;
/** Orders projected per run; the rest wait for the next one (the job runs every few hours). */
export const RECONCILE_BATCH = 500;

/**
 * Ids of the orders placed since `since` that have no `sale_fact` row —
 * projected at the time and lost to a failed write, a restart mid-way or an
 * order placed while the projection was down. Oldest first. Drafts never
 * count (not a sale yet); a canceled order is returned too, since
 * `projectOrder` writes it as voided facts, which is what history expects.
 * Pure over the connection: one LEFT JOIN, no service.
 */
export async function ordersMissingFacts(pg: Knex, since: Date, limit = RECONCILE_BATCH): Promise<string[]> {
  const rows = (await pg("order as o")
    .leftJoin("sale_fact as f", function joinLive() {
      this.on("f.order_id", "=", "o.id").andOnNull("f.deleted_at");
    })
    .whereNull("o.deleted_at")
    .where("o.created_at", ">=", since)
    .whereNotIn("o.status", ["draft", "archived"])
    .whereNull("f.id")
    .orderBy("o.created_at", "asc")
    .limit(limit)
    .select("o.id")) as Array<{ id: string }>;
  return rows.map((r) => String(r.id));
}

/**
 * Projects every recent order that has no facts (see `ordersMissingFacts`).
 * Idempotent and never throws: `projectOrder` replaces an order's rows and
 * logs its own failures. Logs `[sale-fact] reconciled N orders` when it did
 * anything. Returns how many orders got rows.
 */
export async function reconcileSaleFacts(container: MedusaContainer, now = new Date()): Promise<number> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  try {
    const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
    const since = new Date(now.getTime() - RECONCILE_DAYS * 86400_000);
    const ids = await ordersMissingFacts(pg, since);
    let done = 0;
    for (const id of ids) if ((await projectOrder(container, id)) > 0) done++;
    if (ids.length) logger.info(`[sale-fact] reconciled ${done} orders (${ids.length} without facts since ${since.toISOString().slice(0, 10)})`);
    return done;
  } catch (e) {
    logger.warn(`[sale-fact] reconcile skipped: ${(e as Error).message}`);
    return 0;
  }
}

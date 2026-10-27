import type { ICustomerModuleService, IOrderModuleService, Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  completeCartWorkflow,
  createCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
} from "@medusajs/medusa/core-flows";
import type { Knex } from "@mikro-orm/knex";
import type { Prescription } from "@eyewear/shared";
import { POS_MODULE } from "../modules/pos";
import type PosModuleService from "../modules/pos/service";
import { PRESCRIPTION_MODULE } from "../modules/prescription/index";
import type PrescriptionModuleService from "../modules/prescription/service";
import type { EstablishmentRow } from "./establishments";
import { computeLensBreakdown } from "./lens-quote";
import { opticalChange, type OpticalChange } from "./optical-change";
import { saleNumber, type PosCustomer, type PosLine, type PosPayment } from "./pos";
import { prescriptionColumns } from "./prescription-write";
import { storeLinePrice } from "./store-pricing";
import { openRules, productPrices } from "./store-pricing-data";
import { resolveStoreSettings } from "./store-settings";
import { uploadPrivateImage } from "./tryon-image";

/**
 * The point-of-sale sale, end to end. A sale is a regular Medusa order:
 *
 *   quote (store prices, server-side) → customer → prescriptions → cart in the
 *   store's sales channel → manual payment → completeCart → sale number + row.
 *
 * Prices are never taken from the client: the panel sends what is sold, the
 * server prices it with the store's rules (store-pricing.ts) and the lens
 * matrix, exactly like the preview the owner sees in the Stores tab.
 */

/** Medusa id of the manual payment provider (medusa-config: id "manual", identifier "manual"). */
const MANUAL_PROVIDER_ID = "pp_manual_manual";

/** A reason code the route returns as-is (`adm.err.pos.<reason>`). */
export class PosError extends Error {
  constructor(public reason: string, public status = 422) {
    super(reason);
  }
}

const pos = (c: MedusaContainer) => c.resolve<PosModuleService>(POS_MODULE);
const cents = (v: number) => Math.round(v * 100);

// ---------------------------------------------------------------------------
// Payment methods
// ---------------------------------------------------------------------------

export interface PaymentMethodRow {
  id: string;
  code: string;
  label: string | null;
  receivable: boolean;
  builtin: boolean;
  is_active: boolean;
  sort_order: number;
}

export async function listPaymentMethods(container: MedusaContainer): Promise<PaymentMethodRow[]> {
  const rows = await pos(container).listPosPaymentMethods({}, { take: 100, order: { sort_order: "ASC", created_at: "ASC" } });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    label: r.label ?? null,
    receivable: Boolean(r.receivable),
    builtin: Boolean(r.builtin),
    is_active: Boolean(r.is_active),
    sort_order: Number(r.sort_order ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Catalog and quote
// ---------------------------------------------------------------------------

export interface PosProduct {
  product_id: string;
  title: string;
  thumbnail: string | null;
  /** Frame only, in this store, before sales tax. Null when the model has no price. */
  price: number | null;
  variants: Array<{ id: string; title: string; sku: string | null }>;
}

/** Catalog search with each model's price in the store. */
export async function searchPosProducts(container: MedusaContainer, establishmentId: string, q: string): Promise<PosProduct[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return [];
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "title", "thumbnail", "variants.id", "variants.title", "variants.sku"],
    filters: { title: { $ilike: `%${term}%` }, status: "published" } as never,
    pagination: { take: 20 },
  });
  const products = data as Array<{ id: string; title: string; thumbnail?: string | null; variants?: Array<{ id: string; title?: string; sku?: string | null }> }>;
  const [rules, prices] = await Promise.all([
    openRules(container, [establishmentId]),
    productPrices(container, products.map((p) => p.id)),
  ]);
  const byId = new Map(prices.map((p) => [p.product_id, p.price]));
  const caseIds = caseProductIds(rules);
  return products.map((p) => {
    const base = byId.get(p.id) ?? null;
    return {
      product_id: p.id,
      title: p.title,
      thumbnail: p.thumbnail ?? null,
      price:
        base === null
          ? null
          : storeLinePrice(rules, { establishmentId, scope: caseIds.has(p.id) ? "case" : "frame", target: p.id, base, lenses: 0 }).total,
      variants: (p.variants ?? []).map((v) => ({ id: v.id, title: v.title ?? "", sku: v.sku ?? null })),
    };
  });
}

/** Products the owner priced as cases (rules with scope "case"); everything else is a frame. */
function caseProductIds(rules: Array<{ scope: string; target: string | null }>): Set<string> {
  return new Set(rules.filter((r) => r.scope === "case" && r.target).map((r) => r.target as string));
}

export interface QuotedLine {
  kind: PosLine["kind"];
  variant_id: string | null;
  product_id: string | null;
  title: string;
  variant_title: string | null;
  selection: PosLine["selection"];
  description: string | null;
  frame: number;
  lenses: number;
  /** Sales tax baked into unit_price: only a frame sold without lenses (as on the web). */
  tax_amount: number;
  tax_rate: number;
  unit_price: number;
  frame_source: "store_exact" | "adjusted" | "own_frame";
}

export interface Quote {
  lines: QuotedLine[];
  total: number;
  total_cents: number;
}

export async function quoteSale(container: MedusaContainer, establishmentId: string, lines: PosLine[]): Promise<Quote> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

  const variantIds = [...new Set(lines.map((l) => l.variant_id).filter((v): v is string => Boolean(v)))];
  const { data: variants } = variantIds.length
    ? await query.graph({
        entity: "variant",
        fields: ["id", "title", "product.id", "product.title"],
        filters: { id: variantIds },
      })
    : { data: [] as unknown[] };
  const variantById = new Map(
    (variants as Array<{ id: string; title?: string; product?: { id: string; title?: string } }>).map((v) => [v.id, v])
  );
  const productIds = [...new Set([...variantById.values()].map((v) => v.product?.id).filter((v): v is string => Boolean(v)))];
  const [rules, prices, settings] = await Promise.all([
    openRules(container, [establishmentId]),
    productPrices(container, productIds),
    resolveStoreSettings(container),
  ]);
  const priceById = new Map(prices.map((p) => [p.product_id, p.price]));
  const caseIds = caseProductIds(rules);

  const quoted: QuotedLine[] = [];
  for (const line of lines) {
    let lensCents: number;
    try {
      lensCents = (await computeLensBreakdown(pg, line.selection)).total_cents;
    } catch {
      throw new PosError("bad_lens");
    }

    if (line.kind === "own_frame") {
      // No frame is sold: the store's adjustment applies to the lenses alone
      // (a fixed amount lands on the frame part when the base is 0, so move it).
      const sp = storeLinePrice(rules, { establishmentId, scope: "frame", target: "", base: 0, lenses: lensCents / 100 });
      const lenses = (cents(sp.frame) + cents(sp.lenses)) / 100;
      quoted.push({
        kind: line.kind,
        variant_id: null,
        product_id: null,
        title: "own_frame",
        variant_title: null,
        selection: line.selection,
        description: line.description,
        frame: 0,
        lenses,
        tax_amount: 0,
        tax_rate: 0,
        unit_price: lenses,
        frame_source: "own_frame",
      });
      continue;
    }

    const variant = variantById.get(line.variant_id as string);
    const productId = variant?.product?.id;
    if (!variant || !productId) throw new PosError("bad_variant");
    const base = priceById.get(productId);
    if (base == null) throw new PosError("no_price");

    const sp = storeLinePrice(rules, {
      establishmentId,
      scope: caseIds.has(productId) ? "case" : "frame",
      target: productId,
      base,
      lenses: lensCents / 100,
    });
    // Sales tax only on a frame sold without lenses: prescription lenses are a
    // medical product (same rule as the web's configured-line route).
    let tax_rate = 0;
    let tax_amount = 0;
    if (line.selection.design_code === "frame-only" && settings.frame_tax_rate > 0) {
      tax_rate = settings.frame_tax_rate;
      tax_amount = cents(sp.total * tax_rate) / 100;
    }
    quoted.push({
      kind: line.kind,
      variant_id: variant.id,
      product_id: productId,
      title: variant.product?.title ?? "",
      variant_title: variant.title ?? null,
      selection: line.selection,
      description: null,
      frame: sp.frame,
      lenses: sp.lenses,
      tax_amount,
      tax_rate,
      unit_price: (cents(sp.total) + cents(tax_amount)) / 100,
      frame_source: sp.frame_source,
    });
  }

  const total_cents = quoted.reduce((s, l) => s + cents(l.unit_price), 0);
  return { lines: quoted, total: total_cents / 100, total_cents };
}

// ---------------------------------------------------------------------------
// Sale
// ---------------------------------------------------------------------------

export interface RxInput {
  rx: Prescription;
  /** YYYY-MM-DD written on the prescription, when known. */
  rx_date?: string | null;
}

export interface CreateSaleInput {
  store: EstablishmentRow;
  sellerId: string | null;
  customer: PosCustomer;
  lines: PosLine[];
  payments: PosPayment[];
  quote: Quote;
  /** The prescription being made (required with lenses) and the one the patient wears (optional). */
  prescriptions: { new: RxInput | null; worn: RxInput | null };
  notifyEmail: boolean;
}

export interface CreatedSale {
  id: string;
  number: string;
  order_id: string;
  display_id: number | null;
  total: number;
  /** "Daño óptico" for the screen only — never on receipts, emails or Sheets. */
  optical_change: OpticalChange | null;
}

const rxDate = (v: unknown): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;

function hasEyes(input: RxInput | null | undefined): input is RxInput {
  return Boolean(input?.rx?.od && input.rx.os);
}

/** Validates the prescriptions before anything is written; throws PosError. */
export function checkPrescriptions(container: MedusaContainer, input: CreateSaleInput["prescriptions"], required: boolean): void {
  if (input.worn && !hasEyes(input.worn)) throw new PosError("bad_worn_prescription");
  if (!input.new) {
    if (required) throw new PosError("prescription_required");
    return;
  }
  if (!hasEyes(input.new)) throw new PosError("prescription_required");
  const svc = container.resolve<PrescriptionModuleService>(PRESCRIPTION_MODULE);
  const validation = svc.validate({ ...input.new.rx, source: "manual", verified_by_user: true, file_url: null } as never, {});
  // Same rule as the web: a prescription the lab cannot cut is never stored.
  if (validation && validation.fulfillable === false) throw new PosError("invalid_prescription");
}

async function upsertCustomer(container: MedusaContainer, c: PosCustomer): Promise<string> {
  const svc = container.resolve<ICustomerModuleService>(Modules.CUSTOMER);
  const [existing] = await svc.listCustomers({ email: c.email }, { take: 1, order: { created_at: "ASC" } });
  if (existing) {
    // Fill gaps only: a store clerk does not overwrite what the customer wrote
    // in their own account.
    const metadata = { ...(existing.metadata ?? {}) } as Record<string, unknown>;
    if (!metadata.birth_date) metadata.birth_date = c.birth_date;
    await svc.updateCustomers(existing.id, {
      first_name: existing.first_name || c.first_name,
      last_name: existing.last_name || c.last_name,
      phone: existing.phone || c.phone,
      metadata,
    });
    return existing.id;
  }
  const created = await svc.createCustomers({
    email: c.email,
    first_name: c.first_name,
    last_name: c.last_name,
    phone: c.phone,
    has_account: false,
    metadata: { birth_date: c.birth_date, created_at_store: true },
  });
  return created.id;
}

async function insertPrescriptions(
  container: MedusaContainer,
  input: CreateSaleInput["prescriptions"],
  customerId: string
): Promise<{ newId: string | null }> {
  const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  const row = (r: RxInput, kind: "worn" | "new", previous: string | null) => ({
    ...prescriptionColumns(r.rx),
    source: "manual",
    verified_by_user: true,
    file_url: null,
    customer_id: customerId,
    kind,
    rx_date: rxDate(r.rx_date),
    previous_prescription_id: previous,
  });
  let wornId: string | null = null;
  if (input.worn) {
    const [w] = await pg("prescription").insert(row(input.worn, "worn", null)).returning("id");
    wornId = (w as { id: string }).id;
  }
  if (!input.new) return { newId: null };
  const [n] = await pg("prescription").insert(row(input.new, "new", wornId)).returning("id");
  return { newId: (n as { id: string }).id };
}

/** Next number of a store's sequence; atomic, so two tills never get the same one. */
async function nextSaleSeq(container: MedusaContainer, establishmentId: string): Promise<number> {
  const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  const res = await pg.raw(
    `INSERT INTO pos_sale_counter (establishment_id, last_seq) VALUES (?, 1)
     ON CONFLICT (establishment_id) DO UPDATE SET last_seq = pos_sale_counter.last_seq + 1
     RETURNING last_seq`,
    [establishmentId]
  );
  return Number((res as { rows: Array<{ last_seq: number }> }).rows[0].last_seq);
}

async function usdRegionId(container: MedusaContainer): Promise<string> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({ entity: "region", fields: ["id", "currency_code"] });
  const region = (data as Array<{ id: string; currency_code: string }>).find((r) => r.currency_code === "usd");
  if (!region) throw new PosError("no_region", 503);
  return region.id;
}

export async function createPosSale(container: MedusaContainer, input: CreateSaleInput): Promise<CreatedSale> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { store, customer, quote } = input;
  if (!store.sales_channel_id) throw new PosError("store_without_channel", 409);

  const regionId = await usdRegionId(container);
  const customerId = await upsertCustomer(container, customer);
  const { newId } = await insertPrescriptions(container, input.prescriptions, customerId);

  // Photos of frames the customer brought go to the private bucket (health
  // context: they travel with the prescription to the lab).
  const photoKeys: Array<string | null> = [];
  for (const line of input.lines) {
    photoKeys.push(line.kind === "own_frame" ? await uploadPrivateImage(line.photo, "posframe") : null);
  }

  const address = {
    first_name: customer.first_name,
    last_name: customer.last_name,
    phone: customer.phone,
    ...(customer.address
      ? {
          address_1: customer.address.address_1,
          city: customer.address.city,
          province: customer.address.province ?? undefined,
          postal_code: customer.address.postal_code,
          country_code: customer.address.country_code,
        }
      : {}),
  };

  const { result: cart } = await createCartWorkflow(container).run({
    input: {
      region_id: regionId,
      sales_channel_id: store.sales_channel_id,
      currency_code: "usd",
      email: customer.email,
      customer_id: customerId,
      shipping_address: address,
      billing_address: address,
      metadata: {
        channel: "pos",
        establishment_id: store.id,
        establishment_code: store.code,
        seller_id: input.sellerId,
        notify_email: input.notifyEmail,
        notify_sms: false,
        patient_phone: customer.phone,
      },
      items: quote.lines.map((l, i) => {
        const withRx = l.selection.design_code !== "frame-only";
        const metadata = {
          kind: l.kind === "own_frame" ? "own-frame" : "configured-frame",
          channel: "pos",
          lens_config: l.selection,
          // By id only: the Rx values (PHI) live in the prescription record.
          prescription_id: withRx ? newId : null,
          frame_price: l.frame,
          lens_addon: l.lenses,
          tax_amount: l.tax_amount,
          tax_rate: l.tax_rate,
          price_pretax: (cents(l.frame) + cents(l.lenses)) / 100,
          frame_source: l.frame_source,
          own_frame_description: l.description,
          own_frame_photo_key: photoKeys[i],
        };
        // Nothing is shipped from the till: without this Medusa would ask for
        // a shipping method before completing the cart.
        return l.variant_id
          ? { variant_id: l.variant_id, quantity: 1, unit_price: l.unit_price, requires_shipping: false, metadata }
          : { title: l.description || "Own frame", quantity: 1, unit_price: l.unit_price, requires_shipping: false, metadata };
      }),
    } as never,
  });
  const cartId = (cart as { id: string }).id;

  // Defensive: the cart must total what was quoted, or something priced it
  // differently (a tax provider, a promotion) and the payments would not match.
  const { data: carts } = await query.graph({ entity: "cart", fields: ["id", "total"], filters: { id: cartId } });
  const cartTotal = cents(Number((carts[0] as { total?: number } | undefined)?.total ?? NaN));
  if (cartTotal !== quote.total_cents) {
    logger.error(`[pos] cart ${cartId} totals ${cartTotal} cents but the quote was ${quote.total_cents}; sale not completed.`);
    throw new PosError("total_changed", 409);
  }

  await createPaymentCollectionForCartWorkflow(container).run({ input: { cart_id: cartId } });
  const { data: withCollection } = await query.graph({
    entity: "cart",
    fields: ["id", "payment_collection.id"],
    filters: { id: cartId },
  });
  const collectionId = (withCollection[0] as { payment_collection?: { id: string } } | undefined)?.payment_collection?.id;
  if (!collectionId) throw new PosError("payment_failed", 500);
  await createPaymentSessionsWorkflow(container).run({
    input: { payment_collection_id: collectionId, provider_id: MANUAL_PROVIDER_ID, customer_id: customerId },
  });
  const { result: completed } = await completeCartWorkflow(container).run({ input: { id: cartId } });
  const orderId = (completed as { id: string }).id;

  // The number is taken only now that the order exists: a failed sale never
  // leaves a hole in the store's sequence.
  const seq = await nextSaleSeq(container, store.id);
  const number = saleNumber(store.code, seq);
  const svc = pos(container);
  const sale = await svc.createPosSales({
    number,
    establishment_id: store.id,
    seq,
    seller_id: input.sellerId,
    order_id: orderId,
    cart_id: cartId,
    customer_id: customerId,
    total_cents: quote.total_cents,
    currency_code: "usd",
    own_frame_photo_keys: photoKeys.filter(Boolean) as unknown as Record<string, unknown>,
  });
  await svc.createPosSalePayments(
    input.payments.map((p) => ({ sale_id: sale.id, method_code: p.method_code, amount_cents: p.amount_cents, reference: p.reference }))
  );

  // The order board and the emails show the store's number. Best-effort: the
  // sale row already links both ways.
  let displayId: number | null = null;
  try {
    const orders = container.resolve<IOrderModuleService>(Modules.ORDER);
    const order = await orders.retrieveOrder(orderId, { select: ["id", "display_id", "metadata"] });
    displayId = Number(order.display_id) || null;
    await orders.updateOrders(orderId, { metadata: { ...(order.metadata ?? {}), pos_sale_number: number, pos_sale_id: sale.id } });
  } catch (e) {
    logger.warn(`[pos] sale ${number}: could not stamp the order ${orderId}: ${(e as Error).message}`);
  }

  logger.info(`[pos] sale ${number} (order ${orderId}) by ${input.sellerId ?? "?"} in ${store.code}: ${quote.total_cents} cents`);

  const pn = input.prescriptions;
  const change =
    pn.worn && pn.new
      ? opticalChange(
          { od: pn.worn.rx.od, os: pn.worn.rx.os, rx_date: rxDate(pn.worn.rx_date) },
          { od: pn.new.rx.od, os: pn.new.rx.os }
        )
      : null;

  return { id: sale.id, number, order_id: orderId, display_id: displayId, total: quote.total, optical_change: change };
}

// ---------------------------------------------------------------------------
// Sales list
// ---------------------------------------------------------------------------

export interface SaleRow {
  id: string;
  number: string;
  establishment_id: string;
  seller_id: string | null;
  order_id: string | null;
  total: number;
  status: string;
  created_at: string;
  payments: Array<{ method_code: string; amount: number; reference: string | null }>;
}

/** Latest sales of some stores (null = every store), newest first. */
export async function listSales(container: MedusaContainer, establishmentIds: string[] | null, take = 50): Promise<SaleRow[]> {
  const svc = pos(container);
  const filters = establishmentIds === null ? {} : { establishment_id: establishmentIds };
  const sales = await svc.listPosSales(filters as never, { take, order: { created_at: "DESC" } });
  const payments = sales.length ? await svc.listPosSalePayments({ sale_id: sales.map((s) => s.id) }, { take: sales.length * 6 }) : [];
  return sales.map((s) => ({
    id: s.id,
    number: s.number,
    establishment_id: s.establishment_id,
    seller_id: s.seller_id ?? null,
    order_id: s.order_id ?? null,
    total: Number(s.total_cents) / 100,
    status: String(s.status),
    created_at: String(s.created_at),
    payments: payments
      .filter((p) => p.sale_id === s.id)
      .map((p) => ({ method_code: p.method_code, amount: Number(p.amount_cents) / 100, reference: p.reference ?? null })),
  }));
}

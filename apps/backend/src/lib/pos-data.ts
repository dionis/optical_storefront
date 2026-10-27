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
import { recordAudit } from "./audit";
import type { EstablishmentRow } from "./establishments";
import { loadProductMetadata } from "./frame-specs";
import { computeLensBreakdown } from "./lens-quote";
import { opticalChange, type EyeRx, type OpticalChange, type Thresholds } from "./optical-change";
import { addBusinessDays, LAB_BUSINESS_DAYS } from "./order-status";
import {
  discountLine,
  lowestFreeTray,
  nextTerminalCode,
  rxNumber,
  saleNumber,
  type CleanedPayments,
  type PaymentMethodLike,
  type PosCustomer,
  type PosLine,
  type PosPayment,
  type WornSource,
} from "./pos";
import { prescriptionColumns } from "./prescription-write";
import { projectOrder, voidFacts } from "./sale-facts";
import { belowMinimum, lineMinimum, storeLinePrice } from "./store-pricing";
import { openRules, productPrices } from "./store-pricing-data";
import { resolveStoreSettings } from "./store-settings";
import { uploadPrivateImage } from "./tryon-image";

/**
 * The point-of-sale sale, end to end. A sale is a regular Medusa order:
 *
 *   quote (store prices + discount, server-side) → customer → prescriptions
 *   → cart in the store's sales channel → manual payment → completeCart
 *   → sale number, tray, ledger of what was actually paid.
 *
 * Prices are never taken from the client: the panel sends what is sold and
 * the discount percentage, the server prices it with the store's rules
 * (store-pricing.ts) and the lens matrix, exactly like the preview the owner
 * sees in the Stores tab. Medusa records the whole order through the manual
 * provider; what the customer really paid (deposit, balance, insurer's part)
 * is in our ledger, pos_sale_payment.
 */

/** Medusa id of the manual payment provider (medusa-config: id "manual", identifier "manual"). */
const MANUAL_PROVIDER_ID = "pp_manual_manual";

/** How long an approved discount stays usable. */
export const APPROVAL_TTL_HOURS = 24;

/** A reason code the route returns as-is (`adm.err.pos.<reason>`). */
export class PosError extends Error {
  constructor(public reason: string, public status = 422, public extra: Record<string, unknown> = {}) {
    super(reason);
  }
}

const pos = (c: MedusaContainer) => c.resolve<PosModuleService>(POS_MODULE);
const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
const cents = (v: number) => Math.round(v * 100);
const dollars = (c: number) => c / 100;

// ---------------------------------------------------------------------------
// Payment methods
// ---------------------------------------------------------------------------

export interface PaymentMethodRow extends PaymentMethodLike {
  id: string;
  code: string;
  label: string | null;
  label_en: string | null;
  kind: string;
  builtin: boolean;
  is_active: boolean;
  sort_order: number;
  fee_pct: number;
  fee_fixed_cents: number;
  counts_as_cash: boolean;
  establishment_ids: string[] | null;
  reference_fields: Array<{ key: string; required?: boolean; label?: string; label_en?: string }>;
}

export async function listPaymentMethods(container: MedusaContainer): Promise<PaymentMethodRow[]> {
  const rows = await pos(container).listPosPaymentMethods({}, { take: 100, order: { sort_order: "ASC", created_at: "ASC" } });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    label: r.label ?? null,
    label_en: (r.label_en as string | null) ?? null,
    kind: String(r.kind ?? "other"),
    receivable: Boolean(r.receivable),
    builtin: Boolean(r.builtin),
    is_active: Boolean(r.is_active),
    sort_order: Number(r.sort_order ?? 0),
    fee_pct: Number(r.fee_pct ?? 0),
    fee_fixed_cents: Number(r.fee_fixed_cents ?? 0),
    counts_as_cash: Boolean(r.counts_as_cash),
    establishment_ids: Array.isArray(r.establishment_ids) ? (r.establishment_ids as string[]) : null,
    reference_fields: Array.isArray(r.reference_fields) ? (r.reference_fields as PaymentMethodRow["reference_fields"]) : [],
  }));
}

// ---------------------------------------------------------------------------
// Tills (puntos de venta) and trays
// ---------------------------------------------------------------------------

export interface TerminalRow {
  id: string;
  establishment_id: string;
  code: string;
  name: string | null;
  receipt_locale: string;
  ticket_locale: string;
  is_active: boolean;
}

const toTerminal = (r: Record<string, unknown>): TerminalRow => ({
  id: String(r.id),
  establishment_id: String(r.establishment_id),
  code: String(r.code),
  name: (r.name as string | null) ?? null,
  receipt_locale: String(r.receipt_locale ?? "es"),
  ticket_locale: String(r.ticket_locale ?? "en"),
  is_active: Boolean(r.is_active),
});

export async function listTerminals(container: MedusaContainer, establishmentIds: string[] | null): Promise<TerminalRow[]> {
  const filters = establishmentIds === null ? {} : { establishment_id: establishmentIds };
  const rows = await pos(container).listPosTerminals(filters as never, { take: 500, order: { code: "ASC" } });
  return rows.map((r) => toTerminal(r as unknown as Record<string, unknown>));
}

/** Creates the next till of a store (Op2-POS1, Op2-POS2…); codes are never reused. */
export async function createTerminal(
  container: MedusaContainer,
  store: EstablishmentRow,
  input: { name?: string | null; receipt_locale?: string; ticket_locale?: string },
  actorId: string | null
): Promise<TerminalRow> {
  const svc = pos(container);
  const all = await svc.listPosTerminals({ establishment_id: store.id }, { take: 500, withDeleted: true });
  const created = await svc.createPosTerminals({
    establishment_id: store.id,
    code: nextTerminalCode(store.code, all.map((t) => t.code)),
    name: input.name ?? null,
    receipt_locale: input.receipt_locale === "en" ? "en" : "es",
    ticket_locale: input.ticket_locale === "es" ? "es" : "en",
    created_by: actorId,
    updated_by: actorId,
  });
  return toTerminal(created as unknown as Record<string, unknown>);
}

/** Every store sells from at least one till: the first one is made on demand. */
export async function ensureTerminal(container: MedusaContainer, store: EstablishmentRow, actorId: string | null): Promise<TerminalRow[]> {
  const list = await listTerminals(container, [store.id]);
  if (list.length) return list;
  return [await createTerminal(container, store, { name: null }, actorId)];
}

/** Takes the lowest free tray of the store for a sale (race-safe via the partial unique index). */
async function takeTray(container: MedusaContainer, establishmentId: string, saleId: string): Promise<number> {
  const svc = pos(container);
  for (let attempt = 0; attempt < 5; attempt++) {
    const inUse = await svc.listPosTrays({ establishment_id: establishmentId, released_at: null } as never, { take: 5000 });
    const number = lowestFreeTray(inUse.map((t) => Number(t.number)));
    try {
      await svc.createPosTrays({ establishment_id: establishmentId, number, sale_id: saleId, assigned_at: new Date() });
      return number;
    } catch (e) {
      if (!/unique|duplicate/i.test((e as Error).message)) throw e;
    }
  }
  throw new PosError("no_free_tray", 409);
}

export async function releaseTray(container: MedusaContainer, saleId: string): Promise<void> {
  const svc = pos(container);
  const held = await svc.listPosTrays({ sale_id: saleId, released_at: null } as never, { take: 10 });
  if (held.length) await svc.updatePosTrays(held.map((t) => ({ id: t.id, released_at: new Date() })) as never);
}

// ---------------------------------------------------------------------------
// Customers (HU-22, HU-70, HU-87)
// ---------------------------------------------------------------------------

export interface PosCustomerRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
}

const digits = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");

function toCustomer(c: { id: string; first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null; metadata?: Record<string, unknown> | null }): PosCustomerRow {
  return {
    id: c.id,
    first_name: c.first_name ?? null,
    last_name: c.last_name ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    birth_date: (c.metadata?.birth_date as string | undefined) ?? null,
  };
}

/** Ids of customers whose phone has the same digits (last 10, so "+1" or not both match). */
async function customerIdsByPhone(container: MedusaContainer, phone: string): Promise<string[]> {
  const d = digits(phone).slice(-10);
  if (d.length < 7) return [];
  const rows = await pgOf(container)("customer")
    .whereNull("deleted_at")
    .whereRaw(`right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = ?`, [d])
    .select("id")
    .limit(10);
  return (rows as Array<{ id: string }>).map((r) => r.id);
}

/** Search by name, email or phone, in every store (a customer belongs to the business). */
export async function searchCustomers(container: MedusaContainer, q: string): Promise<PosCustomerRow[]> {
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return [];
  const svc = container.resolve<ICustomerModuleService>(Modules.CUSTOMER);
  const byPhone = digits(term).length >= 7 ? await customerIdsByPhone(container, term) : [];
  const [found, phoned] = await Promise.all([
    svc.listCustomers({ q: term } as never, { take: 15, order: { created_at: "DESC" } }),
    byPhone.length ? svc.listCustomers({ id: byPhone }, { take: 10 }) : Promise.resolve([]),
  ]);
  const seen = new Set<string>();
  return [...phoned, ...found]
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .slice(0, 15)
    .map((c) => toCustomer(c as never));
}

export async function getCustomer(container: MedusaContainer, id: string): Promise<PosCustomerRow | null> {
  const svc = container.resolve<ICustomerModuleService>(Modules.CUSTOMER);
  const [c] = await svc.listCustomers({ id }, { take: 1 });
  return c ? toCustomer(c as never) : null;
}

/**
 * The customer of a sale: the one chosen, else an existing one with the same
 * email or phone (HU-87: never a duplicate), else a new one. On an existing
 * customer only empty fields are filled — a clerk never overwrites what the
 * customer wrote in their own account.
 */
async function upsertCustomer(container: MedusaContainer, c: PosCustomer, customerId: string | null): Promise<string> {
  const svc = container.resolve<ICustomerModuleService>(Modules.CUSTOMER);
  let existing = customerId ? (await svc.listCustomers({ id: customerId }, { take: 1 }))[0] : undefined;
  if (customerId && !existing) throw new PosError("customer_not_found", 404);
  if (!existing) existing = (await svc.listCustomers({ email: c.email }, { take: 1, order: { created_at: "ASC" } }))[0];
  if (!existing) {
    const ids = await customerIdsByPhone(container, c.phone);
    if (ids.length) existing = (await svc.listCustomers({ id: ids }, { take: 1, order: { created_at: "ASC" } }))[0];
  }
  if (existing) {
    const metadata = { ...(existing.metadata ?? {}) } as Record<string, unknown>;
    if (!metadata.birth_date) metadata.birth_date = c.birth_date;
    await svc.updateCustomers(existing.id, {
      first_name: existing.first_name || c.first_name,
      last_name: existing.last_name || c.last_name,
      phone: existing.phone || c.phone,
      email: existing.email || c.email,
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

// ---------------------------------------------------------------------------
// Prescriptions at the counter (HU-23, HU-120 to HU-124)
// ---------------------------------------------------------------------------

export interface RxInput {
  rx: Prescription;
  /** YYYY-MM-DD written on the prescription, when known. */
  rx_date?: string | null;
  /** "About N months ago", when the date is not known (HU-121). */
  approx_months_ago?: number | null;
  /** On the worn one: where it came from (HU-120). */
  worn_source?: WornSource | null;
}

export interface RxMeta {
  rx_date: string | null;
  rx_date_approx: boolean;
  worn_source: WornSource | null;
}

export interface StoredRx {
  id: string;
  kind: "worn" | "new" | null;
  rx_number: string | null;
  rx_date: string | null;
  rx_date_approx: boolean;
  worn_source: string | null;
  created_at: string;
  od: EyeRx & { prism: number | null; base: string | null };
  os: EyeRx & { prism: number | null; base: string | null };
  pd: number | null;
  pd_od: number | null;
  pd_os: number | null;
  seg_height: number | null;
}

const n = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const isoDay = (v: unknown): string | null => (v ? new Date(v as string).toISOString().slice(0, 10) : null);

function toStoredRx(r: Record<string, unknown>): StoredRx {
  return {
    id: String(r.id),
    kind: (r.kind as StoredRx["kind"]) ?? null,
    rx_number: (r.rx_number as string | null) ?? null,
    rx_date: isoDay(r.rx_date),
    rx_date_approx: Boolean(r.rx_date_approx),
    worn_source: (r.worn_source as string | null) ?? null,
    created_at: new Date(r.created_at as string).toISOString(),
    od: { sph: n(r.od_sph), cyl: n(r.od_cyl), axis: n(r.od_axis), add: n(r.od_add), prism: n(r.od_prism), base: (r.od_base as string | null) ?? null },
    os: { sph: n(r.os_sph), cyl: n(r.os_cyl), axis: n(r.os_axis), add: n(r.os_add), prism: n(r.os_prism), base: (r.os_base as string | null) ?? null },
    pd: n(r.pd),
    pd_od: n(r.pd_od),
    pd_os: n(r.pd_os),
    seg_height: n(r.seg_height),
  };
}

/**
 * The customer's prescriptions, oldest first. A "new" one (or a web one, kind
 * null) is what they were last made; a "worn" one is what they arrived with.
 */
async function customerPrescriptions(container: MedusaContainer, customerId: string): Promise<StoredRx[]> {
  const rows = await pgOf(container)("prescription")
    .whereNull("deleted_at")
    .where({ customer_id: customerId })
    .orderBy("created_at", "asc")
    .limit(200);
  return (rows as Array<Record<string, unknown>>).map(toStoredRx);
}

/**
 * What the customer was last made, proposed as the prescription they wear
 * today (HU-120: "if they bought before in any store, propose it").
 */
export async function lastPrescription(container: MedusaContainer, customerId: string): Promise<StoredRx | null> {
  const list = (await customerPrescriptions(container, customerId)).filter((r) => r.kind !== "worn");
  return list.length ? list[list.length - 1] : null;
}

export interface HistoryEntry extends StoredRx {
  /** Change against the previous entry of the series (null for the first). */
  change: OpticalChange | null;
}

/** How the customer's prescription changed purchase after purchase (HU-124). */
export async function opticalHistory(container: MedusaContainer, customerId: string, thresholds: Thresholds): Promise<HistoryEntry[]> {
  const list = await customerPrescriptions(container, customerId);
  const out: HistoryEntry[] = [];
  let prev: StoredRx | null = null;
  for (const rx of list) {
    const change = prev
      ? opticalChange(
          { od: prev.od, os: prev.os, rx_date: prev.rx_date ?? prev.created_at },
          { od: rx.od, os: rx.os },
          { now: new Date(rx.rx_date ? `${rx.rx_date}T12:00:00Z` : rx.created_at), thresholds }
        )
      : null;
    out.push({ ...rx, change });
    prev = rx;
  }
  return out;
}

function hasEyes(input: RxInput | null | undefined): input is RxInput {
  return Boolean(input?.rx?.od && input.rx.os);
}

/**
 * Validates the prescriptions before anything is written; throws PosError.
 * The new prescription is checked against each line's lens design and frame
 * (progressive needs a fitting height and enough frame; strong powers and
 * small frames) — "only combinations possible for that frame and prescription".
 */
export function checkPrescriptions(
  container: MedusaContainer,
  input: { new: RxInput | null; worn: RxInput | null },
  required: boolean,
  contexts: Array<{ usage_type?: string; eye_size?: number }> = []
): { warnings: unknown[] } {
  if (input.worn && !hasEyes(input.worn)) throw new PosError("bad_worn_prescription");
  if (!input.new) {
    if (required) throw new PosError("prescription_required");
    return { warnings: [] };
  }
  if (!hasEyes(input.new)) throw new PosError("prescription_required");
  const svc = container.resolve<PrescriptionModuleService>(PRESCRIPTION_MODULE);
  const warnings: unknown[] = [];
  for (const ctx of contexts.length ? contexts : [{}]) {
    const validation = svc.validate({ ...input.new.rx, source: "manual", verified_by_user: true, file_url: null } as never, ctx);
    // Same rule as the web: a prescription the lab cannot cut is never stored.
    if (validation && validation.fulfillable === false) {
      throw new PosError("invalid_prescription", 422, { validation });
    }
    if (validation?.warnings?.length) warnings.push(...validation.warnings);
  }
  return { warnings };
}

async function nextRxNumber(container: MedusaContainer, now = new Date()): Promise<string> {
  const year = now.getUTCFullYear();
  const res = await pgOf(container).raw(
    `INSERT INTO rx_sequence (year, last_value) VALUES (?, 1)
     ON CONFLICT (year) DO UPDATE SET last_value = rx_sequence.last_value + 1
     RETURNING last_value`,
    [year]
  );
  return rxNumber(year, Number((res as { rows: Array<{ last_value: number }> }).rows[0].last_value));
}

async function insertPrescriptions(
  container: MedusaContainer,
  input: { new: RxInput | null; worn: RxInput | null },
  meta: { new: RxMeta | null; worn: RxMeta | null },
  customerId: string
): Promise<{ newId: string | null; wornId: string | null; rxNumber: string | null }> {
  const pg = pgOf(container);
  const row = (r: RxInput, m: RxMeta, kind: "worn" | "new", previous: string | null, number: string | null) => ({
    ...prescriptionColumns(r.rx),
    source: r.rx.source === "ocr" ? "ocr" : "manual",
    verified_by_user: true,
    file_url: typeof r.rx.file_url === "string" && /^rx\/[A-Za-z0-9._-]{1,200}$/.test(r.rx.file_url) ? r.rx.file_url : null,
    customer_id: customerId,
    kind,
    rx_date: m.rx_date,
    rx_date_approx: m.rx_date_approx,
    worn_source: kind === "worn" ? m.worn_source : null,
    previous_prescription_id: previous,
    rx_number: number,
  });
  let wornId: string | null = null;
  if (input.worn && meta.worn) {
    const [w] = await pg("prescription").insert(row(input.worn, meta.worn, "worn", null, null)).returning("id");
    wornId = (w as { id: string }).id;
  }
  if (!input.new || !meta.new) return { newId: null, wornId, rxNumber: null };
  const number = await nextRxNumber(container);
  const [nw] = await pg("prescription").insert(row(input.new, meta.new, "new", wornId, number)).returning("id");
  return { newId: (nw as { id: string }).id, wornId, rxNumber: number };
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
  variants: Array<{ id: string; title: string; sku: string | null; barcode: string | null }>;
}

/** Products the owner priced as cases (rules with scope "case"); everything else is a frame. */
function caseProductIds(rules: Array<{ scope: string; target: string | null }>): Set<string> {
  return new Set(rules.filter((r) => r.scope === "case" && r.target).map((r) => r.target as string));
}

/**
 * Catalog search by name, SKU or scanned barcode (HU-20), with each model's
 * price in the store (HU-17: shown, never editable).
 */
export async function searchPosProducts(container: MedusaContainer, establishmentId: string, q: string): Promise<PosProduct[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return [];
  const fields = ["id", "title", "thumbnail", "variants.id", "variants.title", "variants.sku", "variants.barcode"];
  // An exact SKU or barcode (what a scanner sends) first; then the name.
  const { data: byCode } = await query.graph({
    entity: "variant",
    fields: ["product_id"],
    filters: { $or: [{ sku: term }, { barcode: term }, { ean: term }, { upc: term }] } as never,
    pagination: { take: 5 },
  });
  const codeIds = [...new Set((byCode as Array<{ product_id?: string }>).map((v) => v.product_id).filter(Boolean) as string[])];
  const [{ data: exact }, { data: named }] = await Promise.all([
    codeIds.length
      ? query.graph({ entity: "product", fields, filters: { id: codeIds } })
      : Promise.resolve({ data: [] as unknown[] }),
    query.graph({
      entity: "product",
      fields,
      filters: { title: { $ilike: `%${term}%` }, status: "published" } as never,
      pagination: { take: 20 },
    }),
  ]);
  const seen = new Set<string>();
  const products = ([...exact, ...named] as Array<{ id: string; title: string; thumbnail?: string | null; variants?: Array<{ id: string; title?: string; sku?: string | null; barcode?: string | null }> }>)
    .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
    .slice(0, 20);
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
      variants: (p.variants ?? []).map((v) => ({ id: v.id, title: v.title ?? "", sku: v.sku ?? null, barcode: v.barcode ?? null })),
    };
  });
}

export interface QuotedLine {
  kind: PosLine["kind"];
  variant_id: string | null;
  product_id: string | null;
  title: string;
  variant_title: string | null;
  sku: string | null;
  selection: PosLine["selection"];
  description: string | null;
  /** Lens design category (sv | bifocal | prog), null for a bare frame. */
  lens_category: string | null;
  /** Frame size from the catalog, for the prescription check and the lab ticket. */
  eye_size: number | null;
  /** Store list price of the line, before discount and tax. */
  list: number;
  frame: number;
  lenses: number;
  /** Sales tax baked into unit_price: only a frame sold without lenses (as on the web). */
  tax_amount: number;
  tax_rate: number;
  unit_price: number;
  frame_source: "store_exact" | "adjusted" | "own_frame";
  below_minimum: boolean;
}

export interface Quote {
  lines: QuotedLine[];
  discount_pct: number;
  /** Before discount and tax. */
  list_cents: number;
  discount_cents: number;
  tax_cents: number;
  total: number;
  total_cents: number;
  /** Some line goes under its minimum price after the discount. */
  below_minimum: boolean;
}

export async function quoteSale(
  container: MedusaContainer,
  establishmentId: string,
  lines: PosLine[],
  discountPct = 0
): Promise<Quote> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const pg = pgOf(container);

  const variantIds = [...new Set(lines.map((l) => l.variant_id).filter((v): v is string => Boolean(v)))];
  const { data: variants } = variantIds.length
    ? await query.graph({
        entity: "variant",
        fields: ["id", "title", "sku", "product.id", "product.title"],
        filters: { id: variantIds },
      })
    : { data: [] as unknown[] };
  const variantById = new Map(
    (variants as Array<{ id: string; title?: string; sku?: string | null; product?: { id: string; title?: string } }>).map((v) => [v.id, v])
  );
  const productIds = [...new Set([...variantById.values()].map((v) => v.product?.id).filter((v): v is string => Boolean(v)))];
  const [rules, prices, settings, metadata] = await Promise.all([
    openRules(container, [establishmentId]),
    productPrices(container, productIds),
    resolveStoreSettings(container),
    loadProductMetadata(pg, productIds),
  ]);
  const priceById = new Map(prices.map((p) => [p.product_id, p.price]));
  const caseIds = caseProductIds(rules);

  const quoted: QuotedLine[] = [];
  for (const line of lines) {
    let lensCents: number;
    let category: string | null;
    try {
      const b = await computeLensBreakdown(pg, line.selection);
      lensCents = b.total_cents;
      category = b.category;
    } catch {
      throw new PosError("bad_lens");
    }

    let listFrame: number;
    let listLenses: number;
    let frameSource: QuotedLine["frame_source"];
    let min = { frame_min: null as number | null, floor_pct: null as number | null };
    const variant = line.variant_id ? variantById.get(line.variant_id) : undefined;
    const productId = variant?.product?.id ?? null;

    if (line.kind === "own_frame") {
      // No frame is sold: the store's adjustment applies to the lenses alone
      // (a fixed amount lands on the frame part when the base is 0, so move it).
      const sp = storeLinePrice(rules, { establishmentId, scope: "frame", target: "", base: 0, lenses: lensCents / 100 });
      listFrame = 0;
      listLenses = dollars(cents(sp.frame) + cents(sp.lenses));
      frameSource = "own_frame";
      min = lineMinimum(rules, { establishmentId, scope: "frame", target: "" });
    } else {
      if (!variant || !productId) throw new PosError("bad_variant");
      const base = priceById.get(productId);
      if (base == null) throw new PosError("no_price");
      const scope = caseIds.has(productId) ? "case" : "frame";
      const sp = storeLinePrice(rules, { establishmentId, scope, target: productId, base, lenses: lensCents / 100 });
      listFrame = sp.frame;
      listLenses = sp.lenses;
      frameSource = sp.frame_source;
      min = lineMinimum(rules, { establishmentId, scope, target: productId });
    }

    const list = dollars(cents(listFrame) + cents(listLenses));
    const d = discountLine({ frame: listFrame, lenses: listLenses }, discountPct);
    // Sales tax only on a frame sold without lenses: prescription lenses are a
    // medical product (same rule as the web's configured-line route).
    let tax_rate = 0;
    let tax_amount = 0;
    if (line.kind === "frame" && line.selection.design_code === "frame-only" && settings.frame_tax_rate > 0) {
      tax_rate = settings.frame_tax_rate;
      tax_amount = dollars(cents(d.total * tax_rate));
    }
    const md = productId ? metadata.get(productId) ?? {} : {};
    const eye = Number(md["eye_size"]);
    quoted.push({
      kind: line.kind,
      variant_id: variant?.id ?? null,
      product_id: productId,
      title: line.kind === "own_frame" ? line.description || "" : variant?.product?.title ?? "",
      variant_title: variant?.title ?? null,
      sku: variant?.sku ?? null,
      selection: line.selection,
      description: line.description,
      lens_category: line.selection.design_code === "frame-only" ? null : category,
      eye_size: Number.isFinite(eye) && eye > 0 ? eye : null,
      list,
      frame: d.frame,
      lenses: d.lenses,
      tax_amount,
      tax_rate,
      unit_price: dollars(cents(d.total) + cents(tax_amount)),
      frame_source: frameSource,
      below_minimum: discountPct > 0 && belowMinimum(min, { list, frame: d.frame, total: d.total }),
    });
  }

  const list_cents = quoted.reduce((s, l) => s + cents(l.list), 0);
  const tax_cents = quoted.reduce((s, l) => s + cents(l.tax_amount), 0);
  const total_cents = quoted.reduce((s, l) => s + cents(l.unit_price), 0);
  return {
    lines: quoted,
    discount_pct: discountPct,
    list_cents,
    discount_cents: list_cents - (total_cents - tax_cents),
    tax_cents,
    total: dollars(total_cents),
    total_cents,
    below_minimum: quoted.some((l) => l.below_minimum),
  };
}

/** Prescription checks for each line with lenses: lens design and frame size. */
export function rxContexts(quote: Quote): Array<{ usage_type?: string; eye_size?: number }> {
  return quote.lines
    .filter((l) => l.lens_category)
    .map((l) => ({
      ...(l.lens_category === "prog" ? { usage_type: "progressive" } : {}),
      ...(l.eye_size ? { eye_size: l.eye_size } : {}),
    }));
}

// ---------------------------------------------------------------------------
// Discount approvals (HU-16, HU-26)
// ---------------------------------------------------------------------------

export interface ApprovalRow {
  id: string;
  establishment_id: string;
  terminal_id: string | null;
  requested_by: string;
  discount_pct: number;
  limit_pct: number | null;
  below_minimum: boolean;
  list: number;
  total: number;
  lines: Array<{ title: string; list: number }>;
  reason: string | null;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  expires_at: string;
  sale_id: string | null;
  created_at: string;
}

const toApproval = (r: Record<string, unknown>): ApprovalRow => ({
  id: String(r.id),
  establishment_id: String(r.establishment_id),
  terminal_id: (r.terminal_id as string | null) ?? null,
  requested_by: String(r.requested_by),
  discount_pct: Number(r.discount_pct),
  limit_pct: r.limit_pct == null ? null : Number(r.limit_pct),
  below_minimum: Boolean(r.below_minimum),
  list: dollars(Number(r.list_cents)),
  total: dollars(Number(r.total_cents)),
  lines: Array.isArray(r.lines) ? (r.lines as ApprovalRow["lines"]) : [],
  reason: (r.reason as string | null) ?? null,
  status: new Date(r.expires_at as string) < new Date() && (r.status === "pending" || r.status === "approved") ? "expired" : String(r.status),
  decided_by: (r.decided_by as string | null) ?? null,
  decided_at: r.decided_at ? new Date(r.decided_at as string).toISOString() : null,
  decision_note: (r.decision_note as string | null) ?? null,
  expires_at: new Date(r.expires_at as string).toISOString(),
  sale_id: (r.sale_id as string | null) ?? null,
  created_at: new Date(r.created_at as string).toISOString(),
});

export async function getApproval(container: MedusaContainer, id: string): Promise<ApprovalRow | null> {
  const [row] = await pos(container).listDiscountApprovals({ id }, { take: 1 });
  return row ? toApproval(row as unknown as Record<string, unknown>) : null;
}

export async function listApprovals(
  container: MedusaContainer,
  filters: { status?: string; establishmentIds?: string[] | null; requestedBy?: string },
  take = 100
): Promise<ApprovalRow[]> {
  const where: Record<string, unknown> = {};
  if (filters.status === "pending") where.status = "pending";
  else if (filters.status) where.status = filters.status;
  if (filters.establishmentIds) where.establishment_id = filters.establishmentIds;
  if (filters.requestedBy) where.requested_by = filters.requestedBy;
  const rows = await pos(container).listDiscountApprovals(where as never, { take, order: { created_at: "DESC" } });
  return rows.map((r) => toApproval(r as unknown as Record<string, unknown>));
}

export async function createApproval(
  container: MedusaContainer,
  input: { store: EstablishmentRow; terminalId: string | null; requestedBy: string; quote: Quote; limitPct: number | null; reason: string | null }
): Promise<ApprovalRow> {
  const created = await pos(container).createDiscountApprovals({
    establishment_id: input.store.id,
    terminal_id: input.terminalId,
    requested_by: input.requestedBy,
    discount_pct: input.quote.discount_pct,
    limit_pct: input.limitPct,
    below_minimum: input.quote.below_minimum,
    list_cents: input.quote.list_cents,
    total_cents: input.quote.total_cents,
    lines: input.quote.lines.map((l) => ({ title: l.title, list: l.list })) as unknown as Record<string, unknown>,
    reason: input.reason,
    expires_at: new Date(Date.now() + APPROVAL_TTL_HOURS * 3600 * 1000),
  });
  await recordAudit(container, {
    actorId: input.requestedBy,
    action: "discount.request",
    entity: "discount_approval",
    entityId: created.id,
    establishmentId: input.store.id,
    after: { pct: input.quote.discount_pct, limit_pct: input.limitPct, below_minimum: input.quote.below_minimum, list_cents: input.quote.list_cents, total_cents: input.quote.total_cents },
  });
  return toApproval(created as unknown as Record<string, unknown>);
}

/** Owner or superadmin decision; only a pending, unexpired request can be decided. */
export async function decideApproval(
  container: MedusaContainer,
  id: string,
  decision: "approved" | "rejected",
  actorId: string,
  note: string | null
): Promise<ApprovalRow> {
  const current = await getApproval(container, id);
  if (!current) throw new PosError("approval_not_found", 404);
  if (current.status !== "pending") throw new PosError(`approval_${current.status}`, 409);
  await pos(container).updateDiscountApprovals({ id, status: decision, decided_by: actorId, decided_at: new Date(), decision_note: note } as never);
  await recordAudit(container, {
    actorId,
    action: decision === "approved" ? "discount.approve" : "discount.reject",
    entity: "discount_approval",
    entityId: id,
    establishmentId: current.establishment_id,
    before: { status: "pending" },
    after: { status: decision, pct: current.discount_pct, note },
  });
  return (await getApproval(container, id)) as ApprovalRow;
}

/**
 * The approval a sale carries must be approved, unexpired, unused, for this
 * store and for exactly this quote (same list total and percentage).
 */
function assertApprovalFits(a: ApprovalRow | null, store: EstablishmentRow, quote: Quote): asserts a is ApprovalRow {
  if (!a) throw new PosError("approval_required", 409);
  if (a.status !== "approved") throw new PosError(`approval_${a.status}`, 409);
  if (a.establishment_id !== store.id) throw new PosError("approval_mismatch", 409);
  if (cents(a.list) !== quote.list_cents || a.discount_pct !== quote.discount_pct) throw new PosError("approval_mismatch", 409);
}

// ---------------------------------------------------------------------------
// Sale
// ---------------------------------------------------------------------------

export interface CreateSaleInput {
  store: EstablishmentRow;
  terminal: TerminalRow;
  sellerId: string | null;
  sellerCode: string | null;
  customer: PosCustomer;
  customerId: string | null;
  lines: PosLine[];
  quote: Quote;
  payments: CleanedPayments;
  /** Required when the discount needs approval (route decides). */
  approvalId: string | null;
  needsApproval: boolean;
  prescriptions: { new: RxInput | null; worn: RxInput | null };
  rxMeta: { new: RxMeta | null; worn: RxMeta | null };
  thresholds: Thresholds;
  delivery: "pickup" | "ship";
  notifyEmail: boolean;
  idempotencyKey: string | null;
}

export interface CreatedSale {
  id: string;
  number: string;
  order_id: string;
  display_id: number | null;
  total: number;
  paid: number;
  insurance: number;
  balance: number;
  tray: string | null;
  rx_number: string | null;
  promised_on: string | null;
  /** "Daño óptico" for the screen only — never on receipts, emails or Sheets. */
  optical_change: OpticalChange | null;
  /** True when this response is a replay of an earlier identical request. */
  replayed?: boolean;
}

/** Sales currently being recorded, by idempotency key (one process; the unique index covers the rest). */
const inFlight = new Map<string, Promise<CreatedSale>>();

async function usdRegionId(container: MedusaContainer): Promise<string> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({ entity: "region", fields: ["id", "currency_code"] });
  const region = (data as Array<{ id: string; currency_code: string }>).find((r) => r.currency_code === "usd");
  if (!region) throw new PosError("no_region", 503);
  return region.id;
}

/** Next number of a store's sequence; atomic, so two tills never get the same one. */
async function nextSaleSeq(container: MedusaContainer, establishmentId: string): Promise<number> {
  const res = await pgOf(container).raw(
    `INSERT INTO pos_sale_counter (establishment_id, last_seq) VALUES (?, 1)
     ON CONFLICT (establishment_id) DO UPDATE SET last_seq = pos_sale_counter.last_seq + 1
     RETURNING last_seq`,
    [establishmentId]
  );
  return Number((res as { rows: Array<{ last_seq: number }> }).rows[0].last_seq);
}

async function replayOf(container: MedusaContainer, key: string): Promise<CreatedSale | null> {
  const [s] = await pos(container).listPosSales({ idempotency_key: key } as never, { take: 1 });
  if (!s) return null;
  const sale = s as unknown as Record<string, unknown>;
  return {
    id: String(sale.id),
    number: String(sale.number),
    order_id: String(sale.order_id),
    display_id: null,
    total: dollars(Number(sale.total_cents)),
    paid: dollars(Number(sale.paid_cents)),
    insurance: dollars(Number(sale.insurance_cents)),
    balance: dollars(Number(sale.balance_cents)),
    tray: sale.tray_number == null ? null : `${String(sale.number).split("-")[0]}-${sale.tray_number}`,
    rx_number: null,
    promised_on: (sale.promised_on as string | null) ?? null,
    optical_change: null,
    replayed: true,
  };
}

export async function createPosSale(container: MedusaContainer, input: CreateSaleInput): Promise<CreatedSale> {
  const key = input.idempotencyKey;
  if (key) {
    const done = await replayOf(container, key);
    if (done) return done;
    const running = inFlight.get(key);
    if (running) return { ...(await running), replayed: true };
  }
  const work = recordSale(container, input);
  if (key) inFlight.set(key, work);
  try {
    return await work;
  } finally {
    if (key) inFlight.delete(key);
  }
}

async function recordSale(container: MedusaContainer, input: CreateSaleInput): Promise<CreatedSale> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { store, customer, quote } = input;
  if (!store.sales_channel_id) throw new PosError("store_without_channel", 409);

  let approval: ApprovalRow | null = null;
  if (input.needsApproval) {
    approval = input.approvalId ? await getApproval(container, input.approvalId) : null;
    assertApprovalFits(approval, store, quote);
  }

  const regionId = await usdRegionId(container);
  const customerId = await upsertCustomer(container, customer, input.customerId);
  const rx = await insertPrescriptions(container, input.prescriptions, input.rxMeta, customerId);

  // Photos of frames the customer brought go to the private bucket: they travel
  // with the lab ticket to the main store (HU-89).
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
        source: "pos",
        channel: "pos",
        establishment_id: store.id,
        establishment_code: store.code,
        terminal_id: input.terminal.id,
        terminal_code: input.terminal.code,
        seller_id: input.sellerId,
        // NOT seller_code: on an order that key is the referral seller of the
        // Sellers module, who earns a commission (costing.ts). The till's
        // seller is a member of the staff.
        staff_code: input.sellerCode,
        notify_email: input.notifyEmail,
        notify_sms: false,
        patient_phone: customer.phone,
        delivery: input.delivery,
      },
      items: quote.lines.map((l, i) => {
        const withRx = l.selection.design_code !== "frame-only";
        const metadata = {
          kind: l.kind === "own_frame" ? "own-frame" : "configured-frame",
          channel: "pos",
          lens_config: l.selection,
          // By id only: the Rx values (PHI) live in the prescription record.
          prescription_id: withRx ? rx.newId : null,
          list_price: l.list,
          discount_pct: quote.discount_pct,
          approved_by: approval?.decided_by ?? null,
          frame_price: l.frame,
          lens_addon: l.lenses,
          tax_amount: l.tax_amount,
          tax_rate: l.tax_rate,
          price_pretax: dollars(cents(l.frame) + cents(l.lenses)),
          frame_source: l.frame_source,
          frame_handling: l.kind === "own_frame" ? "patient_own_frame" : withRx ? "frame_supplied" : null,
          own_frame: l.kind === "own_frame" ? { description: l.description, photo_key: photoKeys[i] } : null,
        };
        // Nothing is shipped from the till: without this Medusa would ask for
        // a shipping method before completing the cart.
        return l.variant_id
          ? { variant_id: l.variant_id, quantity: 1, unit_price: l.unit_price, requires_shipping: false, metadata }
          : { title: l.description || "Patient's own frame", quantity: 1, unit_price: l.unit_price, requires_shipping: false, metadata };
      }),
    } as never,
  });
  const cartId = (cart as { id: string }).id;

  // Defensive: the cart must total what was quoted, or something priced it
  // differently (a tax provider, a promotion) and the ledger would not match.
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
  // leaves a hole in the store's sequence (HU-84).
  const seq = await nextSaleSeq(container, store.id);
  const number = saleNumber(store.code, seq);
  const withLenses = quote.lines.some((l) => l.lens_category);
  const promisedOn = (withLenses ? addBusinessDays(new Date(), LAB_BUSINESS_DAYS) : new Date()).toISOString().slice(0, 10);
  const svc = pos(container);
  const p = input.payments;
  const sale = await svc.createPosSales({
    number,
    establishment_id: store.id,
    seq,
    seller_id: input.sellerId,
    seller_code: input.sellerCode,
    terminal_id: input.terminal.id,
    order_id: orderId,
    cart_id: cartId,
    customer_id: customerId,
    idempotency_key: input.idempotencyKey,
    list_cents: quote.list_cents,
    discount_cents: quote.discount_cents,
    discount_pct: quote.discount_pct,
    discount_approval_id: approval?.id ?? null,
    total_cents: quote.total_cents,
    paid_cents: p.paid_cents,
    insurance_cents: p.insurance_cents,
    balance_cents: p.balance_cents,
    promised_on: promisedOn,
    delivery: input.delivery,
    currency_code: "usd",
    own_frame_photo_keys: photoKeys.filter(Boolean) as unknown as Record<string, unknown>,
  });
  const tray = withLenses ? await takeTray(container, store.id, sale.id) : null;
  if (tray !== null) await svc.updatePosSales({ id: sale.id, tray_number: tray });
  await writePayments(container, { saleId: sale.id, orderId, establishmentId: store.id, terminalId: input.terminal.id, actorId: input.sellerId, kind: "deposit", payments: p.payments });
  if (approval) await svc.updateDiscountApprovals({ id: approval.id, status: "used", sale_id: sale.id } as never);

  // The order board, the Sheet and the emails show the store's number and the
  // balance. Best-effort: the sale row already links both ways.
  let displayId: number | null = null;
  try {
    displayId = await stampOrder(container, orderId, {
      pos_sale_number: number,
      pos_sale_id: sale.id,
      tray: tray === null ? null : `${store.code}-${tray}`,
      balance_due_cents: p.balance_cents,
      paid_cents: p.paid_cents + p.insurance_cents,
      promised_on: promisedOn,
    });
  } catch (e) {
    logger.warn(`[pos] sale ${number}: could not stamp the order ${orderId}: ${(e as Error).message}`);
  }

  // Dashboards (sale_fact), after the order carries the sale's id.
  await projectOrder(container, orderId);

  logger.info(`[pos] sale ${number} (order ${orderId}) by ${input.sellerCode ?? input.sellerId ?? "?"} at ${input.terminal.code}: ${quote.total_cents} cents, paid ${p.paid_cents}, balance ${p.balance_cents}`);

  const pn = input.prescriptions;
  const change =
    pn.worn && pn.new
      ? opticalChange(
          { od: pn.worn.rx.od, os: pn.worn.rx.os, rx_date: input.rxMeta.worn?.rx_date ?? null },
          { od: pn.new.rx.od, os: pn.new.rx.os },
          { thresholds: input.thresholds }
        )
      : null;

  return {
    id: sale.id,
    number,
    order_id: orderId,
    display_id: displayId,
    total: quote.total,
    paid: dollars(p.paid_cents),
    insurance: dollars(p.insurance_cents),
    balance: dollars(p.balance_cents),
    tray: tray === null ? null : `${store.code}-${tray}`,
    rx_number: rx.rxNumber,
    promised_on: promisedOn,
    optical_change: change,
  };
}

async function stampOrder(container: MedusaContainer, orderId: string, patch: Record<string, unknown>): Promise<number | null> {
  const orders = container.resolve<IOrderModuleService>(Modules.ORDER);
  const order = await orders.retrieveOrder(orderId, { select: ["id", "display_id", "metadata"] });
  await orders.updateOrders(orderId, { metadata: { ...(order.metadata ?? {}), ...patch } });
  return Number(order.display_id) || null;
}

/** The till's open cash register, if any: cash payments and refunds go into it (HU-32). */
async function openCashSession(container: MedusaContainer, terminalId: string | null): Promise<string | null> {
  if (!terminalId) return null;
  const [s] = await pos(container).listCashSessions({ terminal_id: terminalId, closed_at: null } as never, { take: 1 });
  return s?.id ?? null;
}

/** Writes payments to the ledger; an insurer's part also opens its claim (HU-113). */
async function writePayments(
  container: MedusaContainer,
  args: { saleId: string; orderId: string | null; establishmentId: string; terminalId: string | null; actorId: string | null; kind: "deposit" | "balance"; payments: PosPayment[] }
): Promise<void> {
  const svc = pos(container);
  if (!args.payments.length) return;
  const cashSession = args.payments.some((p) => p.counts_as_cash) ? await openCashSession(container, args.terminalId) : null;
  await svc.createPosSalePayments(
    args.payments.map((p) => ({
      sale_id: args.saleId,
      method_code: p.method_code,
      amount_cents: p.amount_cents,
      reference: p.reference,
      kind: args.kind,
      establishment_id: args.establishmentId,
      received_by: args.actorId,
      fee_cents: p.fee_cents,
      counts_as_cash: p.counts_as_cash,
      details: p.details as unknown as Record<string, unknown>,
      cash_session_id: p.counts_as_cash ? cashSession : null,
    }))
  );
  for (const p of args.payments.filter((x) => x.insurance)) {
    await svc.createInsuranceClaims({
      sale_id: args.saleId,
      order_id: args.orderId,
      establishment_id: args.establishmentId,
      payer_name: String(p.details.payer ?? p.method_code),
      member_id: p.details.member_id == null ? null : String(p.details.member_id),
      authorization_no: p.details.authorization_no == null ? null : String(p.details.authorization_no),
      covered_cents: p.amount_cents,
      created_by: args.actorId,
      updated_by: args.actorId,
    });
  }
}

// ---------------------------------------------------------------------------
// After the sale: balance, delivery, void (HU-28, HU-29)
// ---------------------------------------------------------------------------

export interface SaleRow {
  id: string;
  number: string;
  establishment_id: string;
  terminal_id: string | null;
  seller_id: string | null;
  seller_code: string | null;
  customer_id: string | null;
  order_id: string | null;
  list: number;
  discount: number;
  discount_pct: number;
  total: number;
  paid: number;
  insurance: number;
  balance: number;
  status: string;
  tray: string | null;
  promised_on: string | null;
  delivery: string;
  delivered_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  void_requested_at: string | null;
  created_at: string;
  payments: Array<{ method_code: string; amount: number; kind: string; reference: string | null; created_at: string }>;
}

function toSale(s: Record<string, unknown>, payments: Array<Record<string, unknown>>): SaleRow {
  const code = String(s.number).split("-")[0];
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    id: String(s.id),
    number: String(s.number),
    establishment_id: String(s.establishment_id),
    terminal_id: (s.terminal_id as string | null) ?? null,
    seller_id: (s.seller_id as string | null) ?? null,
    seller_code: (s.seller_code as string | null) ?? null,
    customer_id: (s.customer_id as string | null) ?? null,
    order_id: (s.order_id as string | null) ?? null,
    list: dollars(Number(s.list_cents ?? s.total_cents)),
    discount: dollars(Number(s.discount_cents ?? 0)),
    discount_pct: Number(s.discount_pct ?? 0),
    total: dollars(Number(s.total_cents)),
    paid: dollars(Number(s.paid_cents ?? 0)),
    insurance: dollars(Number(s.insurance_cents ?? 0)),
    balance: dollars(Number(s.balance_cents ?? 0)),
    status: String(s.status),
    tray: s.tray_number == null ? null : `${code}-${s.tray_number}`,
    promised_on: (s.promised_on as string | null) ?? null,
    delivery: String(s.delivery ?? "pickup"),
    delivered_at: iso(s.delivered_at),
    voided_at: iso(s.voided_at),
    void_reason: (s.void_reason as string | null) ?? null,
    void_requested_at: iso(s.void_requested_at),
    created_at: new Date(s.created_at as string).toISOString(),
    payments: payments
      .filter((p) => p.sale_id === s.id)
      .map((p) => ({
        method_code: String(p.method_code),
        amount: dollars(Number(p.amount_cents)),
        kind: String(p.kind ?? "deposit"),
        reference: (p.reference as string | null) ?? null,
        created_at: new Date(p.created_at as string).toISOString(),
      })),
  };
}

export interface SalesFilter {
  establishmentIds: string[] | null;
  sellerId?: string;
  terminalId?: string;
  customerId?: string;
  number?: string;
  withBalance?: boolean;
  status?: string;
  from?: string;
  to?: string;
}

/** Sales, newest first, within the caller's scope (the route sets it). */
export async function listSales(container: MedusaContainer, f: SalesFilter, take = 50): Promise<SaleRow[]> {
  const svc = pos(container);
  const where: Record<string, unknown> = {};
  if (f.establishmentIds !== null) where.establishment_id = f.establishmentIds;
  if (f.sellerId) where.seller_id = f.sellerId;
  if (f.terminalId) where.terminal_id = f.terminalId;
  if (f.customerId) where.customer_id = f.customerId;
  if (f.number) where.number = f.number;
  if (f.status) where.status = f.status;
  if (f.withBalance) where.balance_cents = { $gt: 0 };
  if (f.from || f.to) where.created_at = { ...(f.from ? { $gte: new Date(f.from) } : {}), ...(f.to ? { $lte: new Date(f.to) } : {}) };
  const sales = await svc.listPosSales(where as never, { take, order: { created_at: "DESC" } });
  const payments = sales.length ? await svc.listPosSalePayments({ sale_id: sales.map((s) => s.id) }, { take: sales.length * 12 }) : [];
  return sales.map((s) => toSale(s as unknown as Record<string, unknown>, payments as unknown as Array<Record<string, unknown>>));
}

export async function getSale(container: MedusaContainer, id: string): Promise<SaleRow | null> {
  const svc = pos(container);
  const [s] = await svc.listPosSales({ id }, { take: 1 });
  if (!s) return null;
  const payments = await svc.listPosSalePayments({ sale_id: id }, { take: 100, order: { created_at: "ASC" } });
  return toSale(s as unknown as Record<string, unknown>, payments as unknown as Array<Record<string, unknown>>);
}

/** Collects (part of) the balance — usually when the glasses are picked up (HU-29). */
export async function collectPayment(
  container: MedusaContainer,
  sale: SaleRow,
  payments: CleanedPayments,
  actorId: string | null
): Promise<SaleRow> {
  if (sale.status === "voided") throw new PosError("sale_voided", 409);
  if (sale.balance <= 0) throw new PosError("nothing_due", 409);
  const paid = cents(sale.paid) + payments.paid_cents;
  const insurance = cents(sale.insurance) + payments.insurance_cents;
  const balance = cents(sale.total) - paid - insurance;
  await writePayments(container, { saleId: sale.id, orderId: sale.order_id, establishmentId: sale.establishment_id, terminalId: sale.terminal_id, actorId, kind: "balance", payments: payments.payments });
  await pos(container).updatePosSales({ id: sale.id, paid_cents: paid, insurance_cents: insurance, balance_cents: balance });
  if (sale.order_id) await stampOrder(container, sale.order_id, { balance_due_cents: balance, paid_cents: paid + insurance }).catch(() => null);
  await recordAudit(container, {
    actorId,
    action: "payment.collect",
    entity: "pos_sale",
    entityId: sale.id,
    establishmentId: sale.establishment_id,
    before: { balance_cents: cents(sale.balance) },
    after: { balance_cents: balance, collected_cents: payments.paid_cents + payments.insurance_cents },
  });
  return (await getSale(container, sale.id)) as SaleRow;
}

/** Hands the glasses over: releases the tray (HU-29). The lab stage is moved on the order board. */
export async function markDelivered(container: MedusaContainer, sale: SaleRow): Promise<SaleRow> {
  if (sale.status === "voided") throw new PosError("sale_voided", 409);
  if (sale.balance > 0) throw new PosError("balance_due", 409, { balance: sale.balance });
  await pos(container).updatePosSales({ id: sale.id, delivered_at: new Date() });
  await releaseTray(container, sale.id);
  return (await getSale(container, sale.id)) as SaleRow;
}

export const VOID_REASONS = ["customer_changed_mind", "wrong_entry", "price_error", "duplicate", "lab_cannot_make", "other"] as const;
export type VoidReason = (typeof VOID_REASONS)[number];

/** A seller asks; a manager of the store (or someone with sale.void) decides (HU-28). */
export async function requestVoid(container: MedusaContainer, sale: SaleRow, actorId: string, reason: VoidReason, note: string | null): Promise<SaleRow> {
  if (sale.status === "voided") throw new PosError("sale_voided", 409);
  await pos(container).updatePosSales({ id: sale.id, void_requested_by: actorId, void_requested_at: new Date(), void_reason: reason, void_note: note });
  await recordAudit(container, {
    actorId,
    action: "sale.void_request",
    entity: "pos_sale",
    entityId: sale.id,
    establishmentId: sale.establishment_id,
    after: { reason, note },
  });
  return (await getSale(container, sale.id)) as SaleRow;
}

/**
 * Voids a sale: the sale is never deleted and keeps its number (HU-84); it is
 * marked voided with who, when and why. The Medusa order is canceled when no
 * fulfillment has shipped; what the customer paid is recorded as refunds in
 * the ledger, so the cash count and the reports stay true.
 */
export async function voidSale(
  container: MedusaContainer,
  sale: SaleRow,
  actorId: string,
  reason: VoidReason,
  note: string | null
): Promise<{ sale: SaleRow; order_canceled: boolean }> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  if (sale.status === "voided") throw new PosError("sale_voided", 409);
  const svc = pos(container);
  let orderCanceled = false;
  if (sale.order_id) {
    try {
      const { cancelOrderWorkflow } = await import("@medusajs/medusa/core-flows");
      await cancelOrderWorkflow(container).run({ input: { order_id: sale.order_id, canceled_by: actorId } as never });
      orderCanceled = true;
    } catch (e) {
      // Already shipped or fulfilled: the void stands in our records and the
      // owner handles the order by hand from the order board.
      logger.warn(`[pos] void ${sale.number}: order ${sale.order_id} not canceled: ${(e as Error).message}`);
    }
  }
  // Net paid per method (refunds are negative rows), returned by the same method.
  const byMethod = new Map<string, number>();
  for (const p of sale.payments) byMethod.set(p.method_code, (byMethod.get(p.method_code) ?? 0) + cents(p.amount));
  const methods = new Map((await listPaymentMethods(container)).map((m) => [m.code, m]));
  const cashSession = await openCashSession(container, sale.terminal_id);
  const ledger = [...byMethod.entries()]
    .filter(([code, amount]) => amount > 0 && !(methods.get(code)?.kind === "insurance" || methods.get(code)?.receivable))
    .map(([code, amount]) => ({
      sale_id: sale.id,
      method_code: code,
      amount_cents: -amount,
      kind: "refund" as const,
      establishment_id: sale.establishment_id,
      received_by: actorId,
      counts_as_cash: Boolean(methods.get(code)?.counts_as_cash),
      cash_session_id: methods.get(code)?.counts_as_cash ? cashSession : null,
      reference: null,
    }));
  if (ledger.length) await svc.createPosSalePayments(ledger);
  // The insurer's open claims of a voided sale are rejected: nothing to collect.
  const claims = await svc.listInsuranceClaims({ sale_id: sale.id, status: ["pending", "submitted"] } as never, { take: 20 });
  if (claims.length) await svc.updateInsuranceClaims(claims.map((c) => ({ id: c.id, status: "rejected", note: "sale voided" })) as never);

  await svc.updatePosSales({
    id: sale.id,
    status: "voided",
    voided_at: new Date(),
    voided_by: actorId,
    void_reason: reason,
    void_note: note,
    paid_cents: 0,
    insurance_cents: 0,
    balance_cents: 0,
  });
  await releaseTray(container, sale.id);
  await voidFacts(container, sale.id);
  if (sale.order_id) await stampOrder(container, sale.order_id, { pos_voided: true, balance_due_cents: 0 }).catch(() => null);
  await recordAudit(container, {
    actorId,
    action: "sale.void",
    entity: "pos_sale",
    entityId: sale.id,
    establishmentId: sale.establishment_id,
    before: { status: sale.status, total: sale.total, paid: sale.paid },
    after: { status: "voided", reason, note, order_canceled: orderCanceled },
  });
  return { sale: (await getSale(container, sale.id)) as SaleRow, order_canceled: orderCanceled };
}

// ---------------------------------------------------------------------------
// Insurers (HU-114)
// ---------------------------------------------------------------------------

export interface ClaimRow {
  id: string;
  sale_id: string;
  establishment_id: string;
  payer_name: string;
  member_id: string | null;
  authorization_no: string | null;
  covered: number;
  status: string;
  paid: number | null;
  paid_at: string | null;
  created_at: string;
}

export async function listClaims(container: MedusaContainer, f: { establishmentIds: string[] | null; status?: string }): Promise<ClaimRow[]> {
  const where: Record<string, unknown> = {};
  if (f.establishmentIds !== null) where.establishment_id = f.establishmentIds;
  if (f.status) where.status = f.status;
  const rows = await pos(container).listInsuranceClaims(where as never, { take: 500, order: { created_at: "DESC" } });
  return rows.map((r) => ({
    id: r.id,
    sale_id: r.sale_id,
    establishment_id: r.establishment_id,
    payer_name: r.payer_name,
    member_id: r.member_id ?? null,
    authorization_no: r.authorization_no ?? null,
    covered: dollars(Number(r.covered_cents)),
    status: String(r.status),
    paid: r.paid_cents == null ? null : dollars(Number(r.paid_cents)),
    paid_at: r.paid_at ? new Date(r.paid_at as unknown as string).toISOString() : null,
    created_at: new Date(r.created_at as unknown as string).toISOString(),
  }));
}

export async function setClaimStatus(
  container: MedusaContainer,
  id: string,
  status: "submitted" | "paid" | "rejected",
  paidCents: number | null,
  actorId: string
): Promise<void> {
  const svc = pos(container);
  const [claim] = await svc.listInsuranceClaims({ id }, { take: 1 });
  if (!claim) throw new PosError("claim_not_found", 404);
  if (claim.status === "paid" || claim.status === "rejected") throw new PosError("claim_closed", 409);
  await svc.updateInsuranceClaims({
    id,
    status,
    paid_cents: status === "paid" ? paidCents ?? Number(claim.covered_cents) : null,
    paid_at: status === "paid" ? new Date() : null,
    updated_by: actorId,
  } as never);
  await recordAudit(container, {
    actorId,
    action: "insurance.paid",
    entity: "insurance_claim",
    entityId: id,
    establishmentId: claim.establishment_id,
    before: { status: claim.status },
    after: { status, paid_cents: status === "paid" ? paidCents ?? Number(claim.covered_cents) : null },
  });
}

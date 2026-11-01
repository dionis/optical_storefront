import type { Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { localParts } from "./alerts";
import { listEstablishments, type EstablishmentRow } from "./establishments";
import { saleNumber, sellableStores } from "./pos";
import { ownSalesOnly } from "./pos-route";
import type { StaffScope } from "./staff-scope";
import { tenant } from "./tenant";

/**
 * The panel's single search bar: one term, several kinds of answer.
 *
 * The owner types whatever is in front of them — a sale number off a receipt
 * (`Op1-000123`, or just `123`), an order number (`#1024`), a patient's name or
 * the phone as they wrote it down, a seller, a store, or a frame's model or SKU
 * — and gets a short grouped list to pick from. It is an AUTOCOMPLETE: it fires
 * on every keystroke, so the whole request has to come back in milliseconds.
 *
 * Two rules shape every line of this file:
 *
 *  1. SCOPE. The same mechanism the rest of the panel uses (lib/pos-route.ts,
 *     lib/analytics-route.ts): a seller finds only THEIR sales and only the
 *     patients of those sales, a supervisor or manager only their stores',
 *     owner and superadmin everything. The filter goes into the SQL, never into
 *     a post-filter in Node — a query that comes back unscoped has already lost
 *     the data. Health and money would otherwise leak between stores.
 *  2. LATENCY. A term under MIN_TERM characters never reaches the database.
 *     Every group is ONE query with a small LIMIT, all of them in parallel, and
 *     the text match is a PREFIX (`foo%`) wherever the column allows it, so a
 *     btree index can serve it. `%foo%` is used only where the owner genuinely
 *     types from the middle of the value, and each of those is justified where
 *     it is written.
 *
 * Health data never leaves here: a patient line carries a name, a phone and how
 * many purchases are in the caller's scope. No prescription, no diagnosis, no
 * clinical field of any kind — not even indirectly through a sale's items.
 *
 * Reads only. The pure parts (term parsing, scope resolution, query plans, row
 * mapping) are exported so they can be tested without HTTP and without a
 * database; the executors below only translate a plan into knex calls.
 */

/** Autocomplete floor: one character matches far too much to be worth a round trip. */
export const MIN_TERM = 2;
/** Longest term we will look for; anything beyond is noise, and bounds the LIKE patterns. */
export const MAX_TERM = 80;
export const DEFAULT_LIMIT = 5;
export const MAX_LIMIT = 10;

export type OmniKind = "sale" | "order" | "patient" | "seller" | "store" | "frame";

/** Every kind, in the order the panel stacks the groups. */
export const OMNI_KINDS: readonly OmniKind[] = ["sale", "order", "patient", "seller", "store", "frame"];

export interface OmniItem {
  id: string;
  /** The bold line. */
  label: string;
  /** The grey line of context; null when there is nothing worth saying. */
  sub: string | null;
  /** Only where an amount means something (a sale's total). */
  amount?: number;
  /** The store the row belongs to, when it belongs to one. */
  store_id?: string | null;
  extra?: Record<string, string | null>;
}

export interface OmniGroup {
  kind: OmniKind;
  items: OmniItem[];
}

export interface OmniSearchResponse {
  /** The cleaned term, so a late answer can be matched to what is in the box. */
  q: string;
  /** Only the groups that found something; the panel decides where each kind navigates to. */
  groups: OmniGroup[];
}

// ---------------------------------------------------------------------------
// The term: what the owner typed, turned into something a query can use
// ---------------------------------------------------------------------------

export function cleanTerm(q: unknown): string {
  return typeof q === "string" ? q.trim().replace(/\s+/g, " ").slice(0, MAX_TERM) : "";
}

export function clampLimit(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/**
 * Makes a typed `%`, `_` or `\` literal. Without this, a single `%` in the box
 * turns every prefix match into a full table scan.
 */
export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** `foo%` — can be served by a btree index on the column (text_pattern_ops aside). */
export const prefixPattern = (s: string): string => `${likeEscape(s)}%`;
/** `%foo%` — cannot use an index. Only where the owner types from the middle of the value. */
export const containsPattern = (s: string): string => `%${likeEscape(s)}%`;

/**
 * The exact `pos_sale.number` values a term can mean.
 *
 * The number is built by lib/pos.ts `saleNumber()`: the store's code and its
 * own six-digit sequence (`Op2-000147`). The owner reads it off a receipt or a
 * lab ticket and types it in any of the shapes it appears in — with or without
 * the leading zeros, with the code in lower case, or just the sequence — so the
 * term is normalised back into whole numbers and matched with `IN`, against the
 * unique index on the column. No LIKE at all for this, which is why finding a
 * sale by its number costs nothing.
 *
 * `storeCodes` are the codes of the stores IN THE CALLER'S SCOPE, so a bare
 * sequence never produces a candidate from a store the caller cannot see.
 */
export function saleNumberCandidates(term: string, storeCodes: readonly string[]): string[] {
  const t = term.trim().replace(/\s+/g, " ");
  // `Op1-000123`, `op1-123`, `Op1 123`: a store code, a separator, a sequence.
  const full = /^([A-Za-z]+\d+)\s*[-–—\s]\s*0*(\d{1,6})$/.exec(t);
  if (full) {
    const code = storeCodes.find((c) => c.toLowerCase() === full[1].toLowerCase());
    // A code outside the caller's stores yields nothing: the scope filter would
    // drop the row anyway, and this saves the database the lookup.
    return code ? [saleNumber(code, Number(full[2]))] : [];
  }
  // `123`, `000123`, `#123`: the sequence alone — the same sale in each store.
  const seq = /^#?\s*0*(\d{1,6})$/.exec(t);
  if (!seq) return [];
  const n = Number(seq[1]);
  return [...new Set(storeCodes)].map((c) => saleNumber(c, n));
}

/**
 * The `order.display_id` a term can mean, or null. Order numbers are read as
 * `#1024`, so this is an integer equality — no pattern match, no index worry.
 */
export function orderDisplayId(term: string): number | null {
  const m = /^#?\s*0*(\d{1,9})$/.exec(term.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * The comparable part of a phone number: digits only, last ten.
 *
 * The owner has the phone written down as `(305) 555-0101` and the customer
 * registered it as `+1 305 555 0101`. Both sides of the comparison are reduced
 * the same way (the column with `regexp_replace`), exactly as
 * lib/pos-data.ts already does for the till's customer search, or the search
 * finds nothing and the patient gets registered twice.
 *
 * Returns null under seven digits: a three-digit "phone" matches half the town.
 */
export function phoneKey(term: string): string | null {
  const d = term.replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : null;
}

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** `28 oct` in the store's own timezone — the date as the owner reads it on the receipt. */
export function shortDate(value: unknown, tz: string): string | null {
  const d = value instanceof Date ? value : new Date(String(value ?? ""));
  if (Number.isNaN(d.getTime())) return null;
  const [, mm, dd] = localParts(d, tz).date.split("-");
  return `${Number(dd)} ${MONTHS_ES[Number(mm) - 1]}`;
}

const line = (...parts: Array<string | null | undefined>): string | null => {
  const s = parts.map((p) => (p ?? "").trim()).filter(Boolean).join(" · ");
  return s || null;
};

const personName = (first: unknown, last: unknown): string =>
  [first, last].map((v) => String(v ?? "").trim()).filter(Boolean).join(" ");

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

export interface OmniScope {
  userId: string;
  /** Stores the caller may look into; null = every store (owner, superadmin). */
  storeIds: string[] | null;
  /** Set for a seller: only sales whose `seller_id` is this user are findable. */
  ownSellerId: string | null;
  /**
   * Whether the caller may find OTHER PEOPLE and stores at all. False for a
   * seller: the owner's rule is that a seller sees their own sales and nothing
   * of the general state of the business — so the `seller` and `store` groups
   * are not even queried for them, and they cannot enumerate their colleagues.
   */
  staffVisible: boolean;
}

export type StaffLike = Pick<StaffScope, "is_admin" | "role" | "establishment_ids" | "user_id">;

/**
 * The caller's reach, resolved once per request from the same role data the
 * panel's other routes use. `canSellAt`/`sellableStores` (lib/pos.ts) decide
 * the stores and `ownSalesOnly` (lib/pos-route.ts) decides whether the person
 * is limited to their own sales, so this cannot drift from the rest of /admin.
 */
export function omniScope(staff: StaffLike, stores: readonly EstablishmentRow[]): OmniScope {
  const ownSellerId = ownSalesOnly(staff) ? staff.user_id : null;
  return {
    userId: staff.user_id,
    storeIds: staff.is_admin ? null : sellableStores(staff, [...stores]).map((s) => s.id),
    ownSellerId,
    staffVisible: ownSellerId === null,
  };
}

/** A caller with a role but no store left to look at finds nothing — and we do not ask the database. */
export const scopeIsEmpty = (scope: OmniScope): boolean => scope.storeIds !== null && scope.storeIds.length === 0;

// ---------------------------------------------------------------------------
// Query plans — the whole of the scope and matching decisions, pure
// ---------------------------------------------------------------------------

/** Store columns a plan constrains; null = every store. */
type Stores = string[] | null;

export interface SalePlan {
  stores: Stores;
  /** Only this seller's sales (a seller); null = every seller of the stores above. */
  sellerId: string | null;
  /** Whole `pos_sale.number` values to match with `IN`. */
  numbers: string[];
  /** Prefix pattern for the patient's name and the seller's code on the sale. */
  prefix: string;
  limit: number;
}

export interface OrderPlan {
  stores: Stores;
  sellerId: string | null;
  displayId: number;
  /** True when the order must have a point-of-sale sale in scope (every non-admin). */
  requireSale: boolean;
  limit: number;
}

export interface PatientPlan {
  stores: Stores;
  sellerId: string | null;
  prefix: string;
  /** Last ten digits of the phone, or null when the term is not phone-like. */
  phone: string | null;
  /**
   * True when the patient must have a sale in the caller's scope: a seller only
   * reaches the patients of their own sales, a manager those of their stores.
   * Admins search the whole customer base, web customers included.
   */
  requireSale: boolean;
  limit: number;
}

export interface SellerPlan {
  stores: Stores;
  prefix: string;
  phone: string | null;
  limit: number;
}

export interface FramePlan {
  prefix: string;
  contains: string;
  limit: number;
}

export function salePlan(term: string, scope: OmniScope, storeCodes: readonly string[], limit: number): SalePlan {
  return {
    stores: scope.storeIds,
    sellerId: scope.ownSellerId,
    numbers: saleNumberCandidates(term, storeCodes),
    prefix: prefixPattern(term),
    limit,
  };
}

export function orderPlan(term: string, scope: OmniScope, limit: number): OrderPlan | null {
  const displayId = orderDisplayId(term);
  // Orders are only ever looked up by their number, so with no number in the
  // term there is nothing to ask: the group costs zero queries.
  if (displayId === null) return null;
  return { stores: scope.storeIds, sellerId: scope.ownSellerId, displayId, requireSale: scope.storeIds !== null, limit };
}

export function patientPlan(term: string, scope: OmniScope, limit: number): PatientPlan {
  return {
    stores: scope.storeIds,
    sellerId: scope.ownSellerId,
    prefix: prefixPattern(term),
    phone: phoneKey(term),
    requireSale: scope.storeIds !== null || scope.ownSellerId !== null,
    limit,
  };
}

export function sellerPlan(term: string, scope: OmniScope, limit: number): SellerPlan | null {
  // A seller never finds a colleague (owner's rule): no query at all.
  if (!scope.staffVisible) return null;
  return { stores: scope.storeIds, prefix: prefixPattern(term), phone: phoneKey(term), limit };
}

export function framePlan(term: string, limit: number): FramePlan {
  return { prefix: prefixPattern(term), contains: containsPattern(term), limit };
}

/**
 * Stores matching the term, out of the ones the caller may see.
 *
 * No query: the establishment list is a handful of rows and it is already
 * loaded to resolve the scope and to name the stores on the other groups, so a
 * round trip would be pure overhead. Being in memory, the name is matched
 * anywhere in the string ("family" finds "Fry Family"), which on a real column
 * would cost an unindexable `%foo%`.
 */
export function storeMatches(term: string, scope: OmniScope, stores: readonly EstablishmentRow[], limit: number): EstablishmentRow[] {
  if (!scope.staffVisible) return [];
  const t = term.toLowerCase();
  const allowed = scope.storeIds;
  return stores
    .filter((s) => allowed === null || allowed.includes(s.id))
    .filter((s) => s.name.toLowerCase().includes(t) || s.code.toLowerCase().startsWith(t))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Row mapping — pure, and the only place a row becomes something the panel reads
// ---------------------------------------------------------------------------

export interface SaleRowish {
  id: string;
  number: string;
  establishment_id: string;
  total_cents: number | string | null;
  created_at: unknown;
  order_id: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface OrderRowish {
  id: string;
  display_id: number | string | null;
  created_at: unknown;
  establishment_id: string | null;
  sale_number: string | null;
}

export interface PatientRowish {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  sales: number | string | null;
}

export interface SellerRowish {
  id: string;
  name: string | null;
  code: string | null;
  establishment_id: string | null;
}

export interface FrameRowish {
  id: string;
  title: string | null;
  brand: string | null;
  sku: string | null;
  color: string | null;
}

/** Name of a store for the grey line; its code when the name is missing. */
export type StoreNames = ReadonlyMap<string, { code: string; name: string }>;

const storeName = (stores: StoreNames, id: string | null | undefined): string | null => {
  if (!id) return null;
  const s = stores.get(id);
  return s ? s.name || s.code : null;
};

export function toSaleItem(r: SaleRowish, stores: StoreNames, tz: string): OmniItem {
  return {
    id: r.id,
    label: r.number,
    sub: line(personName(r.first_name, r.last_name), storeName(stores, r.establishment_id), shortDate(r.created_at, tz)),
    amount: Math.round(Number(r.total_cents ?? 0)) / 100,
    store_id: r.establishment_id,
    extra: { order_id: r.order_id ?? null },
  };
}

export function toOrderItem(r: OrderRowish, stores: StoreNames, tz: string): OmniItem {
  return {
    id: r.id,
    label: r.display_id == null ? r.id : `#${r.display_id}`,
    sub: line(r.sale_number, storeName(stores, r.establishment_id), shortDate(r.created_at, tz)),
    store_id: r.establishment_id ?? null,
    extra: { sale_number: r.sale_number ?? null },
  };
}

/**
 * A patient line. Name, phone and how many purchases are in the caller's scope
 * — and nothing else, ever. The prescription and anything clinical stay out of
 * the search by never being selected.
 */
export function toPatientItem(r: PatientRowish): OmniItem {
  const n = Math.max(0, Math.round(Number(r.sales ?? 0)));
  return {
    id: r.id,
    label: personName(r.first_name, r.last_name) || r.email || r.id,
    sub: line(r.phone, n ? `${n} ${n === 1 ? "compra" : "compras"}` : null),
    // Patients belong to the business, not to a store (HU-70): the same person
    // buys at Op1 and at Op2, so there is no single store to point at.
    store_id: null,
    extra: { phone: r.phone ?? null },
  };
}

export function toSellerItem(r: SellerRowish, stores: StoreNames): OmniItem {
  const code = (r.code ?? "").trim() || null;
  return {
    id: r.id,
    label: (r.name ?? "").trim() || code || r.id,
    sub: line(code, storeName(stores, r.establishment_id)),
    extra: { code },
  };
}

export function toStoreItem(s: EstablishmentRow): OmniItem {
  return { id: s.id, label: s.name || s.code, sub: s.code };
}

export function toFrameItem(r: FrameRowish): OmniItem {
  const title = (r.title ?? "").trim();
  const brand = (r.brand ?? "").trim();
  const color = (r.color ?? "").trim();
  // The brand is prepended only when the model's own title does not already
  // carry it — scraped titles usually do ("DICAPRIO DC-204").
  const head = brand && !title.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${title}` : title;
  const sku = (r.sku ?? "").trim() || null;
  return {
    id: r.id,
    label: [head, color].filter(Boolean).join(" ") || r.id,
    sub: line(sku ? `SKU ${sku}` : null, brand || null),
    extra: { sku },
  };
}

// ---------------------------------------------------------------------------
// Executors — one bounded query per group, no decisions of their own
// ---------------------------------------------------------------------------

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

/** The scope of a point-of-sale sale, on the alias `s`. Applied to every group that reads sales. */
function scopeSales(q: Knex.QueryBuilder, stores: Stores, sellerId: string | null, alias = "s"): Knex.QueryBuilder {
  if (stores !== null) q.whereIn(`${alias}.establishment_id`, stores);
  if (sellerId !== null) q.where(`${alias}.seller_id`, sellerId);
  return q;
}

export async function runSales(pg: Knex, plan: SalePlan): Promise<SaleRowish[]> {
  const q = pg({ s: "pos_sale" })
    // The patient's name lives on the Medusa customer; LEFT so a sale found by
    // its number still comes back when it has no customer attached.
    .leftJoin({ c: "customer" }, function join() {
      this.on("c.id", "=", "s.customer_id").andOnNull("c.deleted_at");
    })
    .whereNull("s.deleted_at");
  scopeSales(q, plan.stores, plan.sellerId);
  q.where((w) => {
    if (plan.numbers.length) w.orWhereIn("s.number", plan.numbers);
    // Prefix per name column rather than `%term%` over a concatenation: both
    // "daniela" and "ruiz" are the START of a field, which is how a name is
    // typed, and an index can serve it.
    w.orWhereILike("c.first_name", plan.prefix);
    w.orWhereILike("c.last_name", plan.prefix);
    // Seller codes are short and typed in full ("DAN"); prefix is enough.
    w.orWhereILike("s.seller_code", plan.prefix);
  });
  const rows = await q
    .orderBy("s.created_at", "desc")
    .limit(plan.limit)
    .select(
      "s.id",
      "s.number",
      "s.establishment_id",
      "s.total_cents",
      "s.created_at",
      "s.order_id",
      "c.first_name",
      "c.last_name"
    );
  return rows as unknown as SaleRowish[];
}

export async function runOrders(pg: Knex, plan: OrderPlan): Promise<OrderRowish[]> {
  // `order` is a reserved word; knex quotes identifiers, so the alias is safe.
  const q = pg({ o: "order" }).whereNull("o.deleted_at").where("o.display_id", plan.displayId);
  // A non-admin reaches an order only through a sale they may see. An admin gets
  // the web orders too, which have no point-of-sale sale behind them.
  if (plan.requireSale) {
    q.innerJoin({ s: "pos_sale" }, function join() {
      this.on("s.order_id", "=", "o.id").andOnNull("s.deleted_at");
    });
    scopeSales(q, plan.stores, plan.sellerId);
  } else {
    q.leftJoin({ s: "pos_sale" }, function join() {
      this.on("s.order_id", "=", "o.id").andOnNull("s.deleted_at");
    });
  }
  const rows = await q
    .limit(plan.limit)
    .select("o.id", "o.display_id", "o.created_at", "s.establishment_id", { sale_number: "s.number" });
  return rows as unknown as OrderRowish[];
}

export async function runPatients(pg: Knex, plan: PatientPlan): Promise<PatientRowish[]> {
  // The purchase count carries the caller's scope: a seller's "3 compras" means
  // three of THEIR sales, not three of the store's.
  const counted = pg({ s2: "pos_sale" }).whereRaw("s2.customer_id = c.id").whereNull("s2.deleted_at").count("*");
  scopeSales(counted, plan.stores, plan.sellerId, "s2");

  const q = pg({ c: "customer" })
    .whereNull("c.deleted_at")
    .where((w) => {
      w.orWhereILike("c.first_name", plan.prefix);
      w.orWhereILike("c.last_name", plan.prefix);
      // The email is typed from its start (the local part), never from the middle.
      w.orWhereILike("c.email", plan.prefix);
      if (plan.phone) {
        // Both sides reduced to the last ten digits, so `(305) 555-0101` and
        // `+13055550101` are the same phone (same rule as lib/pos-data.ts).
        w.orWhereRaw(`right(regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g'), 10) = ?`, [plan.phone]);
      }
    });
  if (plan.requireSale) {
    // EXISTS, not a join: no duplicate rows and it stops at the first sale.
    const reachable = pg({ s: "pos_sale" }).select(pg.raw("1")).whereRaw("s.customer_id = c.id").whereNull("s.deleted_at");
    scopeSales(reachable, plan.stores, plan.sellerId);
    q.whereExists(reachable);
  }
  const rows = await q
    .orderBy("c.created_at", "desc")
    .limit(plan.limit)
    .select("c.id", "c.first_name", "c.last_name", "c.email", "c.phone", { sales: counted });
  return rows as unknown as PatientRowish[];
}

export async function runSellers(pg: Knex, plan: SellerPlan): Promise<SellerRowish[]> {
  const q = pg({ sl: "seller" }).whereNull("sl.deleted_at");
  // A supervisor or manager finds the sellers of their stores only. A seller
  // never gets here at all (sellerPlan returns null).
  if (plan.stores !== null) q.whereIn("sl.establishment_id", plan.stores);
  q.where((w) => {
    w.orWhereILike("sl.name", plan.prefix);
    // The referral code is short and typed whole; prefix covers both.
    w.orWhereILike("sl.code", plan.prefix);
    if (plan.phone) w.orWhereRaw(`right(regexp_replace(coalesce(sl.phone, ''), '\\D', '', 'g'), 10) = ?`, [plan.phone]);
  });
  const rows = await q
    .orderBy([{ column: "sl.active", order: "desc" }, { column: "sl.name", order: "asc" }])
    .limit(plan.limit)
    .select("sl.id", "sl.name", "sl.code", "sl.establishment_id");
  return rows as unknown as SellerRowish[];
}

export async function runFrames(pg: Knex, plan: FramePlan): Promise<FrameRowish[]> {
  // One row per MODEL with the colour whose code matched, through a lateral
  // that stops at one variant — so a brand search does not fill the group with
  // five colours of the same frame.
  const q = pg({ p: "product" })
    .joinRaw(
      `left join lateral (
         select v.sku, v.title, v.metadata
         from product_variant v
         where v.product_id = p.id and v.deleted_at is null
         order by ((v.sku ilike ? or v.barcode ilike ?)) desc, v.id
         limit 1
       ) m on true`,
      [plan.prefix, plan.prefix]
    )
    .whereNull("p.deleted_at")
    .where("p.status", "published")
    .where((w) => {
      // `%term%` earns its place here and nowhere else: the owner types the
      // model out of the middle of the title ("DC-204", or just "204" of
      // "DICAPRIO DC-204"), so a prefix would never find it. The catalog is
      // small next to the sales tables and the LIMIT is tiny.
      w.orWhereILike("p.title", plan.contains);
      // Brand as the scraper writes it (lib/store-assortment.ts brandOf) —
      // typed from the start, so a prefix.
      w.orWhereRaw(`coalesce(p.metadata->>'brand', p.metadata->>'brand_slug', p.metadata->>'collection_slug', '') ilike ?`, [plan.prefix]);
      // A code is read left to right off the tag or sent whole by a scanner.
      w.orWhereRaw(
        `exists (select 1 from product_variant v2
                  where v2.product_id = p.id and v2.deleted_at is null
                    and (v2.sku ilike ? or v2.barcode ilike ?))`,
        [plan.prefix, plan.prefix]
      );
    });
  const rows = await q
    .orderBy("p.title", "asc")
    .limit(plan.limit)
    .select(
      "p.id",
      "p.title",
      pg.raw(`coalesce(p.metadata->>'brand', p.metadata->>'brand_slug', p.metadata->>'collection_slug') as brand`),
      { sku: "m.sku" },
      pg.raw(`coalesce(nullif(m.metadata->>'color', ''), m.title) as color`)
    );
  return rows as unknown as FrameRowish[];
}

// ---------------------------------------------------------------------------
// The endpoint's one entry point
// ---------------------------------------------------------------------------

/** Drops the groups that found nothing — the panel renders what it is given. */
export function packGroups(found: Partial<Record<OmniKind, OmniItem[]>>): OmniGroup[] {
  return OMNI_KINDS.filter((k) => (found[k]?.length ?? 0) > 0).map((kind) => ({ kind, items: found[kind] as OmniItem[] }));
}

export interface OmniSearchInput {
  q: unknown;
  limit?: unknown;
}

/**
 * One keystroke's answer.
 *
 * Costs, for a term of two characters or more: one read of the establishment
 * list (needed for the scope, for the store group and to name stores on the
 * other lines) plus FOUR parallel queries — sales, patients, sellers, frames —
 * and a fifth only when the term is a number, for the order. A seller drops the
 * seller query, so three. The store group is served from memory.
 *
 * A query that fails takes its own group down and nothing else: the groups that
 * did come back are returned, with the failure in the log. A search bar that
 * answers 500 on a keystroke is worse than one that answers partially.
 */
export async function omniSearch(container: MedusaContainer, staff: StaffLike, input: OmniSearchInput): Promise<OmniSearchResponse> {
  const term = cleanTerm(input.q);
  const limit = clampLimit(input.limit);
  // Under two characters nothing is specific enough to be worth a round trip.
  if (term.length < MIN_TERM) return { q: term, groups: [] };

  const stores = await listEstablishments(container);
  const scope = omniScope(staff, stores);
  // No role, or a role with no store left: nothing is findable, and we do not ask.
  if (scopeIsEmpty(scope)) return { q: term, groups: [] };

  const visible = scope.storeIds === null ? stores : stores.filter((s) => scope.storeIds!.includes(s.id));
  const names: StoreNames = new Map(stores.map((s) => [s.id, { code: s.code, name: s.name }]));
  const tz = tenant().timezone;

  const pg = pgOf(container);
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const order = orderPlan(term, scope, limit);
  const seller = sellerPlan(term, scope, limit);

  const settled = await Promise.allSettled([
    runSales(pg, salePlan(term, scope, visible.map((s) => s.code), limit)),
    order ? runOrders(pg, order) : Promise.resolve([] as OrderRowish[]),
    runPatients(pg, patientPlan(term, scope, limit)),
    seller ? runSellers(pg, seller) : Promise.resolve([] as SellerRowish[]),
    runFrames(pg, framePlan(term, limit)),
  ]);

  // Every query already carries its own LIMIT; this is the belt to that
  // braces, so the contract ("at most `limit` per group") holds even if a query
  // is ever changed and the LIMIT is lost.
  const kept = <T>(i: number, kind: OmniKind): T[] => {
    const r = settled[i];
    if (r.status === "fulfilled") return (r.value as T[]).slice(0, limit);
    logger.error(`[omni-search] the ${kind} query failed: ${(r.reason as Error)?.stack ?? r.reason}`);
    return [];
  };

  return {
    q: term,
    groups: packGroups({
      sale: kept<SaleRowish>(0, "sale").map((r) => toSaleItem(r, names, tz)),
      order: kept<OrderRowish>(1, "order").map((r) => toOrderItem(r, names, tz)),
      patient: kept<PatientRowish>(2, "patient").map(toPatientItem),
      seller: kept<SellerRowish>(3, "seller").map((r) => toSellerItem(r, names)),
      store: storeMatches(term, scope, stores, limit).map(toStoreItem),
      frame: kept<FrameRowish>(4, "frame").map(toFrameItem),
    }),
  };
}

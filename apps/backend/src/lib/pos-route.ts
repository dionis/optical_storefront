import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { listEstablishments, type EstablishmentRow } from "./establishments";
import { canSellAt, sellableStores } from "./pos";
import { getSale, PosError, type SaleRow } from "./pos-data";
import { hasPrivilege } from "./staff-profile";
import { getStaffScope, type StaffScope } from "./staff-scope";

/**
 * Shared by the /admin/pos routes. The /admin guard lets restricted roles
 * (supervisor, manager, seller) reach these routes; THIS is where each request
 * is limited to the stores the user is assigned to and to what the agreed
 * permission matrix gives each role ("Quién puede hacer qué"):
 *
 *   see sales            all / their stores / their store / their own
 *   void a sale          yes / yes / their store / only asks   (+ sale.void privilege)
 *   create tills         yes / no / their store / no
 *   insurer receivables  owner and managers
 */

export async function posScope(req: AuthenticatedMedusaRequest): Promise<StaffScope> {
  const userId = req.auth_context?.actor_id;
  if (!userId) throw new PosError("forbidden_store", 403);
  return getStaffScope(req.scope, userId);
}

/** The active store the user may sell in, or PosError. */
export async function sellableStore(req: AuthenticatedMedusaRequest, scope: StaffScope, storeId: unknown): Promise<EstablishmentRow> {
  const id = typeof storeId === "string" ? storeId : "";
  const store = (await listEstablishments(req.scope)).find((s) => s.id === id);
  if (!store || !store.is_active) throw new PosError("store_not_found", 404);
  if (!canSellAt(scope, store.id)) throw new PosError("forbidden_store", 403);
  return store;
}

/** Ids of the stores in the user's scope; null = every store (admins). */
export async function scopeStoreIds(req: AuthenticatedMedusaRequest, scope: StaffScope): Promise<string[] | null> {
  if (scope.is_admin) return null;
  return sellableStores(scope, await listEstablishments(req.scope)).map((s) => s.id);
}

/** Sellers see their own sales in lists; everyone else, their stores'. */
export const ownSalesOnly = (scope: Pick<StaffScope, "is_admin" | "role">): boolean => !scope.is_admin && scope.role === "seller";

/**
 * A sale the user may open: in one of their stores. A seller may open a
 * colleague's sale of their store to collect its balance or hand it over —
 * the customer comes back to whoever is at the counter — but lists show them
 * only their own.
 */
export async function saleInScope(req: AuthenticatedMedusaRequest, scope: StaffScope, saleId: string): Promise<SaleRow> {
  const sale = await getSale(req.scope, saleId);
  if (!sale) throw new PosError("sale_not_found", 404);
  if (!canSellAt(scope, sale.establishment_id)) throw new PosError("forbidden_store", 403);
  return sale;
}

// ---------------------------------------------------------------------------
// The owner's rule for sellers ("Qué ve un vendedor")
// ---------------------------------------------------------------------------

/**
 * "Sellers do not see the general status of anything, not even of their own
 * store. They only see the details of THEIR sales, what they will receive in
 * money and their commission; and they can handle the overdue or pending
 * payments of OTHER sellers' sales (collect balances)."
 *
 *   full     everything the sale carries (own sale; any other role, their stores)
 *   limited  a colleague's sale of their store that still owes money: only what
 *            is needed to collect it (limitedSale), never the items, the
 *            prescription or the economics
 *   null     nothing: not their store, or a colleague's sale with nothing due
 */
export type SaleAccess = "full" | "limited" | null;

export function saleAccessFor(
  scope: Pick<StaffScope, "is_admin" | "role" | "establishment_ids" | "user_id">,
  sale: Pick<SaleRow, "seller_id" | "establishment_id" | "balance" | "status">
): SaleAccess {
  if (!canSellAt(scope, sale.establishment_id)) return null;
  if (!ownSalesOnly(scope)) return "full";
  if (sale.seller_id != null && sale.seller_id === scope.user_id) return "full";
  return sale.status !== "voided" && sale.balance > 0 ? "limited" : null;
}

/** Name and phone of the customer of a sale, for the collection list and the limited view. */
export interface CustomerContact {
  name: string | null;
  phone: string | null;
}

/** The collection view of a sale (saleAccessFor "limited"). `payments` only when a single sale is opened. */
export interface LimitedSaleRow {
  id: string;
  number: string;
  establishment_id: string;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  seller_code: string | null;
  total: number;
  paid: number;
  balance: number;
  promised_on: string | null;
  status: string;
  limited: true;
  payments?: SaleRow["payments"];
  /** Single sale only: whoever hands the glasses over may compare them with the photo. */
  has_wearing_photo?: boolean;
}

export function limitedSale(sale: SaleRow, contact?: CustomerContact | null, withPayments = false): LimitedSaleRow {
  const row: LimitedSaleRow = {
    id: sale.id,
    number: sale.number,
    establishment_id: sale.establishment_id,
    created_at: sale.created_at,
    customer_name: contact?.name ?? null,
    customer_phone: contact?.phone ?? null,
    seller_code: sale.seller_code,
    total: sale.total,
    paid: sale.paid,
    balance: sale.balance,
    promised_on: sale.promised_on,
    status: sale.status,
    limited: true,
  };
  if (withPayments) {
    row.payments = sale.payments;
    row.has_wearing_photo = sale.has_wearing_photo;
  }
  return row;
}

/** A full sale with the customer's name and phone on it (the collection list of the other roles). */
export function saleWithContact(sale: SaleRow, contact?: CustomerContact | null): SaleRow & { customer_name: string | null; customer_phone: string | null } {
  return { ...sale, customer_name: contact?.name ?? null, customer_phone: contact?.phone ?? null };
}

/** Name (or email) and phone of Medusa customers, by id. */
export async function customerContacts(container: MedusaContainer, ids: Array<string | null | undefined>): Promise<Map<string, CustomerContact>> {
  const wanted = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (!wanted.length) return new Map();
  const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  const rows = (await pg("customer").whereIn("id", wanted).select("id", "first_name", "last_name", "email", "phone")) as Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
  }>;
  return new Map(rows.map((c) => [c.id, { name: [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || c.email || null, phone: c.phone ?? null }]));
}

/**
 * The sale behind an id, as the user may see it: full, limited (a seller
 * collecting a colleague's balance) or 403 `forbidden_sale`. Used by the
 * detail and the payments routes; the other actions keep saleInScope.
 */
export async function saleForUser(req: AuthenticatedMedusaRequest, scope: StaffScope, saleId: string): Promise<{ sale: SaleRow; access: Exclude<SaleAccess, null> }> {
  const sale = await getSale(req.scope, saleId);
  if (!sale) throw new PosError("sale_not_found", 404);
  if (!canSellAt(scope, sale.establishment_id)) throw new PosError("forbidden_store", 403);
  const access = saleAccessFor(scope, sale);
  if (!access) throw new PosError("forbidden_sale", 403);
  return { sale, access };
}

/** Void directly (otherwise the request goes to someone who can). */
export function canVoid(scope: StaffScope): boolean {
  if (scope.is_admin || scope.can_void || hasPrivilege(scope, "sale.void")) return true;
  return scope.role === "supervisor" || scope.role === "manager";
}

/** Create and configure tills, see the insurers' receivables of the store. */
export function managesStore(scope: StaffScope, storeId: string): boolean {
  if (scope.is_admin) return true;
  return scope.role === "manager" && canSellAt(scope, storeId);
}

/** Runs a handler, turning PosError into `{ reason }` and anything else into a logged 500. */
export async function posHandler(req: AuthenticatedMedusaRequest, res: MedusaResponse, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof PosError) {
      res.status(e.status).json({ type: "invalid_data", reason: e.reason, message: `Point of sale: ${e.reason}`, ...e.extra });
      return;
    }
    req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER).error(`[pos] ${req.method} ${req.url}: ${(e as Error).stack ?? e}`);
    res.status(500).json({ type: "unexpected_state", reason: "sale_failed", message: "The point-of-sale request failed." });
  }
}

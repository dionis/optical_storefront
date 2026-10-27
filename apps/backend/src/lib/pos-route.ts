import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
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
export const ownSalesOnly = (scope: StaffScope): boolean => !scope.is_admin && scope.role === "seller";

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

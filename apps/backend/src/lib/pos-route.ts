import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { listEstablishments, type EstablishmentRow } from "./establishments";
import { canSellAt } from "./pos";
import { PosError } from "./pos-data";
import { getStaffScope, type StaffScope } from "./staff-scope";

/**
 * Shared by the /admin/pos routes. The /admin guard lets restricted roles
 * (supervisor, manager, seller) reach these routes; THIS is where each request
 * is limited to the stores the user is assigned to.
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

/** Runs a handler, turning PosError into `{ reason }` and anything else into a logged 500. */
export async function posHandler(req: AuthenticatedMedusaRequest, res: MedusaResponse, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof PosError) {
      res.status(e.status).json({ type: "invalid_data", reason: e.reason, message: `Point of sale: ${e.reason}` });
      return;
    }
    req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER).error(`[pos] ${req.method} ${req.url}: ${(e as Error).stack ?? e}`);
    res.status(500).json({ type: "unexpected_state", reason: "sale_failed", message: "The sale could not be completed." });
  }
}

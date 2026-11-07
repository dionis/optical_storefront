import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { listEstablishments } from "../../../../lib/establishments";
import { boardAccessFor, fetchBoardOrder, restrictBoardRows, slimBoardOrder } from "../../../../lib/order-board";
import { sellableStores } from "../../../../lib/pos";
import { getStaffScope } from "../../../../lib/staff-scope";

/**
 * GET /admin/order-board/:id — one order of the board, the same projection the
 * list serves plus Medusa's payment records (`payments`), for the sale sheet
 * the panel opens in front of any screen (SaleDetailPanel with `orderId`): a
 * web order has no till sale behind it, so this is its only source of items,
 * photos, customer, address, stage, `next_stages` and what was paid.
 *
 * Who reads what: the same rule as the list (boardAccessFor). Owner and
 * superadmin read it whole; a supervisor or manager only a till order of one of
 * their stores, and only its slim view (stage, history, ids — no items, no
 * customer, no money, no moves); a seller is refused (forbidden_role), their
 * sale sheet does not ask. Before 5-nov-2026 the guard refused everyone but
 * admins and the sheet said «No se pudo leer la etapa del pedido» to a manager.
 *
 * `:id` is the Medusa order id (`order_…`). The display number is searched
 * through the list (`?q=#1042`), never here.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const id = String(req.params.id ?? "").trim();
  if (!id) {
    res.status(400).json({ type: "invalid_data", reason: "bad_id", message: "Order id required." });
    return;
  }
  const actorId = req.auth_context?.actor_id;
  if (!actorId) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "No user behind this request." });
    return;
  }
  let access: ReturnType<typeof boardAccessFor>;
  try {
    const scope = await getStaffScope(req.scope, actorId);
    const storeIds = scope.is_admin ? null : sellableStores(scope, await listEstablishments(req.scope)).map((s) => s.id);
    access = boardAccessFor(scope, storeIds);
  } catch (error) {
    logger.error(`[order-board] could not resolve the caller's scope: ${(error as Error).message}`);
    res.status(503).json({ type: "unexpected_state", reason: "scope_unavailable", message: "Could not resolve the user's role." });
    return;
  }
  if (!access.allowed) {
    res.status(403).json({ type: "not_allowed", reason: access.reason, message: "This role cannot read the order board." });
    return;
  }
  try {
    const order = await fetchBoardOrder(req.scope, id, { withPayments: access.money });
    if (!order) {
      res.status(404).json({ type: "not_found", reason: "not_found", message: `Order '${id}' not found.` });
      return;
    }
    if (!access.slim_only) {
      res.status(200).json({ order });
      return;
    }
    // A till order of one of their stores, or nothing: a web order or another
    // store's sale is not theirs to read (404 would reveal it exists).
    if (order.channel !== "pos" || !order.establishment_id || !(access.stores ?? []).includes(order.establishment_id)) {
      res.status(403).json({ type: "not_allowed", reason: "forbidden_store", message: "This order is not in one of your stores." });
      return;
    }
    const [slim] = restrictBoardRows([slimBoardOrder(order)]);
    res.status(200).json({ order: slim });
  } catch (error) {
    logger.error(`[order-board] could not read order ${id}: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "read_failed", message: "Could not read the order." });
  }
}

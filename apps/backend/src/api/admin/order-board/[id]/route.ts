import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { fetchBoardOrder } from "../../../../lib/order-board";

/**
 * GET /admin/order-board/:id — one order of the board, the same projection the
 * list serves plus Medusa's payment records (`payments`), for the sale sheet
 * the panel opens in front of any screen (SaleDetailPanel with `orderId`): a
 * web order has no till sale behind it, so this is its only source of items,
 * photos, customer, address, stage, `next_stages` and what was paid.
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
  try {
    const order = await fetchBoardOrder(req.scope, id, { withPayments: true });
    if (!order) {
      res.status(404).json({ type: "not_found", reason: "not_found", message: `Order '${id}' not found.` });
      return;
    }
    res.status(200).json({ order });
  } catch (error) {
    logger.error(`[order-board] could not read order ${id}: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "read_failed", message: "Could not read the order." });
  }
}

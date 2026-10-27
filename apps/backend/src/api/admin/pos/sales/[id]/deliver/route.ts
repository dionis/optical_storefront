import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { markDelivered } from "../../../../../../lib/pos-data";
import { posHandler, posScope, saleInScope } from "../../../../../../lib/pos-route";

/**
 * POST /admin/pos/sales/:id/deliver — the customer takes the glasses (HU-29).
 * Only with nothing left to pay (collect the balance first); frees the tray.
 * The lab stage of the order ("delivered") is moved from the order board.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const sale = await saleInScope(req, scope, String(req.params.id ?? ""));
    res.json({ sale: await markDelivered(req.scope, sale) });
  });
}

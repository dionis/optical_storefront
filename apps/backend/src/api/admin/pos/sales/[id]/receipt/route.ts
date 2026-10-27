import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { emailReceipt } from "../../../../../../lib/pos-documents";
import { posHandler, posScope, saleInScope } from "../../../../../../lib/pos-route";

/**
 * POST /admin/pos/sales/:id/receipt — sends (or resends) the receipt to the
 * customer's email (HU-27, HU-102). Only to the address on the sale.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const sale = await saleInScope(req, scope, String(req.params.id ?? ""));
    const to = await emailReceipt(req.scope, sale);
    res.json({ sent: true, to });
  });
}

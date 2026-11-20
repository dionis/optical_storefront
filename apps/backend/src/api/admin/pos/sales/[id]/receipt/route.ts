import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { emailReceipt } from "../../../../../../lib/pos-documents";
import { posHandler, posScope, saleInScope } from "../../../../../../lib/pos-route";

/**
 * POST /admin/pos/sales/:id/receipt { receipt_detail? } — sends (or resends) the
 * receipt to the customer's email (HU-27, HU-102). Only to the address on the
 * sale. Simple unless `receipt_detail` is exactly true (photos and prescription).
 */
export async function POST(req: AuthenticatedMedusaRequest<{ receipt_detail?: boolean }>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const sale = await saleInScope(req, scope, String(req.params.id ?? ""));
    const detailed = (req.body as { receipt_detail?: boolean } | undefined)?.receipt_detail === true;
    const to = await emailReceipt(req.scope, sale, { detailed, actorId: scope.user_id });
    res.json({ sent: true, to, detailed });
  });
}

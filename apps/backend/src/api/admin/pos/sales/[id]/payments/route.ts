import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { cleanPayments } from "../../../../../../lib/pos";
import { collectPayment, listPaymentMethods, PosError } from "../../../../../../lib/pos-data";
import { posHandler, posScope, saleInScope } from "../../../../../../lib/pos-route";

/**
 * POST /admin/pos/sales/:id/payments — { payments } collects (part of) the
 * balance, usually at pickup (HU-29). Never more than what is due. The insurer's
 * part is set at the sale; here the customer pays what is theirs.
 */
export async function POST(req: AuthenticatedMedusaRequest<{ payments?: unknown }>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const sale = await saleInScope(req, scope, String(req.params.id ?? ""));
    const methods = await listPaymentMethods(req.scope);
    const cleaned = cleanPayments((req.body ?? {}).payments, Math.round(sale.balance * 100), methods, {
      establishmentId: sale.establishment_id,
      allowInsurance: false,
    });
    if ("reason" in cleaned) throw new PosError(cleaned.reason, 422, cleaned.method ? { method: cleaned.method } : {});
    if (!cleaned.payments.length) throw new PosError("no_payments");
    res.json({ sale: await collectPayment(req.scope, sale, cleaned, scope.user_id) });
  });
}

import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { cleanPayments } from "../../../../../../lib/pos";
import { collectPayment, listPaymentMethods, PosError } from "../../../../../../lib/pos-data";
import { customerContacts, limitedSale, posHandler, posScope, saleForUser } from "../../../../../../lib/pos-route";

/**
 * POST /admin/pos/sales/:id/payments — { payments } collects (part of) the
 * balance, usually at pickup (HU-29). Never more than what is due. The insurer's
 * part is set at the sale; here the customer pays what is theirs.
 *
 * Who may collect (lib/pos-route.ts saleForUser): anyone over the sales of
 * their stores; a seller over their own sales and over a colleague's sale of
 * their store while it owes money (the owner's "handle other sellers' overdue
 * payments" rule). The payment is recorded with `received_by` = whoever
 * collected it and audited (payment.collect), so the colleague's commission
 * and the till's cash stay true. A seller gets back the collection view.
 */
export async function POST(req: AuthenticatedMedusaRequest<{ payments?: unknown }>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const { sale, access } = await saleForUser(req, scope, String(req.params.id ?? ""));
    const methods = await listPaymentMethods(req.scope);
    const cleaned = cleanPayments((req.body ?? {}).payments, Math.round(sale.balance * 100), methods, {
      establishmentId: sale.establishment_id,
      allowInsurance: false,
    });
    if ("reason" in cleaned) throw new PosError(cleaned.reason, 422, cleaned.method ? { method: cleaned.method } : {});
    if (!cleaned.payments.length) throw new PosError("no_payments");
    const updated = await collectPayment(req.scope, sale, cleaned, scope.user_id);
    if (access === "limited") {
      const contacts = await customerContacts(req.scope, [updated.customer_id]);
      res.json({ sale: limitedSale(updated, updated.customer_id ? contacts.get(updated.customer_id) : null, true) });
      return;
    }
    res.json({ sale: updated });
  });
}

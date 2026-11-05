import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { cleanPayments } from "../../../../../../lib/pos";
import { collectAndDeliver, listPaymentMethods, PosError } from "../../../../../../lib/pos-data";
import { posHandler, posScope, saleInScope } from "../../../../../../lib/pos-route";

/**
 * POST /admin/pos/sales/:id/deliver — the customer takes the glasses (HU-29,
 * HU-32). Body `{ payments? }`, the same rows as /payments: when the sale
 * still owes money they are collected first (atomically, lib/pos-data.ts
 * collectPayment) and the glasses are handed over in the same call; without
 * them a sale with a balance answers 409 `balance_due`. Frees the tray and
 * moves the order's stage to "delivered" (best-effort) so the order board,
 * the customer's tracking page and the Sheet agree with the till.
 *
 * Who may deliver: whoever may sell at the sale's store (unchanged). The
 * payment, when there is one, is recorded with `received_by` = whoever
 * collected it and audited (payment.collect); the hand-over is audited as
 * sale.deliver. Response: `{ sale, collected }`.
 */
export async function POST(req: AuthenticatedMedusaRequest<{ payments?: unknown }>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const sale = await saleInScope(req, scope, String(req.params.id ?? ""));
    const raw = (req.body ?? {}).payments;
    let cleaned = null;
    if (Array.isArray(raw) && raw.length && sale.balance > 0) {
      const methods = await listPaymentMethods(req.scope);
      // The whole balance, or nothing is written: a part payment is a plain
      // collection (/payments), never a hand-over with money still owed.
      const c = cleanPayments(raw, Math.round(sale.balance * 100), methods, { establishmentId: sale.establishment_id, allowInsurance: false, requireFull: true });
      if ("reason" in c) throw new PosError(c.reason, 422, c.method ? { method: c.method } : {});
      cleaned = c;
    }
    const { sale: delivered, collected } = await collectAndDeliver(req.scope, sale, cleaned, scope.user_id);
    res.json({ sale: delivered, collected });
  });
}

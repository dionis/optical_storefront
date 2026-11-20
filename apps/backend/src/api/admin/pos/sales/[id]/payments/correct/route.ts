import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { cleanCorrectionMeta } from "../../../../../../../lib/payment-correction";
import { correctSalePayments } from "../../../../../../../lib/payment-correction-data";
import { PosError } from "../../../../../../../lib/pos-data";
import { posHandler, posScope, saleInScope } from "../../../../../../../lib/pos-route";
import { creatorRoleOf } from "../../../../../../../lib/pos-sale-route";
import { saleEditDenied } from "../../../../../../../lib/sale-permissions";

/**
 * POST /admin/pos/sales/:id/payments/correct
 *   { payments: [{ id?, method_code, amount, details? }], reason, note?, seen_paid? }
 *
 * Fixes a registration mistake in the payments of a sale (owner, 15-nov-2026:
 * «si pongo que se cobró 250 de anticipo y fue total, debe poderse resolver»).
 * `payments` is the list of the customer's payments AS THEY SHOULD BE: rows
 * kept carry their `id` (changed or not), new ones none, and a row left out is
 * removed. The insurer's part is not here. `reason` is one of
 * CORRECTION_REASONS (lib/payment-correction.ts); `note` is required with
 * «other». `seen_paid` is what the screen showed as paid: if it differs, the
 * payments changed meanwhile and nothing is written.
 *
 * Who: the same people who may correct the sale's details
 * (lib/sale-permissions.ts saleEditDenied). The cash difference goes to the
 * store's open register as a «correction» line (lib/payment-correction-data.ts).
 *
 * Reasons: bad_correction_reason, correction_note_required, note_too_long,
 * bad_payment, bad_method, missing_reference, bad_tendered, unknown_payment,
 * payment_not_editable, no_changes, overpaid (+ `max`), payments_changed (409),
 * sale_voided (409), cash_unavailable (503), forbidden_* (403).
 */
interface Body {
  payments?: unknown;
  reason?: unknown;
  note?: unknown;
  seen_paid?: unknown;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const sale = await saleInScope(req, scope, String(req.params.id ?? ""));
    const denied = saleEditDenied(scope, sale, await creatorRoleOf(req.scope, sale.seller_id));
    if (denied) throw new PosError(denied, denied === "sale_voided" ? 409 : 403);
    const body = (req.body ?? {}) as Body;
    const meta = cleanCorrectionMeta(body);
    if ("reason" in meta) throw new PosError(meta.reason);
    const result = await correctSalePayments(req.scope, sale, { payments: body.payments, why: meta.why, note: meta.note, seenPaid: body.seen_paid }, scope.user_id);
    res.json(result);
  });
}

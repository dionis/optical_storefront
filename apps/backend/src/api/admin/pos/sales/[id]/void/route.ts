import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { emitAlert } from "../../../../../../lib/alerts-data";
import { cleanText, listEstablishments } from "../../../../../../lib/establishments";
import { PosError, requestVoid, VOID_REASONS, voidSale, type VoidReason } from "../../../../../../lib/pos-data";
import { canVoid, posHandler, posScope, saleInScope } from "../../../../../../lib/pos-route";

/**
 * POST /admin/pos/sales/:id/void — { reason, note? } (HU-28).
 *
 * Whoever may void (owner, superadmin, supervisor, the store's manager, or a
 * person with the sale.void privilege) voids; a seller's call records the
 * request with its reason for one of them to confirm. A sale is never deleted:
 * it stays, marked voided, with its number, who, when and why.
 */
interface Body {
  reason?: string;
  note?: string;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const sale = await saleInScope(req, scope, String(req.params.id ?? ""));
    const body = (req.body ?? {}) as Body;
    const reason = (VOID_REASONS as readonly string[]).includes(String(body.reason)) ? (body.reason as VoidReason) : null;
    if (!reason) throw new PosError("bad_void_reason");
    const note = cleanText(body.note, 300);
    if (reason === "other" && !note) throw new PosError("void_note_required");

    if (!canVoid(scope)) {
      res.json({ requested: true, sale: await requestVoid(req.scope, sale, scope.user_id, reason, note) });
      return;
    }
    const { sale: voided, order_canceled } = await voidSale(req.scope, sale, scope.user_id, reason, note);
    const store = (await listEstablishments(req.scope)).find((s) => s.id === sale.establishment_id);
    await emitAlert(req.scope, {
      event: "sale.voided",
      key: `void:${sale.id}`,
      establishment_id: sale.establishment_id,
      seller_id: sale.seller_id,
      data: { number: sale.number, total: sale.total, reason, store_code: store?.code ?? null, store_name: store?.name ?? null, seller_code: sale.seller_code },
    });
    res.json({ requested: false, sale: voided, order_canceled });
  });
}

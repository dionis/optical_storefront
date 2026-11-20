import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { recordAudit } from "../../../../../../lib/audit";
import { PosError } from "../../../../../../lib/pos-data";
import { posHandler, posScope, saleInScope } from "../../../../../../lib/pos-route";
import { creatorRoleOf } from "../../../../../../lib/pos-sale-route";
import { saleEditDenied } from "../../../../../../lib/sale-permissions";
import { setSaleStoreFramePhoto } from "../../../../../../lib/store-frame-photo";

/**
 * POST /admin/pos/sales/:id/store-frame-photo { photo: data URL } — adds or
 * replaces the photo of the sale's store frame off the catalog (it then shows
 * on the receipts, the lab ticket and the sale panel). Whoever may correct
 * the sale (lib/sale-permissions.ts saleEditDenied). Answers `{ photo_url }`;
 * audited as `sale.edit` (field `store_frame_photo`).
 */
export async function POST(req: AuthenticatedMedusaRequest<{ photo?: unknown }>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const sale = await saleInScope(req, scope, String(req.params.id ?? ""));
    const denied = saleEditDenied(scope, sale, await creatorRoleOf(req.scope, sale.seller_id));
    if (denied) throw new PosError(denied, denied === "sale_voided" ? 409 : 403);
    const r = await setSaleStoreFramePhoto(req.scope, sale, (req.body ?? {}).photo);
    if ("reason" in r) throw new PosError(r.reason, r.status);
    await recordAudit(req.scope, { actorId: scope.user_id, action: "sale.edit", entity: "pos_sale", entityId: sale.id, establishmentId: sale.establishment_id, before: { number: sale.number }, after: { changed: ["store_frame_photo"] } });
    res.json({ photo_url: r.photo_url });
  });
}

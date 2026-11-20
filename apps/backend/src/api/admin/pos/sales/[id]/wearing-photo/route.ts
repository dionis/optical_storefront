import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PosError } from "../../../../../../lib/pos-data";
import { posHandler, posScope, saleForUser } from "../../../../../../lib/pos-route";
import { creatorRoleOf } from "../../../../../../lib/pos-sale-route";
import { cleanWearingPhoto, wearingPhotoDenied } from "../../../../../../lib/pos-wearing-photo";
import { readWearingPhoto, removeWearingPhoto, setWearingPhoto } from "../../../../../../lib/pos-wearing-photo-data";

/**
 * The photo of the patient wearing the frame (lib/pos-wearing-photo.ts).
 *
 * GET — the image bytes (never a link), `Cache-Control: no-store`, to whoever
 * may open the sale (the full or the collection view: the clerk handing the
 * glasses over). Audited as `sale.wearing_photo_view`. 404 `no_wearing_photo`.
 *
 * POST { photo: data URL, consent: true } — takes or replaces it; DELETE —
 * removes it. Whoever may correct the sale (removing also on a voided sale).
 * Both answer `{ sale }`.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const { sale } = await saleForUser(req, scope, String(req.params.id ?? ""));
    const obj = await readWearingPhoto(req.scope, sale, scope.user_id);
    res.setHeader("Content-Type", obj.contentType);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(obj.buffer);
  });
}

export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const { sale } = await saleForUser(req, scope, String(req.params.id ?? ""));
    const denied = wearingPhotoDenied(scope, sale, await creatorRoleOf(req.scope, sale.seller_id), "set");
    if (denied) throw new PosError(denied, denied === "sale_voided" ? 409 : 403);
    const c = cleanWearingPhoto((req.body ?? {}) as Record<string, unknown>);
    if ("reason" in c) throw new PosError(c.reason, 422);
    res.json({ sale: await setWearingPhoto(req.scope, sale, c.photo, scope.user_id) });
  });
}

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const { sale } = await saleForUser(req, scope, String(req.params.id ?? ""));
    const denied = wearingPhotoDenied(scope, sale, await creatorRoleOf(req.scope, sale.seller_id), "remove");
    if (denied) throw new PosError(denied, 403);
    res.json({ sale: await removeWearingPhoto(req.scope, sale, scope.user_id) });
  });
}

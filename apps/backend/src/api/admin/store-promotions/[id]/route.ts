import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listEstablishments } from "../../../../lib/establishments";
import { cleanPromotion } from "../../../../lib/promotions";
import { deletePromotion, listPromotions, setPromotionActive, updatePromotion } from "../../../../lib/promotions-data";

/**
 * POST   /admin/store-promotions/:id { …all fields } — edit it (same body as creating).
 * POST   /admin/store-promotions/:id { is_active } — only switch it on / off.
 * DELETE /admin/store-promotions/:id — remove it (past sales keep their copy).
 * Owner and superadmin only.
 */
export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "");
  const body = (req.body ?? {}) as Record<string, unknown>;
  const actor = req.auth_context?.actor_id ?? null;
  const onlyToggle = Object.keys(body).length === 1 && typeof body.is_active === "boolean";
  let promotion;
  if (onlyToggle) {
    promotion = await setPromotionActive(req.scope, id, body.is_active as boolean, actor);
  } else {
    const stores = (await listEstablishments(req.scope)).map((s) => s.id);
    const c = cleanPromotion(body, stores);
    if ("reason" in c) {
      res.status(422).json({ type: "invalid_data", reason: c.reason, message: "Invalid promotion." });
      return;
    }
    promotion = await updatePromotion(req.scope, id, c.promo, actor);
  }
  if (!promotion) {
    res.status(404).json({ type: "not_found", reason: "promo_not_found", message: "Promotion not found." });
    return;
  }
  res.json({ promotion, promotions: await listPromotions(req.scope) });
}

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const ok = await deletePromotion(req.scope, String(req.params.id ?? ""), req.auth_context?.actor_id ?? null);
  if (!ok) {
    res.status(404).json({ type: "not_found", reason: "promo_not_found", message: "Promotion not found." });
    return;
  }
  res.json({ promotions: await listPromotions(req.scope) });
}

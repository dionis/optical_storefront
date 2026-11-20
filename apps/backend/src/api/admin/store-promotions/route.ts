import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listEstablishments } from "../../../lib/establishments";
import { cleanPromotion, PROMO_KINDS } from "../../../lib/promotions";
import { createPromotion, listPromotions, storeToday } from "../../../lib/promotions-data";

/**
 * GET  /admin/store-promotions — every promotion with where it stands today
 *      (live | off | scheduled | ended).
 * POST /admin/store-promotions { name, kind, description?, establishment_ids?, starts_on?, ends_on?,
 *                          is_active?, pct?, buy_qty?, get_qty?, min_total?, value? } — a new one.
 *
 * Owner and superadmin only (not in the restricted roles' list). docs/PROMOCIONES.md.
 * Not /admin/promotions: that path belongs to Medusa's own promotion engine.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  res.json({ promotions: await listPromotions(req.scope), kinds: PROMO_KINDS, today: storeToday() });
}

export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  const stores = (await listEstablishments(req.scope)).map((s) => s.id);
  const c = cleanPromotion((req.body ?? {}) as Record<string, unknown>, stores);
  if ("reason" in c) {
    res.status(422).json({ type: "invalid_data", reason: c.reason, message: "Invalid promotion." });
    return;
  }
  const promotion = await createPromotion(req.scope, c.promo, req.auth_context?.actor_id ?? null);
  res.json({ promotion, promotions: await listPromotions(req.scope) });
}

import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { closeSession, getSession } from "../../../../../../lib/cash";
import { cleanText } from "../../../../../../lib/establishments";
import { canSellAt } from "../../../../../../lib/pos";
import { PosError } from "../../../../../../lib/pos-data";
import { posHandler, posScope } from "../../../../../../lib/pos-route";

/**
 * POST /admin/pos/cash-sessions/:id/close — { counted, note? } closes with the
 * count. A difference is recorded, audited and alerted (HU-32).
 */
export async function POST(req: AuthenticatedMedusaRequest<{ counted?: unknown; note?: string }>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const session = await getSession(req.scope, String(req.params.id ?? ""));
    if (!session) throw new PosError("cash_not_found", 404);
    if (!canSellAt(scope, session.establishment_id)) throw new PosError("forbidden_store", 403);
    const body = (req.body ?? {}) as { counted?: unknown; note?: string };
    const counted = Number(body.counted);
    if (!Number.isFinite(counted) || counted < 0 || counted > 1000000) throw new PosError("bad_payment");
    res.json({ session: await closeSession(req.scope, session, { countedCents: Math.round(counted * 100), note: cleanText(body.note, 300), actorId: scope.user_id, sellerCode: scope.seller_code }) });
  });
}

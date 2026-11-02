import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getSession } from "../../../../../../lib/cash";
import { sendCashEmail } from "../../../../../../lib/email/cash-emails";
import { canSellAt } from "../../../../../../lib/pos";
import { PosError } from "../../../../../../lib/pos-data";
import { posHandler, posScope } from "../../../../../../lib/pos-route";

/**
 * POST /admin/pos/cash-sessions/:id/email — { kind: "open"|"close" } re-sends
 * the opening / closing document to the owner and the admin notification
 * list. Audited (document.email). Responds { sent: n }; 0 means no admin
 * address is configured (`no_email`).
 */
export async function POST(req: AuthenticatedMedusaRequest<{ kind?: string }>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const session = await getSession(req.scope, String(req.params.id ?? ""));
    if (!session) throw new PosError("cash_not_found", 404);
    if (!canSellAt(scope, session.establishment_id)) throw new PosError("forbidden_store", 403);
    const body = (req.body ?? {}) as { kind?: string };
    const kind = body.kind === "close" ? "close" : "open";
    const sent = await sendCashEmail(req.scope, session.id, kind, { actorId: scope.user_id });
    if (!sent) throw new PosError("no_email", 422);
    res.json({ sent });
  });
}

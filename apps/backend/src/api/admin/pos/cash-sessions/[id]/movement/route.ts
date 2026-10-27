import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { addMovement, getSession } from "../../../../../../lib/cash";
import { cleanText } from "../../../../../../lib/establishments";
import { canSellAt } from "../../../../../../lib/pos";
import { PosError } from "../../../../../../lib/pos-data";
import { posHandler, posScope } from "../../../../../../lib/pos-route";

/** POST /admin/pos/cash-sessions/:id/movement — { kind: "in"|"out", amount, note } cash put in or taken out. */
export async function POST(req: AuthenticatedMedusaRequest<{ kind?: string; amount?: unknown; note?: string }>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const session = await getSession(req.scope, String(req.params.id ?? ""));
    if (!session) throw new PosError("cash_not_found", 404);
    if (!canSellAt(scope, session.establishment_id)) throw new PosError("forbidden_store", 403);
    const body = (req.body ?? {}) as { kind?: string; amount?: unknown; note?: string };
    if (body.kind !== "in" && body.kind !== "out") throw new PosError("bad_status");
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new PosError("bad_payment");
    const note = cleanText(body.note, 200);
    if (!note) throw new PosError("cash_note_required");
    res.json({ session: await addMovement(req.scope, session, { kind: body.kind, amountCents: Math.round(amount * 100), note, actorId: scope.user_id }) });
  });
}

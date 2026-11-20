import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { addMovement, getSession, isCashCategory } from "../../../../../../lib/cash";
import { cleanText } from "../../../../../../lib/establishments";
import { canSellAt } from "../../../../../../lib/pos";
import { listTerminals, PosError } from "../../../../../../lib/pos-data";
import { posHandler, posScope } from "../../../../../../lib/pos-route";

type Body = { kind?: string; amount?: unknown; category?: string; note?: string; terminal_id?: string };

/**
 * POST /admin/pos/cash-sessions/:id/movement — { kind: "in"|"out", amount,
 * category, note, terminal_id? } cash put in or taken out by hand. `category`
 * is one of CASH_CATEGORIES (reason `bad_category` otherwise); the note stays
 * required. The till is the one declared (a counter seller's own), so the
 * ledger says where the money moved.
 */
export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const session = await getSession(req.scope, String(req.params.id ?? ""));
    if (!session) throw new PosError("cash_not_found", 404);
    if (!canSellAt(scope, session.establishment_id)) throw new PosError("forbidden_store", 403);
    const body = (req.body ?? {}) as Body;
    if (body.kind !== "in" && body.kind !== "out") throw new PosError("bad_status");
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new PosError("bad_payment");
    if (!isCashCategory(body.category)) throw new PosError("bad_category");
    const note = cleanText(body.note, 200);
    if (!note) throw new PosError("cash_note_required");
    let terminalId: string | null = scope.seller?.terminal_id ?? null;
    if (!terminalId && typeof body.terminal_id === "string" && body.terminal_id) {
      const t = (await listTerminals(req.scope, [session.establishment_id])).find((x) => x.id === body.terminal_id);
      if (!t) throw new PosError("bad_terminal");
      terminalId = t.id;
    }
    res.json({
      session: await addMovement(req.scope, session, { kind: body.kind, amountCents: Math.round(amount * 100), category: body.category, note, actorId: scope.user_id, terminalId }),
    });
  });
}

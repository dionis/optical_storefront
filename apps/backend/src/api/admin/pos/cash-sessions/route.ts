import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listSessions, openSession } from "../../../../lib/cash";
import { cleanText } from "../../../../lib/establishments";
import { posHandler, posScope, scopeStoreIds, sellableStore } from "../../../../lib/pos-route";
import { PosError } from "../../../../lib/pos-data";

/**
 * CAJA (HU-32) — the STORE's register (owner, 2026-11: one opening and one
 * closing per store, not per till).
 *
 *   GET  /admin/pos/cash-sessions?store= — the open / pending / recent sessions
 *        of the user's stores, each with its ledger (movements with who, till,
 *        sale) so the panel needs one call.
 *   POST /admin/pos/cash-sessions — { store, opening, signature, note? } opens
 *        the store's register with the float and the opener's initials
 *        (2–4 letters, `cash_signature_required`). One open per store
 *        (`cash_already_open`). Every role that sells at the store may open:
 *        the owner's rule is that the opening is the operator's first act —
 *        and the first cash payment opens it on its own anyway.
 *
 * Each opening is audited (cash.open) and mailed to the owner (cash-emails.ts).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const q = req.query as Record<string, string | undefined>;
    const ids = q.store ? [(await sellableStore(req, scope, q.store)).id] : await scopeStoreIds(req, scope);
    const take = Math.min(200, Math.max(1, Number(q.limit) || 30));
    const sessions = ids && !ids.length ? [] : await listSessions(req.scope, ids, take);
    res.json({ sessions });
  });
}

type Body = { store?: string; establishment_id?: string; opening?: unknown; signature?: unknown; note?: string; terminal_id?: string };

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const body = (req.body ?? {}) as Body;
    const store = await sellableStore(req, scope, body.store ?? body.establishment_id);
    const opening = Number(body.opening ?? 0);
    if (!Number.isFinite(opening) || opening < 0 || opening > 100000) throw new PosError("bad_payment");
    const session = await openSession(req.scope, {
      establishmentId: store.id,
      openingCents: Math.round(opening * 100),
      actorId: scope.user_id,
      signature: typeof body.signature === "string" ? body.signature : "",
      note: cleanText(body.note, 200),
      terminalId: typeof body.terminal_id === "string" && body.terminal_id ? body.terminal_id : scope.seller?.terminal_id ?? null,
    });
    res.json({ session });
  });
}

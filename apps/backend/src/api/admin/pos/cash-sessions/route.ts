import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listSessions, openSession } from "../../../../lib/cash";
import { posHandler, posScope, scopeStoreIds, sellableStore } from "../../../../lib/pos-route";
import { PosError } from "../../../../lib/pos-data";
import { sellerTillProblem } from "../../../../lib/pos";

/**
 * CAJA (HU-32).
 *
 *   GET  /admin/pos/cash-sessions?store= — cajas abiertas y recientes de las tiendas del usuario.
 *   POST /admin/pos/cash-sessions — { store, terminal_id, opening } abre la caja
 *        de un punto de venta con el fondo inicial. Una abierta por punto de venta.
 *
 * El efectivo cobrado en ese punto de venta mientras está abierta entra solo.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const q = req.query as Record<string, string | undefined>;
    const ids = q.store ? [(await sellableStore(req, scope, q.store)).id] : await scopeStoreIds(req, scope);
    res.json({ sessions: ids && !ids.length ? [] : await listSessions(req.scope, ids) });
  });
}

export async function POST(req: AuthenticatedMedusaRequest<{ store?: string; terminal_id?: string; opening?: unknown }>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const body = (req.body ?? {}) as { store?: string; terminal_id?: string; opening?: unknown };
    const store = await sellableStore(req, scope, body.store);
    // A counter seller opens only the register of their own till.
    const till = sellerTillProblem(scope, store.id, String(body.terminal_id ?? ""));
    if (till) throw new PosError(till, 403);
    const opening = Number(body.opening ?? 0);
    if (!Number.isFinite(opening) || opening < 0 || opening > 100000) throw new PosError("bad_payment");
    res.json({ session: await openSession(req.scope, { establishmentId: store.id, terminalId: String(body.terminal_id ?? ""), openingCents: Math.round(opening * 100), actorId: scope.user_id }) });
  });
}

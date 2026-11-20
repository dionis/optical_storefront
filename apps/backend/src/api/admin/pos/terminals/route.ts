import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { cleanText } from "../../../../lib/establishments";
import { createTerminal, listTerminals, PosError, terminalUsage } from "../../../../lib/pos-data";
import { managesStore, posHandler, posScope, scopeStoreIds, sellableStore } from "../../../../lib/pos-route";

/**
 * PUNTOS DE VENTA de cada tienda (HU-80): Op2-POS1, Op2-POS2…
 *
 *   GET  /admin/pos/terminals?store=&usage=1 — los de las tiendas del usuario;
 *        con `usage=1` cada uno trae su uso (ventas, cajas, vendedores), que
 *        decide si se puede eliminar o desactivar.
 *   POST /admin/pos/terminals — { store, name?, receipt_locale?, ticket_locale? }
 *        Dueño, superadmin o el encargado de esa tienda (matriz de permisos).
 *        El código lo asigna el servidor y nunca se reutiliza.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const q = req.query as Record<string, string | undefined>;
    const ids = q.store ? [(await sellableStore(req, scope, q.store)).id] : await scopeStoreIds(req, scope);
    const terminals = ids && !ids.length ? [] : await listTerminals(req.scope, ids);
    if (q.usage !== "1") {
      res.json({ terminals });
      return;
    }
    const usage = await terminalUsage(req.scope, terminals.map((t) => t.id));
    res.json({ terminals: terminals.map((t) => ({ ...t, usage: usage.get(t.id) })) });
  });
}

interface Body {
  store?: string;
  name?: string;
  receipt_locale?: string;
  ticket_locale?: string;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const body = (req.body ?? {}) as Body;
    const scope = await posScope(req);
    const store = await sellableStore(req, scope, body.store);
    if (!managesStore(scope, store.id)) throw new PosError("forbidden_role", 403);
    const terminal = await createTerminal(
      req.scope,
      store,
      { name: cleanText(body.name, 60), receipt_locale: body.receipt_locale, ticket_locale: body.ticket_locale },
      scope.user_id
    );
    res.json({ terminal, terminals: await listTerminals(req.scope, [store.id]) });
  });
}

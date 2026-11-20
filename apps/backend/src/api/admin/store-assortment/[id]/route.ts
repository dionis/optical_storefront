import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listEstablishments } from "../../../../lib/establishments";
import { storeAssortment } from "../../../../lib/store-assortment-data";

/**
 * GET /admin/store-assortment/:id — surtido de una tienda: cada marca del
 * catálogo con cuántos modelos expone y su regla, y las excepciones por modelo.
 *
 * Una tienda nueva expone todo (decisión del dueño); solo el dueño y los
 * superadmin llegan aquí (lib/staff-guard.ts). Errores con `reason`; el panel
 * traduce con adm.err.assortment.<reason>.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "");
  const store = (await listEstablishments(req.scope)).find((e) => e.id === id);
  if (!store) {
    res.status(404).json({ type: "not_found", reason: "store_not_found", message: "Store not found." });
    return;
  }
  res.json({ establishment: store, ...(await storeAssortment(req.scope, id)) });
}

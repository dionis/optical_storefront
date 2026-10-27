import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listClaims } from "../../../../../lib/pos-data";
import { posHandler, posScope, saleInScope } from "../../../../../lib/pos-route";

/**
 * GET /admin/pos/sales/:id — one sale of the user's stores, with its payments
 * and what insurers owe on it. Opened from "Cobrar saldo" by number or
 * customer, so a seller can open a colleague's sale of the same store.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const sale = await saleInScope(req, scope, String(req.params.id ?? ""));
    const claims = (await listClaims(req.scope, { establishmentIds: [sale.establishment_id] })).filter((c) => c.sale_id === sale.id);
    res.json({ sale, insurance_claims: claims.map((c) => ({ id: c.id, payer_name: c.payer_name, covered: c.covered, status: c.status })) });
  });
}

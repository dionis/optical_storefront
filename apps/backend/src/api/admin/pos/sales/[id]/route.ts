import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listClaims } from "../../../../../lib/pos-data";
import { customerContacts, limitedSale, posHandler, posScope, saleForUser } from "../../../../../lib/pos-route";

/**
 * GET /admin/pos/sales/:id — one sale of the user's stores, with its payments
 * and what insurers owe on it. For a seller (owner's rule, lib/pos-route.ts
 * saleAccessFor): their own sale in full; a colleague's sale of their store
 * only while it owes money, reduced to the collection view (`limited: true`,
 * with its payments); anything else is 403 `forbidden_sale`.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const { sale, access } = await saleForUser(req, scope, String(req.params.id ?? ""));
    if (access === "limited") {
      const contacts = await customerContacts(req.scope, [sale.customer_id]);
      res.json({ sale: limitedSale(sale, sale.customer_id ? contacts.get(sale.customer_id) : null, true), insurance_claims: [] });
      return;
    }
    const claims = (await listClaims(req.scope, { establishmentIds: [sale.establishment_id] })).filter((c) => c.sale_id === sale.id);
    res.json({ sale, insurance_claims: claims.map((c) => ({ id: c.id, payer_name: c.payer_name, covered: c.covered, status: c.status })) });
  });
}

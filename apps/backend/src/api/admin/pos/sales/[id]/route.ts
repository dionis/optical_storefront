import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listClaims, PosError } from "../../../../../lib/pos-data";
import { customerContacts, limitedSale, posHandler, posScope, saleForUser, saleInScope } from "../../../../../lib/pos-route";
import { updateSaleDetails, type SaleDetailsPatch } from "../../../../../lib/pos-sale-admin";
import { creatorRoleOf } from "../../../../../lib/pos-sale-route";
import { saleEditDenied, salePermissions } from "../../../../../lib/sale-permissions";

/**
 * GET /admin/pos/sales/:id — one sale of the user's stores, with its payments
 * and what insurers owe on it. For a seller (owner's rule, lib/pos-route.ts
 * saleAccessFor): their own sale in full; a colleague's sale of their store
 * only while it owes money, reduced to the collection view (`limited: true`,
 * with its payments); anything else is 403 `forbidden_sale`.
 *
 * The full view also says what the person may do with the sale afterwards
 * (`permissions`: can_edit, can_delete, can_move — lib/sale-permissions.ts).
 * The panel only offers those; each route checks again.
 *
 * POST /admin/pos/sales/:id — corrects the sale's details (lib/pos-sale-admin.ts
 * updateSaleDetails): { customer?, delivery?, promised_on?, internal_note?,
 * prescription? }. Allowed to the person who made the sale and to anyone above
 * their role in that store; never changes lines, prices or payments.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const { sale, access } = await saleForUser(req, scope, String(req.params.id ?? ""));
    if (access === "limited") {
      const contacts = await customerContacts(req.scope, [sale.customer_id]);
      res.json({ sale: limitedSale(sale, sale.customer_id ? contacts.get(sale.customer_id) : null, true), insurance_claims: [], permissions: { can_edit: false, can_delete: false, can_move: false } });
      return;
    }
    const [claims, creatorRole] = await Promise.all([
      listClaims(req.scope, { establishmentIds: [sale.establishment_id] }),
      creatorRoleOf(req.scope, sale.seller_id),
    ]);
    res.json({
      sale,
      insurance_claims: claims.filter((c) => c.sale_id === sale.id).map((c) => ({ id: c.id, payer_name: c.payer_name, covered: c.covered, status: c.status })),
      permissions: salePermissions(scope, sale, creatorRole),
    });
  });
}

export async function POST(req: AuthenticatedMedusaRequest<SaleDetailsPatch>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const sale = await saleInScope(req, scope, String(req.params.id ?? ""));
    const denied = saleEditDenied(scope, sale, await creatorRoleOf(req.scope, sale.seller_id));
    if (denied) throw new PosError(denied, denied === "sale_voided" ? 409 : 403);
    const result = await updateSaleDetails(req.scope, sale, (req.body ?? {}) as SaleDetailsPatch, scope.user_id);
    res.json(result);
  });
}

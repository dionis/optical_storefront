import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PosError } from "../../../../../../lib/pos-data";
import { posHandler, posScope } from "../../../../../../lib/pos-route";
import { getSaleAnyState, restoreSale } from "../../../../../../lib/pos-sale-admin";
import { saleAdminDenied } from "../../../../../../lib/sale-permissions";

/**
 * POST /admin/pos/sales/:id/restore — brings back a deleted sale, exactly as
 * it was hidden (lib/pos-sale-admin.ts restoreSale). Owner and superadmin only.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const denied = saleAdminDenied(scope);
    if (denied) throw new PosError(denied, 403);
    const sale = await getSaleAnyState(req.scope, String(req.params.id ?? ""));
    if (!sale) throw new PosError("sale_not_found", 404);
    res.json({ sale: await restoreSale(req.scope, sale, scope.user_id) });
  });
}

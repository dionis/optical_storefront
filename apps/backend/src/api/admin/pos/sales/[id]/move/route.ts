import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listEstablishments } from "../../../../../../lib/establishments";
import { PosError } from "../../../../../../lib/pos-data";
import { posHandler, posScope, saleInScope } from "../../../../../../lib/pos-route";
import { moveSale } from "../../../../../../lib/pos-sale-admin";
import { saleMoveDenied } from "../../../../../../lib/sale-permissions";

/**
 * POST /admin/pos/sales/:id/move — { store }. Owner and superadmin only. The
 * sale takes the next number of the destination store; the old number stays
 * in `previous_numbers` (lib/pos-sale-admin.ts moveSale).
 */
interface Body {
  store?: string;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const sale = await saleInScope(req, scope, String(req.params.id ?? ""));
    const storeId = String(((req.body ?? {}) as Body).store ?? "");
    const target = (await listEstablishments(req.scope)).find((s) => s.id === storeId) ?? null;
    const denied = saleMoveDenied(scope, sale, target);
    if (denied) throw new PosError(denied, denied === "admin_only" ? 403 : denied === "store_not_found" ? 404 : 409);
    res.json({ sale: await moveSale(req.scope, sale, target!, scope.user_id) });
  });
}

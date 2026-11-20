import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listEstablishments } from "../../../lib/establishments";
import { sellableStores } from "../../../lib/pos";
import { PosError } from "../../../lib/pos-data";
import { posHandler, posScope, sellableStore } from "../../../lib/pos-route";
import { storeStatus } from "../../../lib/store-status";

/**
 * GET /admin/store-status?store=est_… — the state of one store right now
 * (lib/store-status.ts). Owner and superadmins see any store; supervisors and
 * managers, theirs. Without `store` it answers for the first store in scope.
 * Sellers have their own panel (/admin/sales-analytics/me), not this one.
 * The response also lists the stores the user may pick from.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    if (!scope.is_admin && scope.role !== "supervisor" && scope.role !== "manager") throw new PosError("forbidden_role", 403);
    const stores = sellableStores(scope, await listEstablishments(req.scope));
    const q = req.query as Record<string, string | undefined>;
    const store = q.store ? await sellableStore(req, scope, q.store) : stores[0];
    if (!store) throw new PosError("store_not_found", 404);
    res.json({
      stores: stores.map((s) => ({ id: s.id, code: s.code, name: s.name })),
      status: await storeStatus(req.scope, store),
    });
  });
}

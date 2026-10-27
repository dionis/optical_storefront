import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { canSellAt } from "../../../../lib/pos";
import { listClaims, PosError } from "../../../../lib/pos-data";
import { managesStore, posHandler, posScope, scopeStoreIds } from "../../../../lib/pos-route";

/**
 * GET /admin/pos/insurance-claims?status=pending&store= — what insurers owe
 * (HU-114): the owner sees every store, a manager their store. Member and
 * authorization numbers stay here, never on receipts, alerts or Sheets.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const q = req.query as Record<string, string | undefined>;
    let ids = await scopeStoreIds(req, scope);
    if (q.store) {
      if (!canSellAt(scope, q.store)) throw new PosError("forbidden_store", 403);
      ids = [q.store];
    }
    if (ids) ids = ids.filter((id) => managesStore(scope, id));
    if (ids && !ids.length) throw new PosError("forbidden_role", 403);
    const status = q.status && ["pending", "submitted", "paid", "rejected"].includes(q.status) ? q.status : undefined;
    const claims = await listClaims(req.scope, { establishmentIds: ids, status });
    res.json({ claims, owed: claims.filter((c) => c.status === "pending" || c.status === "submitted").reduce((s, c) => s + c.covered, 0) });
  });
}

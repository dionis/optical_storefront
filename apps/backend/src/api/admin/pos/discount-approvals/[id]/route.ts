import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { canSellAt } from "../../../../../lib/pos";
import { getApproval, PosError } from "../../../../../lib/pos-data";
import { posHandler, posScope } from "../../../../../lib/pos-route";

/**
 * GET /admin/pos/discount-approvals/:id — the till polls its request until the
 * owner or a superadmin decides. Visible to whoever asked and to admins.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    const approval = await getApproval(req.scope, String(req.params.id ?? ""));
    if (!approval) throw new PosError("approval_not_found", 404);
    if (!scope.is_admin && (approval.requested_by !== scope.user_id || !canSellAt(scope, approval.establishment_id))) {
      throw new PosError("forbidden_store", 403);
    }
    res.json({ approval });
  });
}

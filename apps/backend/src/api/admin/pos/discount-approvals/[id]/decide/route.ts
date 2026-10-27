import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { cleanText } from "../../../../../../lib/establishments";
import { decideApproval, PosError } from "../../../../../../lib/pos-data";
import { posHandler, posScope } from "../../../../../../lib/pos-route";

/**
 * POST /admin/pos/discount-approvals/:id/decide — { decision: "approved" |
 * "rejected", note? }. Only the owner or a superadmin (owner's decision, not
 * delegable): the route is not on the restricted roles' list, and the check
 * below repeats it so a future allowlist change cannot open it by accident.
 */
interface Body {
  decision?: string;
  note?: string;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    if (!scope.is_admin) throw new PosError("approver_only", 403);
    const body = (req.body ?? {}) as Body;
    if (body.decision !== "approved" && body.decision !== "rejected") throw new PosError("bad_decision");
    const approval = await decideApproval(req.scope, String(req.params.id ?? ""), body.decision, scope.user_id, cleanText(body.note, 300));
    res.json({ approval });
  });
}

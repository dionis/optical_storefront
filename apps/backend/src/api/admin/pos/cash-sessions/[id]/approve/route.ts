import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { approveSession, getSession } from "../../../../../../lib/cash";
import { PosError } from "../../../../../../lib/pos-data";
import { posHandler, posScope } from "../../../../../../lib/pos-route";

/**
 * POST /admin/pos/cash-sessions/:id/approve — { approval_signature } the owner
 * (or a superadmin) authorises a closing with a difference, signing with
 * their initials. Owner's rule: "if there is a discrepancy only the owner
 * authorises with his signature". Not allow-listed for restricted roles.
 */
export async function POST(req: AuthenticatedMedusaRequest<{ approval_signature?: unknown }>, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    if (!scope.is_admin) throw new PosError("forbidden_role", 403);
    const session = await getSession(req.scope, String(req.params.id ?? ""));
    if (!session) throw new PosError("cash_not_found", 404);
    const body = (req.body ?? {}) as { approval_signature?: unknown };
    res.json({ session: await approveSession(req.scope, session, { approvalSignature: body.approval_signature, actorId: scope.user_id }) });
  });
}

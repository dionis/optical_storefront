import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getStaffScope } from "../../../../lib/staff-scope";

/**
 * GET /admin/me/scope — what the signed-in user may see and do: role, stores,
 * personal discount limit. The panel decides which screens to show from this;
 * the server enforces the same thing on every request (lib/staff-guard.ts).
 * Reachable by every role.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const actorId = req.auth_context?.actor_id ?? "";
  const scope = await getStaffScope(req.scope, actorId);
  res.json({ scope });
}

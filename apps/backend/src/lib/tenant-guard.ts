import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getStaffScope } from "./staff-scope";

/**
 * Owner or superadmin, for the /admin/tenant* routes. staffGuard already keeps
 * other roles out of /admin/tenant; this repeats it so the routes do not depend
 * on that list. Answers 403 itself and returns null when the actor may not pass.
 */
export async function requireTenantAdmin(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<string | null> {
  const actorId = req.auth_context?.actor_id ?? "";
  const scope = actorId ? await getStaffScope(req.scope, actorId) : null;
  if (!scope?.is_admin) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can change the store." });
    return null;
  }
  return actorId;
}

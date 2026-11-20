import type { AuthenticatedMedusaRequest } from "@medusajs/framework/http";
import { hasPrivilege } from "./staff-profile";
import { getStaffScope } from "./staff-scope";

/**
 * Who may see and change the cost of a frame model.
 *
 * `/admin/pricing/*` is already out of reach of the restricted roles (it is
 * not in `RESTRICTED_ALLOWED`, lib/staff-roles.ts), so without this the routes
 * would be owner/superadmin only. These two are checked here instead, with the
 * same privileges the rest of the cost screens use (lib/store-costs-route.ts):
 *
 *   read  — «Ver costos» (costs.view) or «Gestionar costos» (costs.manage)
 *   write — «Gestionar costos» (costs.manage)
 *
 * `hasPrivilege` lets admins through implicitly, so the owner needs no grant.
 * Returns a `reason` code to answer 403 with, or null when allowed.
 */
export async function frameCostsDenied(
  req: AuthenticatedMedusaRequest,
  mode: "read" | "write"
): Promise<string | null> {
  const userId = req.auth_context?.actor_id;
  if (!userId) return "forbidden_role";
  const scope = await getStaffScope(req.scope, userId);
  if (mode === "write") return hasPrivilege(scope, "costs.manage") ? null : "forbidden_role";
  return hasPrivilege(scope, "costs.view") || hasPrivilege(scope, "costs.manage") ? null : "forbidden_role";
}

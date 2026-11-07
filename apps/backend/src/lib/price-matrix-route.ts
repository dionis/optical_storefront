import type { AuthenticatedMedusaRequest } from "@medusajs/framework/http";
import { hasPrivilege } from "./staff-profile";
import { getStaffScope } from "./staff-scope";

/**
 * Who may do what on «Productos y precios» (docs/PRICE-MATRIX.md).
 *
 * `/admin/pricing/*` and `/admin/catalog/*` have no entry in
 * `RESTRICTED_ALLOWED` (lib/staff-roles.ts), so the staff guard already
 * refuses every restricted role before a route runs; these routes repeat the
 * check for WRITES (owner and superadmin only — `is_admin`), and gate the cost
 * on the privileges every cost screen uses:
 *
 *   see costs     «Ver costos» (costs.view) or «Gestionar costos» (costs.manage)
 *   change costs  «Gestionar costos» (costs.manage)
 *
 * `hasPrivilege` lets admins through implicitly, so the owner needs no grant.
 */
export interface MatrixAccess {
  actorId: string | null;
  isAdmin: boolean;
  canSeeCosts: boolean;
  canManageCosts: boolean;
}

export async function matrixAccess(req: AuthenticatedMedusaRequest): Promise<MatrixAccess> {
  const actorId = req.auth_context?.actor_id ?? null;
  if (!actorId) return { actorId: null, isAdmin: false, canSeeCosts: false, canManageCosts: false };
  const scope = await getStaffScope(req.scope, actorId);
  return {
    actorId,
    isAdmin: scope.is_admin === true,
    canSeeCosts: hasPrivilege(scope, "costs.view") || hasPrivilege(scope, "costs.manage"),
    canManageCosts: hasPrivilege(scope, "costs.manage"),
  };
}

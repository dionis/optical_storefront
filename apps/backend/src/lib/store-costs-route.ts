import type { AuthenticatedMedusaRequest } from "@medusajs/framework/http";
import { listEstablishments } from "./establishments";
import { sellableStores } from "./pos";
import { PosError } from "./pos-data";
import { getStaffScope, type StaffScope } from "./staff-scope";

/**
 * Costs are edited with the costs.manage privilege and read with costs.view
 * (functional document: granted person by person, whatever the role; the
 * guard checks the privilege). Admins see every store and the shared costs;
 * a privileged person, the stores they work in.
 */
export async function costScope(req: AuthenticatedMedusaRequest): Promise<{ scope: StaffScope; storeIds: string[] | null }> {
  const userId = req.auth_context?.actor_id;
  if (!userId) throw new PosError("forbidden_role", 403);
  const scope = await getStaffScope(req.scope, userId);
  if (scope.is_admin) return { scope, storeIds: null };
  return { scope, storeIds: sellableStores(scope, await listEstablishments(req.scope)).map((s) => s.id) };
}

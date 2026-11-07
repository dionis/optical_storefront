import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listPatients, type PatientSort } from "../../../lib/patient-history-data";
import { PosError } from "../../../lib/pos-data";
import { posHandler, posScope, scopeStoreIds } from "../../../lib/pos-route";
import type { StaffScope } from "../../../lib/staff-scope";

/** Who opens patient files: owner, superadmin, supervisor and manager. A seller keeps the till's view. */
export const canSeePatients = (scope: Pick<StaffScope, "is_admin" | "role">): boolean =>
  scope.is_admin || scope.role === "supervisor" || scope.role === "manager";

/**
 * GET /admin/patients?q=&store=&sort=recent|total|purchases|avg&limit= → { patients, truncated }
 *
 * The «Pacientes» list (docs/PATIENTS.md): purchases, total spent, average
 * ticket, last purchase and band of each patient, from sale_fact (POS + web,
 * voided sales excluded). `store` narrows to patients who bought there; a
 * supervisor or manager only ever sees patients of their stores. Reasons:
 * `forbidden_role` (403), `forbidden_store` (403).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    if (!canSeePatients(scope)) throw new PosError("forbidden_role", 403);
    const query = req.query as Record<string, unknown>;
    const mine = await scopeStoreIds(req, scope);
    const store = typeof query.store === "string" && query.store && query.store !== "all" ? query.store : "";
    let storeIds = mine;
    if (store) {
      if (mine && !mine.includes(store)) throw new PosError("forbidden_store", 403);
      storeIds = [store];
    }
    const out = await listPatients(req.scope, {
      q: typeof query.q === "string" ? query.q : "",
      storeIds,
      sort: query.sort as PatientSort,
      limit: Number(query.limit) || undefined,
    });
    res.json(out);
  });
}

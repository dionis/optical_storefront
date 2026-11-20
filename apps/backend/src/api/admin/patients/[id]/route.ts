import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { recordAudit } from "../../../../lib/audit";
import { patientFile } from "../../../../lib/patient-history-data";
import { PosError } from "../../../../lib/pos-data";
import { posHandler, posScope, scopeStoreIds } from "../../../../lib/pos-route";
import { canSeePatients } from "../route";

/**
 * GET /admin/patients/:id → { customer, summary, purchases, last_prescription, history, exam }
 *
 * One patient's file: their data, totals and average ticket, every purchase
 * (POS and web, voided ones flagged), how their prescription changed and when
 * the next exam is due. Prescriptions are health data: the file is for the
 * people who serve the patient, never for receipts, emails or Sheets, and each
 * opening is written to the audit log (`patient.view`). A supervisor or
 * manager opens only patients who bought in one of their stores. Reasons:
 * `forbidden_role` (403), `customer_not_found` (404).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const scope = await posScope(req);
    if (!canSeePatients(scope)) throw new PosError("forbidden_role", 403);
    const id = String(req.params.id ?? "");
    const file = await patientFile(req.scope, id);
    if (!file) throw new PosError("customer_not_found", 404);
    const mine = await scopeStoreIds(req, scope);
    // Outside their stores the patient does not exist for them (no hint that it does).
    if (mine && !file.purchases.some((p) => p.establishment_id && mine.includes(p.establishment_id))) throw new PosError("customer_not_found", 404);
    await recordAudit(req.scope, { actorId: req.auth_context?.actor_id ?? null, action: "patient.view", entity: "customer", entityId: id });
    res.json(file);
  });
}

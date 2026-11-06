import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { recordAudit } from "../../../../../lib/audit";
import { cleanPayrollPatch, payrollAuditDetail, type PayrollPatchInput } from "../../../../../lib/staff-payroll";
import { payrollOf, savePayroll } from "../../../../../lib/staff-payroll-data";

/**
 * MIS DATOS DE PAGO: cada persona pone (o corrige) su número fiscal y su
 * cuenta sin que nadie más tenga que teclearlos — cuantas menos manos pasen
 * por un SSN, mejor. Mismas garantías que la ruta del dueño: se guarda
 * cifrado, nunca se devuelve completo y todo cambio queda en Auditoría.
 *
 * Abierta a todos los roles (lib/staff-roles.ts), pero siempre sobre uno
 * mismo: el id sale del token, no del cuerpo.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  res.json({ payroll: await payrollOf(req.scope, req.auth_context?.actor_id ?? "") });
}

export async function POST(req: AuthenticatedMedusaRequest<PayrollPatchInput>, res: MedusaResponse): Promise<void> {
  const userId = req.auth_context?.actor_id ?? "";
  const cleaned = cleanPayrollPatch(req.body ?? {});
  if ("reason" in cleaned) {
    res.status(422).json({ type: "invalid_data", reason: cleaned.reason, field: cleaned.field, message: `Payroll: ${cleaned.reason}` });
    return;
  }
  let payroll;
  try {
    payroll = await savePayroll(req.scope, userId, cleaned.patch, userId);
  } catch (e) {
    if ((e as Error).message === "payroll_key_missing") {
      res.status(503).json({ type: "not_allowed", reason: "payroll_key_missing", message: "Payroll encryption key is not configured." });
      return;
    }
    throw e;
  }
  if (Object.keys(cleaned.patch).length) {
    await recordAudit(req.scope, { actorId: userId, action: "payroll.change", entity: "staff_profile", entityId: userId, before: null, after: payrollAuditDetail(cleaned.patch) });
  }
  res.json({ payroll });
}

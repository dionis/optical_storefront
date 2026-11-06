import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IUserModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { recordAudit } from "../../../../../lib/audit";
import { cleanPayrollPatch, payrollAuditDetail, type PayrollPatchInput } from "../../../../../lib/staff-payroll";
import { payrollOf, savePayroll } from "../../../../../lib/staff-payroll-data";

/**
 * DATOS DE PAGO de una persona del equipo: cómo cobra, su número fiscal
 * (SSN/ITIN/EIN) y su cuenta bancaria.
 *
 *   GET  → lo que se puede enseñar: método, banco, titular y «•••• 1234».
 *   POST → guarda; los números llegan completos UNA vez y se guardan cifrados.
 *
 * Tres cosas que no hace esta ruta, a propósito:
 *  · No devuelve nunca un número completo (no hay «ver» ni «copiar»): si se
 *    perdió, se vuelve a escribir. Una ruta que lo devuelva convierte cualquier
 *    sesión robada en una filtración de SSN.
 *  · No guarda nada si el despliegue no tiene `PAYROLL_ENCRYPTION_KEY`:
 *    responde 503 `payroll_key_missing` y el panel lo explica.
 *  · No escribe los valores en el registro de auditoría: solo qué campos
 *    cambiaron y los últimos 4 dígitos.
 *
 * Solo dueño y superadmin (/admin/team/* no está abierto a los demás roles).
 */
async function loadUser(req: AuthenticatedMedusaRequest) {
  const users = req.scope.resolve<IUserModuleService>(Modules.USER);
  return users.retrieveUser(String(req.params.id ?? "")).catch(() => null);
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const user = await loadUser(req);
  if (!user) {
    res.status(404).json({ type: "not_found", reason: "not_found", message: "User not found." });
    return;
  }
  res.json({ payroll: await payrollOf(req.scope, user.id) });
}

export async function POST(req: AuthenticatedMedusaRequest<PayrollPatchInput>, res: MedusaResponse): Promise<void> {
  const user = await loadUser(req);
  if (!user) {
    res.status(404).json({ type: "not_found", reason: "not_found", message: "User not found." });
    return;
  }
  const cleaned = cleanPayrollPatch(req.body ?? {});
  if ("reason" in cleaned) {
    res.status(422).json({ type: "invalid_data", reason: cleaned.reason, field: cleaned.field, message: `Payroll: ${cleaned.reason}` });
    return;
  }
  const actorId = req.auth_context?.actor_id ?? null;
  let payroll;
  try {
    payroll = await savePayroll(req.scope, user.id, cleaned.patch, actorId);
  } catch (e) {
    if ((e as Error).message === "payroll_key_missing") {
      res.status(503).json({ type: "not_allowed", reason: "payroll_key_missing", message: "Payroll encryption key is not configured." });
      return;
    }
    throw e;
  }
  if (Object.keys(cleaned.patch).length) {
    await recordAudit(req.scope, {
      actorId,
      action: "payroll.change",
      entity: "staff_profile",
      entityId: user.id,
      before: null,
      after: payrollAuditDetail(cleaned.patch),
    });
  }
  res.json({ payroll });
}

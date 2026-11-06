import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { getStaffScope } from "../../../../lib/staff-scope";
import { readSetupChecklist } from "../../../../lib/tenant-setup";

/**
 * GET /admin/tenant/setup — «Primeros pasos» (docs/MULTI-TENANT-TECNICO.md §7.3).
 *
 * Cada paso dice si está hecho (`ok`: true/false/null = no se pudo comprobar) y
 * qué pestaña lo arregla. Terminar el asistente es POST /admin/tenant con
 * `setup_completed: true`. Solo dueño y superadmin.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const actorId = req.auth_context?.actor_id ?? "";
  const scope = actorId ? await getStaffScope(req.scope, actorId) : null;
  if (!scope?.is_admin) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can see the setup." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json(await readSetupChecklist(req.scope));
}

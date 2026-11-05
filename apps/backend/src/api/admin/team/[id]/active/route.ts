import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { setUserDisabled } from "../../../../../lib/session-control";
import { getStaffScope } from "../../../../../lib/staff-scope";
import { listTeam } from "../../route";

/**
 * POST /admin/team/:id/active { active: boolean } — desactiva o reactiva a una
 * persona SIN borrarla (M3: «desactivar sin borrar»). Desactivada no puede usar
 * el panel (el guardia responde 403 `disabled` a todo) y pierde sus sesiones;
 * sus ventas, roles, perfil y auditoría quedan intactos, y al reactivarla
 * vuelve con la misma cuenta. Mismos vetos que borrar: no al dueño, no a uno
 * mismo, y a un superadmin solo el dueño.
 */
interface Body {
  active?: boolean;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const targetId = String(req.params.id ?? "");
  const actorId = req.auth_context?.actor_id ?? "";
  const active = (req.body as Body | undefined)?.active;
  if (typeof active !== "boolean") {
    res.status(422).json({ type: "invalid_data", reason: "bad_active", message: "`active` must be true or false." });
    return;
  }
  const actor = await getStaffScope(req.scope, actorId);
  if (!actor.is_admin) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can deactivate users." });
    return;
  }
  const team = await listTeam(req);
  const target = team.find((m) => m.id === targetId);
  if (!target) {
    res.status(404).json({ type: "not_found", reason: "not_found", message: "User not found." });
    return;
  }
  if (target.is_super) {
    res.status(403).json({ type: "not_allowed", reason: "super_admin", message: "The super admin cannot be deactivated." });
    return;
  }
  if (target.id === actorId) {
    res.status(403).json({ type: "not_allowed", reason: "self", message: "You cannot deactivate your own account." });
    return;
  }
  if (target.role === "superadmin" && actor.role !== "owner") {
    res.status(403).json({ type: "not_allowed", reason: "owner_only", message: "Only the owner can deactivate a superadmin." });
    return;
  }
  const control = await setUserDisabled(req.scope, { userId: targetId, disabled: !active, actorId });
  logger.info(`[team] ${target.email} ${active ? "reactivated" : "deactivated"} by ${actorId}`);
  res.json({ ok: true, disabled_at: control.disabled_at, team: await listTeam(req) });
}

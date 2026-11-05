import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { revokeSessions } from "../../../../../lib/session-control";
import { passwordResetDenied } from "../../../../../lib/staff-roles";
import { getStaffScope } from "../../../../../lib/staff-scope";
import { listTeam } from "../../route";

/**
 * DELETE /admin/team/:id/sessions — cierra la sesión de una persona en TODOS
 * sus equipos (M3: «cierre de sesión remoto»). Quien puede restablecer su
 * contraseña (dueño o superadmin, nunca sobre sí mismo: para eso está
 * /admin/team/me/sessions) puede también echarla. La cuenta sigue activa: la
 * persona vuelve a entrar con su contraseña de siempre.
 */
export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const targetId = String(req.params.id ?? "");
  const actorId = req.auth_context?.actor_id ?? "";
  const actor = await getStaffScope(req.scope, actorId);
  const denied = passwordResetDenied({ actorRole: actor.role, actorId, targetId });
  if (denied) {
    res.status(403).json({ type: "not_allowed", reason: denied, message: `Cannot sign this user out: ${denied}.` });
    return;
  }
  const team = await listTeam(req);
  const target = team.find((m) => m.id === targetId);
  if (!target) {
    res.status(404).json({ type: "not_found", reason: "not_found", message: "User not found." });
    return;
  }
  const at = await revokeSessions(req.scope, { userId: targetId, actorId, reason: "remote_logout" });
  logger.info(`[team] sessions of ${target.email} revoked by ${actorId}`);
  res.json({ ok: true, sessions_revoked_at: at });
}

import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { revokeSessions } from "../../../../../lib/session-control";
import { passwordResetDenied } from "../../../../../lib/staff-roles";
import { getStaffScope } from "../../../../../lib/staff-scope";
import { listTeam } from "../../route";

/**
 * DELETE /admin/team/:id/sessions — signs a person out of EVERY device (remote
 * sign-out). Whoever may reset their password (owner or superadmin, never on
 * oneself: that is /admin/team/me/sessions) may also sign them out. The account
 * stays active: the person comes back with their usual password. The vetoes
 * reuse passwordResetDenied's reason codes (`forbidden_role`, `self_password`),
 * which the panel already translates as adm.err.team.<reason>.
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

import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IAuthModuleService, IUserModuleService, Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { recordAudit } from "../../../../../lib/audit";
import { passwordResetDenied } from "../../../../../lib/staff-roles";
import { getStaffScope } from "../../../../../lib/staff-scope";
import { revokeSessions } from "../../../../../lib/session-control";

/**
 * POST /admin/team/:id/password { new_password } — el dueño o un superadmin
 * cambia la contraseña de CUALQUIER usuario, dueño incluido (decisión del dueño).
 *
 * Queda como temporal: la persona debe cambiarla en su próxima entrada, así que
 * quien la puso no sigue conociendo la contraseña definitiva. La propia se cambia
 * en POST /admin/team/password, que pide la actual. La auditoría registra quién y
 * a quién, nunca la contraseña.
 */
interface Body {
  new_password?: string;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const targetId = String(req.params.id ?? "");
  const actorId = req.auth_context?.actor_id ?? "";
  const next = String((req.body as Body | undefined)?.new_password ?? "");

  const actor = await getStaffScope(req.scope, actorId);
  const denied = passwordResetDenied({ actorRole: actor.role, actorId, targetId });
  if (denied) {
    res.status(403).json({ type: "not_allowed", reason: denied, message: `Cannot reset this password: ${denied}.` });
    return;
  }
  if (next.length < 8) {
    res.status(422).json({ type: "invalid_data", reason: "weak_password", message: "New password must be at least 8 characters." });
    return;
  }

  const users = req.scope.resolve<IUserModuleService>(Modules.USER);
  const target = await users.retrieveUser(targetId).catch(() => null);
  if (!target) {
    res.status(404).json({ type: "not_found", reason: "not_found", message: "User not found." });
    return;
  }

  const auth = req.scope.resolve<IAuthModuleService>(Modules.AUTH);
  const updated = await auth
    .updateProvider("emailpass", { entity_id: target.email, password: next })
    .catch((e: Error) => ({ success: false, error: e.message }));
  if (!updated.success) {
    logger.warn(`[team] password reset of ${targetId} failed: ${updated.error ?? "unknown"}`);
    res.status(409).json({ type: "not_allowed", reason: "no_identity", message: "That user has no password credential to change." });
    return;
  }

  await users.updateUsers({ id: target.id, metadata: { ...((target.metadata as Record<string, unknown>) ?? {}), must_change_password: true } });
  await recordAudit(req.scope, { actorId, action: "password.reset", entity: "user", entityId: target.id });
  // Whoever held that account's sessions is out: the temporary password is the only way back in.
  await revokeSessions(req.scope, { userId: target.id, actorId, reason: "password_reset" });
  logger.info(`[team] password of ${target.email} reset by ${actorId}`);
  res.json({ ok: true, sessions_revoked: true });
}

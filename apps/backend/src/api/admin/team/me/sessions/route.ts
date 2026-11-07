import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { revokeSessions } from "../../../../../lib/session-control";

/**
 * DELETE /admin/team/me/sessions — "cerrar sesión en todos mis equipos". Any
 * role, only on oneself (staff-roles.ts RESTRICTED_ALLOWED). The session that
 * makes the call dies too: the panel returns to the login on purpose — a
 * forgotten open session elsewhere is exactly what this closes.
 */
export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const actorId = req.auth_context?.actor_id ?? "";
  const at = await revokeSessions(req.scope, { userId: actorId, actorId, reason: "self_logout" });
  res.json({ ok: true, sessions_revoked_at: at });
}

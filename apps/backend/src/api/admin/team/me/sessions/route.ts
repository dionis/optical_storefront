import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { revokeSessions } from "../../../../../lib/session-control";

/**
 * DELETE /admin/team/me/sessions — «cerrar sesión en todos mis equipos».
 * Cualquier rol, solo sobre sí mismo. La sesión que hace la llamada también
 * muere: el panel vuelve al inicio de sesión a propósito.
 */
export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const actorId = req.auth_context?.actor_id ?? "";
  const at = await revokeSessions(req.scope, { userId: actorId, actorId, reason: "remote_logout" });
  res.json({ ok: true, sessions_revoked_at: at });
}

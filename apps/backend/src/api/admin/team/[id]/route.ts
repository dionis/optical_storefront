import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IAuthModuleService, IUserModuleService, Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { listTeam } from "../route";
import { STAFF_MODULE } from "../../../../modules/staff";
import type StaffModuleService from "../../../../modules/staff/service";
import { getStaffScope, invalidateStaffScope } from "../../../../lib/staff-scope";
import { unlinkSellerOf } from "../../../../lib/seller-link";

/**
 * DELETE /admin/team/:id — elimina a un administrador.
 *
 * Dos vetos, por diseño:
 *   · el SUPER ADMIN (el usuario más antiguo, el dueño) NO se puede borrar,
 *     lo pida quien lo pida — reason `super_admin`;
 *   · nadie puede borrarse a sí mismo — reason `self` (evita dejar una
 *     sesión fantasma y el "me borré sin querer").
 * También se elimina la identidad de credenciales, para que ese correo pueda
 * volver a darse de alta limpio en el futuro.
 */
export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const targetId = String(req.params.id ?? "");
  const actorId = req.auth_context?.actor_id ?? "";

  const team = await listTeam(req);
  const target = team.find((m) => m.id === targetId);
  if (!target) {
    res.status(404).json({ type: "not_found", reason: "not_found", message: "Admin user not found." });
    return;
  }
  if (target.is_super) {
    res.status(403).json({ type: "not_allowed", reason: "super_admin", message: "The super admin cannot be deleted." });
    return;
  }
  if (target.id === actorId) {
    res.status(403).json({ type: "not_allowed", reason: "self", message: "You cannot delete your own account." });
    return;
  }
  // Solo el dueño nombra o quita superadmins (decisión del dueño).
  const actor = await getStaffScope(req.scope, actorId);
  if (target.role === "superadmin" && actor.role !== "owner") {
    res.status(403).json({ type: "not_allowed", reason: "owner_only", message: "Only the owner can remove a superadmin." });
    return;
  }

  const users = req.scope.resolve<IUserModuleService>(Modules.USER);
  await users.deleteUsers([target.id]);
  // Su ficha de vendedor sigue (ventas y enlace de referido), ya sin usuario.
  await unlinkSellerOf(req.scope, target.id);

  // Sus roles se van con él: un usuario nuevo con el mismo id no existirá, pero
  // las filas huérfanas confundirían cualquier reporte del equipo.
  const staff = req.scope.resolve<StaffModuleService>(STAFF_MODULE);
  const rows = await staff.listStaffAssignments({ user_id: target.id }, { take: 1000 });
  if (rows.length) await staff.softDeleteStaffAssignments(rows.map((r) => r.id));
  invalidateStaffScope(target.id);

  // Identidad de credenciales fuera también (best-effort): sin esto el correo
  // quedaría bloqueado para siempre en un nuevo alta.
  try {
    const auth = req.scope.resolve<IAuthModuleService>(Modules.AUTH);
    const identities = await auth.listAuthIdentities(
      { provider_identities: { entity_id: target.email } } as never,
      { take: 2 }
    );
    if (identities.length) await auth.deleteAuthIdentities(identities.map((i) => i.id));
  } catch (error) {
    logger.warn(`[team] credential cleanup for ${target.email} failed: ${(error as Error).message}`);
  }

  logger.info(`[team] admin ${target.email} deleted by ${actorId}`);
  res.json({ team: await listTeam(req) });
}

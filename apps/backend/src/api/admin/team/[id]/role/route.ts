import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { listTeam } from "../../route";
import { STAFF_MODULE } from "../../../../../modules/staff";
import type StaffModuleService from "../../../../../modules/staff/service";
import { roleChangeDenied, type StaffRole } from "../../../../../lib/staff-roles";
import { getStaffScope, invalidateStaffScope } from "../../../../../lib/staff-scope";

/**
 * POST /admin/team/:id/role { role } — cambia el rol general (todas las tiendas)
 * de una persona del equipo.
 *
 * Quién puede qué (lib/staff-roles.ts, roleChangeDenied):
 *   · el dueño no cambia de rol nunca            → reason `owner_locked`
 *   · solo dueño y superadmin asignan roles     → `forbidden_role`
 *   · solo el dueño nombra o quita superadmins  → `owner_only`
 *   · nadie cambia su propio rol                 → `self_role`
 *
 * Un admin anterior a los roles (sin filas) pasa a tener su fila al primer
 * cambio; desde ahí solo cuentan sus filas.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<{ role?: string }>,
  res: MedusaResponse
): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const targetId = String(req.params.id ?? "");
  const actorId = req.auth_context?.actor_id ?? "";
  const nextRole = String((req.body as { role?: string } | undefined)?.role ?? "");

  const team = await listTeam(req);
  const target = team.find((m) => m.id === targetId);
  if (!target) {
    res.status(404).json({ type: "not_found", reason: "not_found", message: "Team member not found." });
    return;
  }

  const actor = await getStaffScope(req.scope, actorId);
  const denied = roleChangeDenied({
    actorRole: actor.role,
    targetIsOwner: target.is_super,
    targetRole: target.role,
    nextRole,
    actorIsTarget: target.id === actorId,
  });
  if (denied) {
    res.status(denied === "bad_role" ? 422 : 403).json({ type: "not_allowed", reason: denied, message: `Cannot set role ${nextRole}.` });
    return;
  }

  const staff = req.scope.resolve<StaffModuleService>(STAFF_MODULE);
  const [global] = await staff.listStaffAssignments({ user_id: targetId, establishment_id: null }, { take: 1 });
  if (global) {
    await staff.updateStaffAssignments({ id: global.id, role: nextRole as StaffRole, is_active: true, updated_by: actorId || null });
  } else {
    await staff.createStaffAssignments({
      user_id: targetId,
      establishment_id: null,
      role: nextRole as StaffRole,
      created_by: actorId || null,
    });
  }
  invalidateStaffScope(targetId);

  logger.info(`[team] ${target.email}: role ${target.role ?? "none"} -> ${nextRole} by ${actorId}`);
  res.json({ team: await listTeam(req) });
}

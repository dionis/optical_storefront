import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { listTeam, personName, sellerLinkRefusal } from "../../route";
import { applySellerLink, prepareSellerLink, unlinkSellerOf } from "../../../../../lib/seller-link";
import { roleChangeDenied, type StaffRole } from "../../../../../lib/staff-roles";
import { getStaffScope, writeStaffAssignment } from "../../../../../lib/staff-scope";

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
 *
 * Pasar a VENDEDOR exige `seller` (ficha existente o nueva, ver POST
 * /admin/team): su tienda pasa a ser la de la ficha. Con `seller` y el rol que
 * ya tenía, cambia de ficha. Dejar de ser vendedor libera la ficha.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<{ role?: string }>,
  res: MedusaResponse
): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const targetId = String(req.params.id ?? "");
  const actorId = req.auth_context?.actor_id ?? "";
  const body = (req.body ?? {}) as { role?: string; seller?: unknown };
  const nextRole = String(body.role ?? "");

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

  let establishmentIds = target.establishment_ids;
  if (nextRole === "seller" && (target.role !== "seller" || body.seller !== undefined || !target.seller)) {
    try {
      const link = await prepareSellerLink(req.scope, targetId, body.seller, { name: personName(target.first_name, target.last_name, target.email), email: target.email });
      const seller = await applySellerLink(req.scope, targetId, link);
      establishmentIds = seller.establishment_id ? [seller.establishment_id] : establishmentIds;
    } catch (error) {
      if (sellerLinkRefusal(res, error)) return;
      throw error;
    }
  } else if (nextRole !== "seller" && target.seller) {
    await unlinkSellerOf(req.scope, targetId);
  }

  // Keeps the person's stores; promoting to superadmin widens them to all
  // (assignmentRowsFor), demoting back starts from all stores again.
  await writeStaffAssignment(req.scope, {
    userId: targetId,
    role: nextRole as StaffRole,
    establishmentIds,
    actorId: actorId || null,
  });

  logger.info(`[team] ${target.email}: role ${target.role ?? "none"} -> ${nextRole} by ${actorId}`);
  res.json({ team: await listTeam(req) });
}

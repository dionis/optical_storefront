import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { listTeam } from "../../route";
import { isAdminRole } from "../../../../../lib/staff-roles";
import { writeStaffAssignment } from "../../../../../lib/staff-scope";
import { listEstablishments } from "../../../../../lib/establishments";

/**
 * POST /admin/team/:id/stores { establishment_ids: string[] } — tiendas donde
 * trabaja una persona; lista vacía = todas.
 *
 * Solo para supervisor, encargado y vendedor: el dueño y los superadmin cubren
 * siempre todas las tiendas (reason `admin_all_stores`). Solo admite tiendas
 * activas (reason `bad_store`). Llegan aquí únicamente dueño y superadmin (guardia
 * de /admin). La tienda de un VENDEDOR es la de su ficha (reason
 * `seller_store_from_record`): se cambia desde Vendedores, no aquí.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<{ establishment_ids?: unknown }>,
  res: MedusaResponse
): Promise<void> {
  const targetId = String(req.params.id ?? "");
  const actorId = req.auth_context?.actor_id ?? "";
  const raw = (req.body as { establishment_ids?: unknown } | undefined)?.establishment_ids;
  const ids = Array.isArray(raw) ? raw.map(String) : null;
  if (!ids) {
    res.status(422).json({ type: "invalid_data", reason: "bad_store", message: "establishment_ids must be an array." });
    return;
  }

  const team = await listTeam(req);
  const target = team.find((m) => m.id === targetId);
  if (!target) {
    res.status(404).json({ type: "not_found", reason: "not_found", message: "Team member not found." });
    return;
  }
  if (target.is_super || !target.role || isAdminRole(target.role)) {
    res.status(422).json({ type: "not_allowed", reason: "admin_all_stores", message: "Owner and superadmins always cover every store." });
    return;
  }

  if (target.role === "seller") {
    res.status(422).json({ type: "not_allowed", reason: "seller_store_from_record", message: "A seller's store comes from their seller record." });
    return;
  }

  const active = new Set((await listEstablishments(req.scope)).filter((e) => e.is_active).map((e) => e.id));
  if (ids.some((id) => !active.has(id))) {
    res.status(422).json({ type: "invalid_data", reason: "bad_store", message: "Unknown or inactive store." });
    return;
  }

  await writeStaffAssignment(req.scope, {
    userId: targetId,
    role: target.role,
    establishmentIds: ids,
    actorId: actorId || null,
  });

  req.scope
    .resolve<Logger>(ContainerRegistrationKeys.LOGGER)
    .info(`[team] ${target.email}: stores -> ${ids.length ? ids.join(",") : "all"} by ${actorId}`);
  res.json({ team: await listTeam(req) });
}

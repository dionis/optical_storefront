import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { listTeam } from "../../route";
import { recordAudit } from "../../../../../lib/audit";
import { setAccessDisabled } from "../../../../../lib/staff-profile-data";
import { getStaffScope, invalidateStaffScope, statusChangeDenied } from "../../../../../lib/staff-scope";

/**
 * POST /admin/team/:id/status { active: boolean } — deactivates or reactivates
 * a team member (HU-04: "desactivar a alguien que deja de trabajar y cerrar sus
 * sesiones abiertas, sin perder su historial").
 *
 * Unlike DELETE, nothing is removed: user, role rows, profile, seller record and
 * audit trail stay, and the person comes back with the same role on
 * reactivation. Access ends through lib/staff-scope.ts: a `disabled_at` resolves
 * to role null on every /admin request, which is also what closes their open
 * sessions — Medusa's JWTs cannot be revoked without a denylist, so the
 * per-request check is the revocation (within the 30 s scope cache, cleared
 * here for the target).
 *
 * Vetoes and reason codes mirror DELETE (lib/staff-scope.ts statusChangeDenied):
 * `super_admin` (the owner), `self`, `owner_only`, `forbidden_role`. The panel
 * translates them with adm.err.team.<reason>.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<{ active?: unknown }>,
  res: MedusaResponse
): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const targetId = String(req.params.id ?? "");
  const actorId = req.auth_context?.actor_id ?? "";
  const active = (req.body ?? {}).active;
  if (typeof active !== "boolean") {
    res.status(422).json({ type: "invalid_data", reason: "bad_active", message: "`active` must be a boolean." });
    return;
  }

  const team = await listTeam(req);
  const target = team.find((m) => m.id === targetId);
  if (!target) {
    res.status(404).json({ type: "not_found", reason: "not_found", message: "Team member not found." });
    return;
  }
  const actor = await getStaffScope(req.scope, actorId);
  const denied = statusChangeDenied({
    actorRole: actor.role,
    targetIsOwner: target.is_super,
    targetRole: target.role,
    actorIsTarget: target.id === actorId,
  });
  if (denied) {
    res.status(403).json({ type: "not_allowed", reason: denied, message: `Cannot ${active ? "reactivate" : "deactivate"} this team member.` });
    return;
  }

  // Already in the requested state: nothing to write or audit.
  if (target.is_disabled === !active) {
    res.json({ team });
    return;
  }

  const { before, after } = await setAccessDisabled(req.scope, target.id, !active, actorId || null);
  // Their next request — even with a token issued before this — sees the change.
  invalidateStaffScope(target.id);
  await recordAudit(req.scope, {
    actorId: actorId || null,
    action: active ? "user.reactivate" : "user.deactivate",
    entity: "user",
    entityId: target.id,
    before: { disabled_at: before.disabled_at, role: target.role },
    after: { disabled_at: after.disabled_at, role: target.role },
  });
  logger.info(`[team] ${target.email} ${active ? "reactivated" : "deactivated"} by ${actorId || "?"}`);
  res.json({ team: await listTeam(req) });
}

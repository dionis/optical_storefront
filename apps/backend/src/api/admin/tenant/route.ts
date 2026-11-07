import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { recordAudit } from "../../../lib/audit";
import { ownerExplicitCheck } from "../../../lib/owner-explicit";
import { getStaffScope, ownerUserId } from "../../../lib/staff-scope";
import { tenant } from "../../../lib/tenant";
import { cleanTenantProfileInput, readTenantProfile, saveTenantProfile } from "../../../lib/tenant-profile";

/**
 * Perfil de la óptica (docs/MULTI-TENANT-TECNICO.md §7.1).
 *
 *   GET  /admin/tenant — lo guardado por el dueño, la identidad efectiva (lo
 *                        guardado sobre las variables del despliegue) y quién es
 *                        el dueño ahora mismo.
 *   POST /admin/tenant — cambia los campos presentes del cuerpo; "" o null borra.
 *
 * Solo dueño y superadmin: staffGuard ya cierra /admin/tenant a los demás roles
 * (no está en la lista de staff-roles.ts) y aquí se repite para no depender de
 * esa lista. Errores con `reason` (adm.err.tenant.<reason>) y `field`.
 */
async function requireAdmin(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<string | null> {
  const actorId = req.auth_context?.actor_id ?? "";
  const scope = actorId ? await getStaffScope(req.scope, actorId) : null;
  if (!scope?.is_admin) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can edit the store profile." });
    return null;
  }
  return actorId;
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  if (!(await requireAdmin(req, res))) return;
  const [profile, owner, explicit] = await Promise.all([readTenantProfile(req.scope, { fresh: true }), ownerUserId(req.scope), ownerExplicitCheck(req.scope)]);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    profile,
    effective: tenant(),
    owner_user_id: owner,
    owner_source: explicit.ok ? "explicit" : "oldest_user",
  });
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const actorId = await requireAdmin(req, res);
  if (!actorId) return;
  const cleaned = cleanTenantProfileInput(req.body);
  if (!cleaned.ok) {
    res.status(422).json({ type: "invalid_data", reason: cleaned.reason, field: cleaned.field, message: `Invalid ${cleaned.field}: ${cleaned.reason}` });
    return;
  }
  try {
    const before = await readTenantProfile(req.scope, { fresh: true });
    const profile = await saveTenantProfile(req.scope, cleaned.patch, actorId);
    const changed = Object.keys(cleaned.patch);
    await recordAudit(req.scope, {
      actorId,
      action: "tenant.profile",
      entity: "tenant_profile",
      entityId: "default",
      before: Object.fromEntries(changed.map((k) => [k, (before as unknown as Record<string, unknown>)[k] ?? null])),
      after: cleaned.patch,
    });
    res.json({ profile, effective: tenant() });
  } catch (e) {
    req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER).error(`[tenant] save failed: ${(e as Error).stack ?? e}`);
    res.status(500).json({ type: "unexpected_state", reason: "save_failed", message: "The store profile could not be saved." });
  }
}

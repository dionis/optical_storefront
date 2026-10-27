import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IUserModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { recordAudit } from "../../../../../lib/audit";
import { cleanProfilePatch, suggestSellerCode, viewProfile } from "../../../../../lib/staff-profile";
import { profileOf, saveProfile, takenSellerCodes } from "../../../../../lib/staff-profile-data";
import { invalidateStaffScope } from "../../../../../lib/staff-scope";

/**
 * PERFIL de una persona del equipo (HU-99, HU-100), visto y editado por el
 * dueño o un superadmin: todo el perfil, incluido el código de vendedor que
 * sale en recibos y fichas, los privilegios adicionales, la comisión, la meta,
 * el contacto de emergencia y las notas internas.
 *
 * Solo admins: /admin/team/* no está en la lista de los roles restringidos.
 * Errores con `reason`; el panel traduce con adm.err.profile.<reason>.
 */
async function loadUser(req: AuthenticatedMedusaRequest) {
  const users = req.scope.resolve<IUserModuleService>(Modules.USER);
  return users.retrieveUser(String(req.params.id ?? "")).catch(() => null);
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const user = await loadUser(req);
  if (!user) {
    res.status(404).json({ type: "not_found", reason: "not_found", message: "User not found." });
    return;
  }
  const profile = await profileOf(req.scope, user.id);
  res.json({
    profile: viewProfile(profile, { isAdmin: true, isSelf: req.auth_context?.actor_id === user.id, managesThem: false }),
    suggested_seller_code: profile.seller_code
      ? null
      : suggestSellerCode(user.first_name ?? null, user.last_name ?? null, await takenSellerCodes(req.scope, user.id)),
  });
}

export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  const user = await loadUser(req);
  if (!user) {
    res.status(404).json({ type: "not_found", reason: "not_found", message: "User not found." });
    return;
  }
  const cleaned = cleanProfilePatch((req.body ?? {}) as Record<string, unknown>, "admin");
  if ("reason" in cleaned) {
    res.status(422).json({ type: "invalid_data", reason: cleaned.reason, field: cleaned.field, message: `Profile: ${cleaned.reason}` });
    return;
  }
  const actorId = req.auth_context?.actor_id ?? null;
  let saved;
  try {
    saved = await saveProfile(req.scope, user.id, cleaned.patch, actorId);
  } catch (e) {
    if ((e as Error).message === "seller_code_taken") {
      res.status(409).json({ type: "invalid_data", reason: "seller_code_taken", message: "Seller code already in use." });
      return;
    }
    throw e;
  }
  invalidateStaffScope(user.id);

  const { before, after } = saved;
  const changed = Object.keys(cleaned.patch);
  const prev = before as unknown as Record<string, unknown>;
  // Privileges get their own entry: "who gave whom what" is the question asked of the log.
  if (changed.includes("privileges")) {
    await recordAudit(req.scope, {
      actorId,
      action: "privileges.change",
      entity: "user",
      entityId: user.id,
      before: { privileges: before.privileges },
      after: { privileges: after.privileges },
    });
  }
  const rest = changed.filter((k) => k !== "privileges");
  if (rest.length) {
    // Emergency contact and notes are recorded as "changed", not by value.
    const redact = (k: string, v: unknown) => (/^emergency_|^internal_notes$/.test(k) ? (v ? "•••" : null) : v);
    await recordAudit(req.scope, {
      actorId,
      action: "profile.change",
      entity: "staff_profile",
      entityId: user.id,
      before: Object.fromEntries(rest.map((k) => [k, redact(k, prev[k])])),
      after: Object.fromEntries(rest.map((k) => [k, redact(k, (cleaned.patch as Record<string, unknown>)[k])])),
    });
  }
  res.json({ profile: viewProfile(after, { isAdmin: true, isSelf: actorId === user.id, managesThem: false }) });
}

import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IUserModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { profileOf } from "../../../../lib/staff-profile-data";
import { getStaffScope } from "../../../../lib/staff-scope";

/**
 * GET /admin/team/me — quién soy en el panel: email, si soy el super admin y,
 * sobre todo, si mi contraseña es la TEMPORAL del alta (must_change_password),
 * que es lo que el panel consulta nada más entrar para forzar el cambio.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const actorId = req.auth_context?.actor_id ?? "";
  const users = req.scope.resolve<IUserModuleService>(Modules.USER);
  const me = await users.retrieveUser(actorId).catch(() => null);
  if (!me) {
    res.status(404).json({ type: "not_found", reason: "not_found", message: "Authenticated user not found." });
    return;
  }
  // Reachable by every role (lib/staff-roles.ts allowlist), so it must not list
  // the team: only the caller's own scope.
  const [scope, profile] = await Promise.all([
    getStaffScope(req.scope, me.id),
    profileOf(req.scope, me.id),
  ]);
  res.json({
    id: me.id,
    email: me.email,
    first_name: me.first_name ?? null,
    is_super: scope.is_owner,
    role: scope.role,
    is_admin: scope.is_admin,
    privileges: scope.privileges,
    seller_code: scope.seller_code,
    display_name: profile.display_name ?? null,
    photo_url: profile.photo_url ?? null,
    phone_mobile: profile.phone_mobile ?? null,
    must_change_password: Boolean((me.metadata as Record<string, unknown> | null)?.["must_change_password"]),
  });
}

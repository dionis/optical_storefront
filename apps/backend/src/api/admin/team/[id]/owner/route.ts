import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { listTeam } from "../../route";
import { OwnerTransferError, transferOwnership } from "../../../../../lib/owner-transfer";

/**
 * POST /admin/team/:id/owner { password } — hace DUEÑO a :id.
 *
 * Reglas (lib/staff-roles.ts ownerTransferDenied, lib/owner-transfer.ts):
 *   · lo hace el dueño o un superadmin                 → si no, `forbidden_role`
 *   · solo a OTRO superadmin activo                    → `self_owner`, `already_owner`,
 *                                                        `owner_target_disabled`,
 *                                                        `owner_target_not_superadmin`
 *   · con la contraseña de quien lo hace               → `password_required`, `bad_current`
 * Siempre hay un único dueño: el anterior queda como superadmin.
 */
export async function POST(req: AuthenticatedMedusaRequest<{ password?: string }>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const actorId = req.auth_context?.actor_id ?? "";
  const body = (req.body ?? {}) as { password?: unknown };
  try {
    const result = await transferOwnership(req.scope, {
      actorId,
      targetId: String(req.params.id ?? ""),
      password: typeof body.password === "string" ? body.password : "",
    });
    logger.info(`[team] ownership ${result.previous_owner_id ?? "none"} -> ${result.owner_user_id} by ${actorId}`);
    res.json({ ...result, team: await listTeam(req) });
  } catch (error) {
    if (error instanceof OwnerTransferError) {
      res.status(error.status).json({ type: "not_allowed", reason: error.reason, message: `Ownership transfer refused: ${error.reason}` });
      return;
    }
    throw error;
  }
}

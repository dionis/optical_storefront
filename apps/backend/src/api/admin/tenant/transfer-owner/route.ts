import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { OwnerTransferError, transferOwnership } from "../../../../lib/tenant-owner";

/**
 * POST /admin/tenant/transfer-owner — { user_id, password }
 *
 * El dueño entrega la propiedad del panel a otra persona del equipo, confirmando
 * con su contraseña. Él queda como superadministrador. Errores con `reason`
 * (adm.err.owner.<reason>): not_owner, same_user, target_required,
 * target_not_found, target_disabled, bad_password.
 */
interface Body {
  user_id?: string;
  password?: string;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  const body = (req.body ?? {}) as Body;
  try {
    const result = await transferOwnership(req.scope, {
      actorId: req.auth_context?.actor_id ?? "",
      targetUserId: String(body.user_id ?? "").trim(),
      password: String(body.password ?? ""),
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof OwnerTransferError) {
      res.status(e.status).json({ type: "invalid_data", reason: e.reason, message: `Ownership transfer refused: ${e.reason}` });
      return;
    }
    req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER).error(`[tenant] transfer failed: ${(e as Error).stack ?? e}`);
    res.status(500).json({ type: "unexpected_state", reason: "transfer_failed", message: "The ownership transfer failed." });
  }
}

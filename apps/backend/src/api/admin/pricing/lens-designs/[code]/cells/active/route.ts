import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { mirrorPricesToSheet } from "../../../../../../../lib/gsheet-sync";
import { setLensCellActive } from "../../../../../../../lib/lens-design-data";
import { parseLensFinish } from "../../../../../../../lib/lens-finish";
import { matrixAccess } from "../../../../../../../lib/price-matrix-route";

/**
 * POST /admin/pricing/lens-designs/:code/cells/active
 *   { material: string, finish?: "stock"|"digital", active: boolean }
 *
 * Shows or hides one lens cell — a work the shop does not do for now is
 * switched off instead of deleted: it keeps its price, its cost and every
 * store's price, but neither the till nor the web offers it, and a quote for
 * it is refused (`finish_unavailable`). Owner and superadmin only.
 * Answers `{ key, active }`. Reasons: `forbidden_role` (403),
 * `design_not_found` / `cell_not_found` (404), `bad_value` (422).
 */
export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const access = await matrixAccess(req);
  if (!access.isAdmin) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can show or hide a lens." });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const material = typeof body.material === "string" ? body.material.trim() : "";
  const finish = parseLensFinish(body.finish ?? "stock");
  if (!material || !finish || typeof body.active !== "boolean") {
    res.status(422).json({ type: "invalid_data", reason: "bad_value", message: "Say which material and finish, and whether it is shown." });
    return;
  }
  try {
    const out = await setLensCellActive(req.scope, String(req.params?.code ?? "").trim(), material, finish, body.active, access.actorId);
    if ("reason" in out) {
      res.status(404).json({ type: "not_found", reason: out.reason, message: "No such lens cell." });
      return;
    }
    void mirrorPricesToSheet(req.scope);
    res.json(out);
  } catch (error) {
    logger.error(`[pricing] lens cell show/hide failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not save the change." });
  }
}

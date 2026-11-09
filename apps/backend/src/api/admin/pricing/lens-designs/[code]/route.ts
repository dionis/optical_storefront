import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { mirrorPricesToSheet } from "../../../../../lib/gsheet-sync";
import { cleanLensDesignPatch } from "../../../../../lib/lens-design";
import { deleteLensDesign, updateLensDesign } from "../../../../../lib/lens-design-data";
import { matrixAccess } from "../../../../../lib/price-matrix-route";

const codeOf = (req: AuthenticatedMedusaRequest): string => String(req.params?.code ?? "").trim();

/**
 * POST /admin/pricing/lens-designs/:code { label_es?, label_en?, requires_add?, tier?, use_es?, use_en?, sort? }
 * Edits a lens design, only the keys sent (the category never changes).
 * Owner and superadmin only. Reasons: `forbidden_role` (403),
 * `design_not_found` (404), `bad_label` / `bad_value` / `bad_category` /
 * `nothing_to_change` (422), `save_failed` (500).
 */
export async function POST(req: AuthenticatedMedusaRequest<Record<string, unknown>>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const access = await matrixAccess(req);
  if (!access.isAdmin) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can edit lens designs." });
    return;
  }
  const cleaned = cleanLensDesignPatch((req.body ?? {}) as Record<string, unknown>);
  if ("reason" in cleaned) {
    res.status(422).json({ type: "invalid_data", reason: cleaned.reason, message: "Invalid lens design change." });
    return;
  }
  try {
    const out = await updateLensDesign(req.scope, codeOf(req), cleaned.patch, access.actorId);
    if ("reason" in out) {
      res.status(404).json({ type: "not_found", reason: out.reason, message: "No such lens design." });
      return;
    }
    void mirrorPricesToSheet(req.scope);
    res.json(out);
  } catch (error) {
    logger.error(`[pricing] lens design update failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not save the lens design." });
  }
}

/**
 * DELETE /admin/pricing/lens-designs/:code → { deleted: true } | { archived: true }
 * Never sold → removed with its cells and the stores' own prices; sold →
 * archived (hidden everywhere, past sales keep their labels). Owner and
 * superadmin only. Reasons: `forbidden_role` (403), `design_not_found` (404).
 */
export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const access = await matrixAccess(req);
  if (!access.isAdmin) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can remove lens designs." });
    return;
  }
  try {
    const out = await deleteLensDesign(req.scope, codeOf(req), access.actorId);
    if ("reason" in out) {
      res.status(404).json({ type: "not_found", reason: out.reason, message: "No such lens design." });
      return;
    }
    logger.info(`[pricing] lens design ${codeOf(req)} ${"archived" in out ? "archived" : "deleted"} by ${access.actorId ?? "?"}`);
    void mirrorPricesToSheet(req.scope);
    res.json(out);
  } catch (error) {
    logger.error(`[pricing] lens design delete failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not remove the lens design." });
  }
}

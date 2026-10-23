import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { costingService, listCostRules } from "../../../../../lib/costing";
import { mirrorCostRulesToSheet } from "../../../../../lib/gsheet-sync";

/** DELETE /admin/costing/rules/:id — soft delete → { id, deleted: true }. Refreshes the sheet's "Costos" tab (best effort). */
export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const id = String(req.params.id ?? "");
  try {
    const live = await listCostRules(req.scope);
    if (!live.some((r) => r.id === id)) {
      res.status(404).json({ type: "not_found", reason: "not_found", message: `Rule '${id}' not found.` });
      return;
    }
    await costingService(req.scope).softDeleteCostRules([id]);
    await mirrorCostRulesToSheet(req.scope, live.filter((r) => r.id !== id));
    res.json({ id, deleted: true });
  } catch (error) {
    logger.error(`[costing] rule delete ${id} failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "delete_failed", message: "Could not delete the rule." });
  }
}

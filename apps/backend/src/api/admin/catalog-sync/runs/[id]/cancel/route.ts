import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { recordAudit } from "../../../../../../lib/audit";
import { cancelRun } from "../../../../../../lib/catalog-sync-data";

/**
 * POST /admin/catalog-sync/runs/:id/cancel
 *
 * A queued run is canceled at once (`status: "canceled"`). A running one is
 * flagged (`status: "requested"`): the worker stops before the next product, and
 * what it already pushed to the catalog stays.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "");
  const outcome = await cancelRun(req.scope, id);
  if (outcome === "not_active") {
    res.status(409).json({ type: "conflict", reason: "run_not_active", message: "The run is not queued or running." });
    return;
  }
  await recordAudit(req.scope, {
    actorId: req.auth_context?.actor_id ?? null,
    action: "catalog.sync",
    entity: "catalog_sync_run",
    entityId: id,
    after: { cancel: outcome },
  });
  res.json({ status: outcome });
}

import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { cleanLogTail, cleanProgress } from "../../../../../../../lib/catalog-sync";
import { reportProgress, touchWorker } from "../../../../../../../lib/catalog-sync-data";
import { workerIdOf } from "../../../../../../../lib/catalog-sync-worker";

/**
 * POST /admin/catalog-sync/worker/runs/:id/progress { worker_id, progress?, log_tail? }
 *
 * Heartbeat. The answer tells the worker whether to go on: `cancel_requested`
 * when the owner pressed «Detener», 409 `run_gone` when the run is no longer
 * its own (declared lost after a long silence, or canceled while queued).
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const workerId = workerIdOf(req, res);
  if (!workerId) return;
  const body = req.body as Record<string, unknown>;
  const result = await reportProgress(
    req.scope,
    String(req.params.id ?? ""),
    workerId,
    cleanProgress(body.progress),
    cleanLogTail(body.log_tail)
  );
  await touchWorker(req.scope, workerId, null);
  if (result.gone) {
    res.status(409).json({ type: "conflict", reason: "run_gone", message: "This run is no longer running on this worker." });
    return;
  }
  res.json({ cancel_requested: result.cancel_requested });
}

import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  cleanErrorReason,
  cleanErrors,
  cleanFinalStatus,
  cleanLogTail,
  cleanNewProducts,
  cleanSummary,
} from "../../../../../../../lib/catalog-sync";
import { finishRun } from "../../../../../../../lib/catalog-sync-data";
import { workerIdOf } from "../../../../../../../lib/catalog-sync-worker";

/**
 * POST /admin/catalog-sync/worker/runs/:id/finish
 *   { worker_id, status, summary, new_products, errors, error_reason?, log_tail? }
 *
 * Closes the run with what the owner will read. Every field is reduced to known
 * shapes and sizes (`clean*` in lib/catalog-sync.ts): the worker holds an admin
 * key, but the panel still should not render whatever it sends.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const workerId = workerIdOf(req, res);
  if (!workerId) return;
  const body = req.body as Record<string, unknown>;
  const status = cleanFinalStatus(body.status);
  if (!status) {
    res.status(422).json({ type: "invalid_data", reason: "invalid_status", message: "Unknown final status." });
    return;
  }
  const id = String(req.params.id ?? "");
  const run = await finishRun(req.scope, id, workerId, {
    status,
    summary: cleanSummary(body.summary),
    new_products: cleanNewProducts(body.new_products),
    errors: cleanErrors(body.errors),
    error_reason: status === "failed" ? cleanErrorReason(body.error_reason) ?? "crashed" : cleanErrorReason(body.error_reason),
    log_tail: cleanLogTail(body.log_tail),
  });
  if (!run) {
    res.status(409).json({ type: "conflict", reason: "run_gone", message: "This run is no longer running on this worker." });
    return;
  }
  req.scope
    .resolve<Logger>(ContainerRegistrationKeys.LOGGER)
    .info(`[catalog-sync] run ${id} finished: ${status} ${JSON.stringify(run.summary ?? {})}`);
  res.json({ run });
}

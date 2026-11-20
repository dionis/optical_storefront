import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { claimRun, touchWorker } from "../../../../../lib/catalog-sync-data";
import { workerIdOf } from "../../../../../lib/catalog-sync-worker";

/**
 * POST /admin/catalog-sync/worker/claim { worker_id, info? } — the worker's poll.
 *
 * Records that the worker is alive (the panel's "worker conectado"), then hands
 * it the oldest queued run, or `run: null`. Atomic: two workers polling at the
 * same moment never get the same run.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const workerId = workerIdOf(req, res);
  if (!workerId) return;
  const rawInfo = (req.body as Record<string, unknown>).info;
  const info =
    rawInfo && typeof rawInfo === "object"
      ? Object.fromEntries(
          Object.entries(rawInfo as Record<string, unknown>)
            .filter(([, v]) => typeof v === "string" || typeof v === "boolean" || typeof v === "number")
            .slice(0, 12)
            .map(([k, v]) => [k.slice(0, 40), typeof v === "string" ? v.slice(0, 120) : v])
        )
      : null;

  await touchWorker(req.scope, workerId, info);
  const run = await claimRun(req.scope, workerId);
  if (run) {
    req.scope
      .resolve<Logger>(ContainerRegistrationKeys.LOGGER)
      .info(`[catalog-sync] run ${run.id} (${run.trigger}) claimed by ${workerId}`);
  }
  res.json({ run });
}

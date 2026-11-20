import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { recordAudit } from "../../../../lib/audit";
import { validateRunOptions } from "../../../../lib/catalog-sync";
import { loadSettings, queueManualRun } from "../../../../lib/catalog-sync-data";

/**
 * POST /admin/catalog-sync/runs { full?, collection?, views_max_cost? } — «Ejecutar ahora».
 *
 * Only QUEUES the run: the scraper worker (its own Coolify app) picks it up at
 * its next poll, within a minute. 409 `run_active` while another run is queued
 * or running, with that run in the body so the panel can show it.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { settings } = await loadSettings(req.scope);
  const options = validateRunOptions(settings, body);
  if ("reason" in options) {
    res.status(422).json({ type: "invalid_data", reason: options.reason, message: "Invalid run options." });
    return;
  }
  const actorId = req.auth_context?.actor_id ?? null;
  const result = await queueManualRun(req.scope, options.value, actorId);
  if ("active" in result) {
    res.status(409).json({
      type: "conflict",
      reason: "run_active",
      message: "Another catalog run is queued or running.",
      run: result.active,
    });
    return;
  }
  await recordAudit(req.scope, {
    actorId,
    action: "catalog.sync",
    entity: "catalog_sync_run",
    entityId: result.run.id,
    after: options.value,
  });
  req.scope
    .resolve<Logger>(ContainerRegistrationKeys.LOGGER)
    .info(`[catalog-sync] run ${result.run.id} queued by ${actorId ?? "?"} ${JSON.stringify(options.value)}`);
  res.status(201).json({ run: result.run });
}

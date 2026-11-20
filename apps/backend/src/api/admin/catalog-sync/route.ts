import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { isWorkerOnline, nextScheduledAt } from "../../../lib/catalog-sync";
import {
  activeRun,
  lastFinishedRun,
  latestScheduleSlot,
  listRuns,
  loadSettings,
} from "../../../lib/catalog-sync-data";

/**
 * GET /admin/catalog-sync — everything the «Sincronización del catálogo» tab
 * shows: the owner's schedule, whether a worker is connected, the run in
 * progress (if any), the last finished run in full (new models, errors) and a
 * short history.
 *
 * Owner and superadmin only: the route is not in any restricted role's
 * allowlist, so staff-guard refuses it for everyone else.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const now = new Date();
  const [{ settings, worker, updated_at }, active, last, runs, slot] = await Promise.all([
    loadSettings(req.scope),
    activeRun(req.scope),
    lastFinishedRun(req.scope),
    listRuns(req.scope, 15),
    latestScheduleSlot(req.scope),
  ]);
  res.json({
    settings,
    settings_updated_at: updated_at,
    worker: { ...worker, online: isWorkerOnline(worker.seen_at, now) },
    next_scheduled_at: nextScheduledAt(settings, now, slot)?.toISOString() ?? null,
    active,
    last,
    runs,
    now: now.toISOString(),
  });
}

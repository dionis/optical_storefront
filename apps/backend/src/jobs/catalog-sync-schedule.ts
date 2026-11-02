/**
 * Scheduled job: every 15 minutes, keep the catalog scraper's queue honest.
 *
 * 1. A run whose worker stopped reporting is failed with `worker_lost`, so the
 *    panel never shows "en curso" for a container that died hours ago.
 * 2. When the owner's monthly instant has come (default: the 1st, 06:00 UTC),
 *    this month's run is queued. Idempotent by the unique `schedule_slot`, so
 *    firing every 15 minutes still gives one run a month.
 *
 * It only QUEUES. The scraper runs in its own Coolify app and picks the run up
 * at its next poll — see docs/CATALOG-SYNC.md.
 */
import type { Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { isScheduleDue, scheduledRunOptions } from "../lib/catalog-sync";
import { failStaleRuns, loadSettings, queueScheduledRun } from "../lib/catalog-sync-data";

export default async function catalogSyncScheduleJob(container: MedusaContainer) {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const now = new Date();
  try {
    const lost = await failStaleRuns(container, now);
    if (lost) logger.warn(`[catalog-sync] ${lost} run(s) failed as worker_lost (no heartbeat)`);

    const { settings } = await loadSettings(container);
    if (!isScheduleDue(settings, now)) return;
    const run = await queueScheduledRun(container, scheduledRunOptions(settings), now);
    if (run) logger.info(`[catalog-sync] monthly run ${run.id} ${run.status} (${run.schedule_slot})`);
  } catch (error) {
    // Tables missing (migration not yet run) must not spam a stack every 15 min.
    logger.warn(`[catalog-sync] schedule check skipped: ${(error as Error).message}`);
  }
}

export const config = {
  name: "catalog-sync-schedule",
  schedule: "*/15 * * * *",
};

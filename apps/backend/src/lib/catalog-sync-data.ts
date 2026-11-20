import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, generateEntityId } from "@medusajs/framework/utils";
import {
  DEFAULT_SETTINGS,
  SETTINGS_ID,
  STALE_AFTER_MS,
  scheduleSlot,
  type CatalogSyncSettings,
  type FinalStatus,
  type RunOptions,
} from "./catalog-sync";

/**
 * Catalog scraper queue — raw SQL on purpose. Two workers polling at the same
 * second must never both take the same run, and `FOR UPDATE SKIP LOCKED` inside
 * the UPDATE is the only way to say that in one statement (the same reason
 * frame-media-claim.ts is raw SQL). The rules live in catalog-sync.ts.
 */

type Knex = {
  raw: (sql: string, bindings?: Record<string, unknown>) => Promise<{ rows: any[]; rowCount?: number }>;
};

const db = (container: MedusaContainer) => container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

const json = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));

/** Columns the panel lists — everything but the log, which is fetched per run. */
const LIST_COLUMNS = `id, trigger, status, requested_by, schedule_slot, options, cancel_requested,
  worker_id, started_at, finished_at, heartbeat_at, progress, summary, error_reason, created_at`;

export interface WorkerPresence {
  seen_at: string | null;
  id: string | null;
  info: Record<string, unknown> | null;
}

export async function loadSettings(
  container: MedusaContainer
): Promise<{ settings: CatalogSyncSettings; worker: WorkerPresence; updated_at: string | null }> {
  const { rows } = await db(container).raw(
    `SELECT * FROM catalog_sync_setting WHERE id = :id AND deleted_at IS NULL`,
    { id: SETTINGS_ID }
  );
  const row = rows[0];
  if (!row) {
    return { settings: { ...DEFAULT_SETTINGS }, worker: { seen_at: null, id: null, info: null }, updated_at: null };
  }
  return {
    settings: {
      schedule_enabled: Boolean(row.schedule_enabled),
      schedule_day: Number(row.schedule_day),
      schedule_hour: Number(row.schedule_hour),
      schedule_full: Boolean(row.schedule_full),
      views_max_cost: Number(row.views_max_cost),
    },
    worker: { seen_at: row.worker_seen_at, id: row.worker_id, info: row.worker_info },
    updated_at: row.updated_at,
  };
}

export async function saveSettings(
  container: MedusaContainer,
  s: CatalogSyncSettings,
  actorId: string | null
): Promise<void> {
  await db(container).raw(
    `INSERT INTO catalog_sync_setting
       (id, schedule_enabled, schedule_day, schedule_hour, schedule_full, views_max_cost, updated_by)
     VALUES (:id, :enabled, :day, :hour, :full, :cost, :actor)
     ON CONFLICT (id) DO UPDATE SET
       schedule_enabled = EXCLUDED.schedule_enabled,
       schedule_day     = EXCLUDED.schedule_day,
       schedule_hour    = EXCLUDED.schedule_hour,
       schedule_full    = EXCLUDED.schedule_full,
       views_max_cost   = EXCLUDED.views_max_cost,
       updated_by       = EXCLUDED.updated_by,
       updated_at       = NOW()`,
    {
      id: SETTINGS_ID,
      enabled: s.schedule_enabled,
      day: s.schedule_day,
      hour: s.schedule_hour,
      full: s.schedule_full,
      cost: s.views_max_cost,
      actor: actorId,
    }
  );
}

/** Every poll leaves a trace, so the panel knows a worker exists even when idle. */
export async function touchWorker(
  container: MedusaContainer,
  workerId: string,
  info: Record<string, unknown> | null
): Promise<void> {
  await db(container).raw(
    `INSERT INTO catalog_sync_setting (id, worker_seen_at, worker_id, worker_info)
     VALUES (:id, NOW(), :worker, :info::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       worker_seen_at = NOW(), worker_id = EXCLUDED.worker_id, worker_info = EXCLUDED.worker_info`,
    { id: SETTINGS_ID, worker: workerId, info: json(info) }
  );
}

export async function listRuns(container: MedusaContainer, limit = 15): Promise<any[]> {
  const { rows } = await db(container).raw(
    `SELECT ${LIST_COLUMNS} FROM catalog_sync_run
      WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT :limit`,
    { limit }
  );
  return rows;
}

export async function getRun(container: MedusaContainer, id: string): Promise<any | null> {
  const { rows } = await db(container).raw(
    `SELECT * FROM catalog_sync_run WHERE id = :id AND deleted_at IS NULL`,
    { id }
  );
  return rows[0] ?? null;
}

/** The latest run that finished (any outcome) — what "the last run" means to the owner. */
export async function lastFinishedRun(container: MedusaContainer): Promise<any | null> {
  const { rows } = await db(container).raw(
    `SELECT * FROM catalog_sync_run
      WHERE deleted_at IS NULL AND finished_at IS NOT NULL
      ORDER BY finished_at DESC LIMIT 1`
  );
  return rows[0] ?? null;
}

export async function activeRun(container: MedusaContainer): Promise<any | null> {
  const { rows } = await db(container).raw(
    `SELECT ${LIST_COLUMNS} FROM catalog_sync_run
      WHERE deleted_at IS NULL AND status IN ('queued', 'running')
      ORDER BY created_at ASC LIMIT 1`
  );
  return rows[0] ?? null;
}

export async function latestScheduleSlot(container: MedusaContainer): Promise<string | null> {
  const { rows } = await db(container).raw(
    `SELECT schedule_slot FROM catalog_sync_run
      WHERE deleted_at IS NULL AND schedule_slot IS NOT NULL
      ORDER BY schedule_slot DESC LIMIT 1`
  );
  return rows[0]?.schedule_slot ?? null;
}

/**
 * Queues a run from the panel. Refused while another is queued or running: two
 * scrapes of the same supplier in parallel would only fight over the same rows.
 */
export async function queueManualRun(
  container: MedusaContainer,
  options: RunOptions,
  actorId: string | null
): Promise<{ run: any } | { active: any }> {
  const active = await activeRun(container);
  if (active) return { active };
  const { rows } = await db(container).raw(
    `INSERT INTO catalog_sync_run (id, trigger, status, requested_by, options)
     VALUES (:id, 'manual', 'queued', :actor, :options::jsonb)
     RETURNING ${LIST_COLUMNS}`,
    { id: generateEntityId("", "csrun"), actor: actorId, options: json(options) }
  );
  return { run: rows[0] };
}

/**
 * Queues this month's scheduled run. The unique index on `schedule_slot` makes
 * it idempotent: the job can fire every 15 minutes and the month gets one run.
 * Returns null when the month already had it.
 *
 * Skipped (not deferred) when a manual run is active: the owner just asked for
 * the same work, and the month counts as done.
 */
export async function queueScheduledRun(
  container: MedusaContainer,
  options: RunOptions,
  now: Date
): Promise<any | null> {
  const active = await activeRun(container);
  const { rows } = await db(container).raw(
    `INSERT INTO catalog_sync_run (id, trigger, status, schedule_slot, options, finished_at, error_reason)
     VALUES (:id, 'schedule', :status, :slot, :options::jsonb, :finished, :reason)
     ON CONFLICT (schedule_slot) WHERE schedule_slot IS NOT NULL AND deleted_at IS NULL DO NOTHING
     RETURNING ${LIST_COLUMNS}`,
    {
      id: generateEntityId("", "csrun"),
      status: active ? "canceled" : "queued",
      slot: scheduleSlot(now),
      options: json(options),
      finished: active ? now.toISOString() : null,
      reason: active ? "superseded" : null,
    }
  );
  return rows[0] ?? null;
}

/**
 * Hands the oldest queued run to a worker, atomically. Nothing is handed out
 * while another run is `running`: one scrape at a time, even with two workers.
 */
export async function claimRun(container: MedusaContainer, workerId: string): Promise<any | null> {
  const { rows } = await db(container).raw(
    `UPDATE catalog_sync_run
        SET status = 'running', worker_id = :worker, started_at = NOW(),
            heartbeat_at = NOW(), updated_at = NOW()
      WHERE id = (
        SELECT id FROM catalog_sync_run
         WHERE status = 'queued' AND deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM catalog_sync_run r
              WHERE r.status = 'running' AND r.deleted_at IS NULL)
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED)
      RETURNING ${LIST_COLUMNS}`,
    { worker: workerId }
  );
  return rows[0] ?? null;
}

/**
 * Heartbeat + progress. Returns whether the owner asked to cancel, or `gone`
 * when the run is no longer this worker's to report on (declared lost, or
 * claimed by another worker) — the worker must stop then.
 */
export async function reportProgress(
  container: MedusaContainer,
  id: string,
  workerId: string,
  progress: Record<string, unknown> | null,
  logTail: string | null
): Promise<{ gone: true } | { gone: false; cancel_requested: boolean }> {
  const { rows } = await db(container).raw(
    `UPDATE catalog_sync_run
        SET heartbeat_at = NOW(), updated_at = NOW(),
            progress = COALESCE(:progress::jsonb, progress),
            log_tail = COALESCE(:log, log_tail)
      WHERE id = :id AND worker_id = :worker AND status = 'running' AND deleted_at IS NULL
      RETURNING cancel_requested`,
    { id, worker: workerId, progress: json(progress), log: logTail }
  );
  if (!rows[0]) return { gone: true };
  return { gone: false, cancel_requested: Boolean(rows[0].cancel_requested) };
}

export async function finishRun(
  container: MedusaContainer,
  id: string,
  workerId: string,
  result: {
    status: FinalStatus;
    summary: unknown;
    new_products: unknown;
    errors: unknown;
    error_reason: string | null;
    log_tail: string | null;
  }
): Promise<any | null> {
  const { rows } = await db(container).raw(
    `UPDATE catalog_sync_run
        SET status = :status, finished_at = NOW(), heartbeat_at = NOW(), updated_at = NOW(),
            summary = :summary::jsonb, new_products = :products::jsonb, errors = :errors::jsonb,
            error_reason = :reason, log_tail = COALESCE(:log, log_tail)
      WHERE id = :id AND worker_id = :worker AND status = 'running' AND deleted_at IS NULL
      RETURNING ${LIST_COLUMNS}`,
    {
      id,
      worker: workerId,
      status: result.status,
      summary: json(result.summary),
      products: json(result.new_products),
      errors: json(result.errors),
      reason: result.error_reason,
      log: result.log_tail,
    }
  );
  return rows[0] ?? null;
}

/**
 * A queued run is canceled on the spot; a running one is flagged, and the
 * worker stops at the next product (what it already pushed stays pushed).
 */
export async function cancelRun(
  container: MedusaContainer,
  id: string
): Promise<"canceled" | "requested" | "not_active"> {
  const { rows } = await db(container).raw(
    `UPDATE catalog_sync_run
        SET status = CASE WHEN status = 'queued' THEN 'canceled' ELSE status END,
            finished_at = CASE WHEN status = 'queued' THEN NOW() ELSE finished_at END,
            cancel_requested = TRUE, updated_at = NOW()
      WHERE id = :id AND status IN ('queued', 'running') AND deleted_at IS NULL
      RETURNING status`,
    { id }
  );
  if (!rows[0]) return "not_active";
  return rows[0].status === "canceled" ? "canceled" : "requested";
}

/** Runs whose worker stopped reporting are failed with `worker_lost`. Returns how many. */
export async function failStaleRuns(container: MedusaContainer, now: Date): Promise<number> {
  const { rowCount } = await db(container).raw(
    `UPDATE catalog_sync_run
        SET status = 'failed', error_reason = 'worker_lost', finished_at = NOW(), updated_at = NOW()
      WHERE status = 'running' AND deleted_at IS NULL
        AND COALESCE(heartbeat_at, started_at, created_at) < :cutoff`,
    { cutoff: new Date(now.getTime() - STALE_AFTER_MS).toISOString() }
  );
  return Number(rowCount ?? 0);
}

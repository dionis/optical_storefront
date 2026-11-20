import { model } from "@medusajs/framework/utils";

/**
 * One execution of the catalog scraper (`python -m scraper worker`).
 *
 * The panel queues a row (`queued`), the worker running in its own Coolify app
 * claims it (`running`), reports progress and, at the end, the summary the owner
 * reads. The worker never decides WHEN to run: Medusa does, either because
 * somebody pressed the button or because the monthly schedule came due — so the
 * history, the schedule and the "run now" button live in one place.
 */
export const CatalogSyncRun = model.define("catalog_sync_run", {
  id: model.id({ prefix: "csrun" }).primaryKey(),
  /** `manual` (panel button) or `schedule` (the monthly job). */
  trigger: model.enum(["manual", "schedule"]),
  /**
   * `partial`: it finished but some products failed or a collection came back
   * empty. `canceled`: stopped from the panel. `failed`: the run itself broke
   * (`error_reason`), including `worker_lost` when its heartbeat stopped.
   */
  status: model
    .enum(["queued", "running", "succeeded", "partial", "failed", "canceled"])
    .default("queued"),
  /** Medusa user who pressed the button; null for scheduled runs. */
  requested_by: model.text().nullable(),
  /**
   * Unique per scheduled month ("2026-11"), null for manual runs. The unique
   * index is what keeps the job from queueing the same month twice.
   */
  schedule_slot: model.text().nullable(),
  /** `{ full, collection, views_max_cost }` as the worker must execute them. */
  options: model.json().nullable(),
  /** Set from the panel while running; the worker stops at the next product. */
  cancel_requested: model.boolean().default(false),
  worker_id: model.text().nullable(),
  started_at: model.dateTime().nullable(),
  finished_at: model.dateTime().nullable(),
  /** Last progress report. Older than the stale window → `worker_lost`. */
  heartbeat_at: model.dateTime().nullable(),
  /** `{ phase, collection, position, total, collections_done, collections_total }` */
  progress: model.json().nullable(),
  /** Counts the owner reads — see `RunSummary` in src/lib/catalog-sync.ts. */
  summary: model.json().nullable(),
  /** `[{ handle, title, brand, thumbnail, colors }]` — the new models of this run. */
  new_products: model.json().nullable(),
  /** `[{ handle, message }]`, capped. Supplier/Medusa text: log, not copy. */
  errors: model.json().nullable(),
  /** Machine code when the run itself failed (`worker_lost`, `config_error`, `crashed`…). */
  error_reason: model.text().nullable(),
  /** Last lines of the worker's log, for the panel's "ver registro". */
  log_tail: model.text().nullable(),
});

import { model } from "@medusajs/framework/utils";

/**
 * The owner's choices for the catalog scraper — a single row (id "default").
 * Until it exists the defaults in src/lib/catalog-sync.ts apply: monthly, on the
 * 1st at 06:00 UTC, incremental, views generated for new models up to $10.
 *
 * It also records the last time a worker checked in, which is how the panel can
 * say "no worker is connected" instead of leaving a queued run looking stuck.
 */
export const CatalogSyncSetting = model.define("catalog_sync_setting", {
  id: model.id().primaryKey(),
  schedule_enabled: model.boolean().default(true),
  /** 1–28, so every month has the day. */
  schedule_day: model.number().default(1),
  /** 0–23, UTC — the server's clock, not the store's. */
  schedule_hour: model.number().default(6),
  /** Scheduled runs re-process everything and draft discontinued models. */
  schedule_full: model.boolean().default(false),
  /**
   * USD cap for generating the 4 views of the NEW models of each run. 0 means
   * "queue them only" (free); the frame-media monthly ceiling still applies.
   */
  views_max_cost: model.float().default(10),
  worker_seen_at: model.dateTime().nullable(),
  worker_id: model.text().nullable(),
  worker_info: model.json().nullable(),
  updated_by: model.text().nullable(),
});

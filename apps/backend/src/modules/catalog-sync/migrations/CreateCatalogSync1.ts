import { Migration } from "@mikro-orm/migrations";

/**
 * Catalog scraper runs and the owner's schedule. Hand-written to match the
 * module's models and the project's migration style (see CreateStoreSetting1).
 * Configuration and history: never part of the order purge.
 */
export class CreateCatalogSync1 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS catalog_sync_run (
        id                TEXT PRIMARY KEY,
        trigger           TEXT NOT NULL CHECK (trigger IN ('manual', 'schedule')),
        status            TEXT NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued', 'running', 'succeeded', 'partial', 'failed', 'canceled')),
        requested_by      TEXT,
        schedule_slot     TEXT,
        options           JSONB,
        cancel_requested  BOOLEAN NOT NULL DEFAULT FALSE,
        worker_id         TEXT,
        started_at        TIMESTAMPTZ,
        finished_at       TIMESTAMPTZ,
        heartbeat_at      TIMESTAMPTZ,
        progress          JSONB,
        summary           JSONB,
        new_products      JSONB,
        errors            JSONB,
        error_reason      TEXT,
        log_tail          TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ
      );
    `);
    // One scheduled run per month, whatever the job's timing does.
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_catalog_sync_run_schedule_slot"
        ON catalog_sync_run (schedule_slot)
        WHERE schedule_slot IS NOT NULL AND deleted_at IS NULL;
    `);
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_catalog_sync_run_status_created"
        ON catalog_sync_run (status, created_at)
        WHERE deleted_at IS NULL;
    `);
    this.addSql(`
      CREATE TABLE IF NOT EXISTS catalog_sync_setting (
        id                TEXT PRIMARY KEY,
        schedule_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
        schedule_day      INTEGER NOT NULL DEFAULT 1,
        schedule_hour     INTEGER NOT NULL DEFAULT 6,
        schedule_full     BOOLEAN NOT NULL DEFAULT FALSE,
        views_max_cost    DOUBLE PRECISION NOT NULL DEFAULT 10,
        worker_seen_at    TIMESTAMPTZ,
        worker_id         TEXT,
        worker_info       JSONB,
        updated_by        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ
      );
    `);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS catalog_sync_run;`);
    this.addSql(`DROP TABLE IF EXISTS catalog_sync_setting;`);
  }
}

import { Migration } from "@mikro-orm/migrations";

/** AI consumption, the owner's credit entries and the low-balance alerts. */
export class CreateAiUsage1 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS ai_usage_event (
        id                TEXT PRIMARY KEY,
        provider          TEXT NOT NULL,
        model             TEXT,
        activity          TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'no_credit')),
        input_tokens      INTEGER,
        output_tokens     INTEGER,
        cost_usd          DOUBLE PRECISION NOT NULL DEFAULT 0,
        priced            TEXT NOT NULL DEFAULT 'estimated' CHECK (priced IN ('estimated', 'reported', 'unpriced')),
        rate_note         TEXT,
        event_key         TEXT,
        ref_id            TEXT,
        establishment_id  TEXT,
        notified_at       TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ
      );
    `);
    // Idempotent recording: a polled job result or a retried report counts once.
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ai_usage_event_key" ON "ai_usage_event" ("event_key") WHERE event_key IS NOT NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_usage_event_provider_created" ON "ai_usage_event" ("provider", "created_at");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_usage_event_created" ON "ai_usage_event" ("created_at");`);
    this.addSql(`
      CREATE TABLE IF NOT EXISTS ai_credit_entry (
        id            TEXT PRIMARY KEY,
        provider      TEXT NOT NULL,
        kind          TEXT NOT NULL DEFAULT 'deposit' CHECK (kind IN ('deposit', 'balance')),
        amount_usd    DOUBLE PRECISION NOT NULL,
        effective_at  TIMESTAMPTZ NOT NULL,
        note          TEXT,
        created_by    TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at    TIMESTAMPTZ
      );
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ai_credit_entry_provider" ON "ai_credit_entry" ("provider", "effective_at");`);
    this.addSql(`
      CREATE TABLE IF NOT EXISTS ai_credit_alert (
        id           TEXT PRIMARY KEY,
        provider     TEXT NOT NULL,
        unit         TEXT NOT NULL DEFAULT 'usd' CHECK (unit IN ('usd', 'percent', 'days')),
        threshold    DOUBLE PRECISION NOT NULL,
        recipients   JSONB,
        locale       TEXT NOT NULL DEFAULT 'es',
        is_active    BOOLEAN NOT NULL DEFAULT TRUE,
        fired_cycle  TEXT,
        fired_at     TIMESTAMPTZ,
        created_by   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at   TIMESTAMPTZ
      );
    `);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS ai_credit_alert;`);
    this.addSql(`DROP TABLE IF EXISTS ai_credit_entry;`);
    this.addSql(`DROP TABLE IF EXISTS ai_usage_event;`);
  }
}

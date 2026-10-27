import { Migration } from "@mikro-orm/migrations";

/** Alert rules and the history of alerts sent (functional document E7). */
export class CreateSalesAlert1 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS alert_rule (
        id                 TEXT PRIMARY KEY,
        name               TEXT NOT NULL,
        event              TEXT NOT NULL,
        conditions         JSONB,
        establishment_ids  JSONB,
        seller_ids         JSONB,
        recipients         JSONB NOT NULL,
        mode               TEXT NOT NULL DEFAULT 'immediate' CHECK (mode IN ('immediate', 'every_n_hours', 'daily', 'weekly')),
        schedule           JSONB,
        locale             TEXT NOT NULL DEFAULT 'es',
        is_active          BOOLEAN NOT NULL DEFAULT TRUE,
        last_sent_at       TIMESTAMPTZ,
        created_by         TEXT,
        updated_by         TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at         TIMESTAMPTZ
      );
    `);
    this.addSql(`
      CREATE TABLE IF NOT EXISTS alert_delivery (
        id               TEXT PRIMARY KEY,
        rule_id          TEXT NOT NULL,
        event            TEXT NOT NULL,
        event_key        TEXT NOT NULL,
        recipient_email  TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
        error            TEXT,
        payload          JSONB,
        sent_at          TIMESTAMPTZ,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at       TIMESTAMPTZ
      );
    `);
    // Idempotent against subscriber retries.
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_alert_delivery_once" ON "alert_delivery" ("rule_id", "event_key", "recipient_email");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_alert_delivery_status" ON "alert_delivery" ("status", "rule_id");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_alert_delivery_created" ON "alert_delivery" ("created_at");`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS alert_delivery;`);
    this.addSql(`DROP TABLE IF EXISTS alert_rule;`);
  }
}

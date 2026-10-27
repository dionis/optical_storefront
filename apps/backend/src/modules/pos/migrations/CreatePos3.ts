import { Migration } from "@mikro-orm/migrations";

/**
 * Cash register (caja) per till (HU-32): opened with a float, cash in and out
 * recorded, closed with the count; the difference is recorded and alerts.
 */
export class CreatePos3 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS cash_session (
        id                TEXT PRIMARY KEY,
        establishment_id  TEXT NOT NULL,
        terminal_id       TEXT NOT NULL,
        opened_by         TEXT,
        opened_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        opening_cents     INTEGER NOT NULL DEFAULT 0,
        closed_by         TEXT,
        closed_at         TIMESTAMPTZ,
        expected_cents    INTEGER,
        counted_cents     INTEGER,
        diff_cents        INTEGER,
        note              TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ
      );
    `);
    // One open register per till.
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cash_session_open" ON "cash_session" ("terminal_id") WHERE closed_at IS NULL AND deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cash_session_store" ON "cash_session" ("establishment_id", "opened_at");`);
    this.addSql(`
      CREATE TABLE IF NOT EXISTS cash_movement (
        id             TEXT PRIMARY KEY,
        session_id     TEXT NOT NULL,
        kind           TEXT NOT NULL CHECK (kind IN ('in', 'out')),
        amount_cents   INTEGER NOT NULL,
        note           TEXT,
        created_by     TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at     TIMESTAMPTZ
      );
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cash_movement_session" ON "cash_movement" ("session_id");`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS cash_movement;`);
    this.addSql(`DROP TABLE IF EXISTS cash_session;`);
  }
}

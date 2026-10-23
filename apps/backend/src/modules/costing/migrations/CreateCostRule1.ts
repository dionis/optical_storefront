import { Migration } from "@mikro-orm/migrations";

/**
 * Cost rules (ficha de costo). Hand-written to match the module's model and
 * the project's migration style (see CreateStoreSetting1).
 */
export class CreateCostRule1 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS cost_rule (
        id          TEXT PRIMARY KEY,
        kind        TEXT NOT NULL,
        match_key   TEXT NOT NULL,
        label       TEXT NOT NULL,
        amount      NUMERIC NOT NULL DEFAULT 0,
        unit        TEXT NOT NULL DEFAULT 'fixed',
        active      BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        notes       TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at  TIMESTAMPTZ
      );
    `);
    // (kind, match_key) unique among live rows; a soft-deleted rule frees it.
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cost_rule_kind_key_unique" ON "cost_rule" ("kind", "match_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cost_rule_deleted_at" ON "cost_rule" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS cost_rule;`);
  }
}

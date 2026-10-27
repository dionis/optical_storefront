import { Migration } from "@mikro-orm/migrations";

/** Fixed, variable and shared costs per store (functional document E13). */
export class CreateCostItem1 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS cost_item (
        id                TEXT PRIMARY KEY,
        establishment_id  TEXT,
        kind              TEXT NOT NULL CHECK (kind IN ('fixed', 'variable')),
        category          TEXT NOT NULL,
        description       TEXT,
        amount_cents      INTEGER NOT NULL,
        frequency         TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'quarterly', 'annual', 'one_time')),
        amortize_months   INTEGER,
        starts_on         TEXT NOT NULL,
        ends_on           TEXT,
        vendor            TEXT,
        attachment_key    TEXT,
        allocation        JSONB,
        notes             TEXT,
        created_by        TEXT,
        updated_by        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ
      );
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cost_item_store" ON "cost_item" ("establishment_id");`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS cost_item;`);
  }
}

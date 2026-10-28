import { Migration } from "@mikro-orm/migrations";

/**
 * Per-store assortment: brands and models a store does (not) expose for sale.
 * Hand-written to match the module's model (see CreatePriceRule1).
 */
export class CreateStoreAssortmentRule1 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS store_assortment_rule (
        id                TEXT PRIMARY KEY,
        establishment_id  TEXT NOT NULL,
        scope             TEXT NOT NULL CHECK (scope IN ('brand', 'product')),
        target            TEXT NOT NULL,
        exposed           BOOLEAN NOT NULL,
        created_by        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ
      );
    `);
    // One live rule per (store, scope, target): the write is an upsert.
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_store_assortment_rule_key" ON "store_assortment_rule" ("establishment_id", "scope", "target") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_store_assortment_rule_deleted_at" ON "store_assortment_rule" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS store_assortment_rule;`);
  }
}

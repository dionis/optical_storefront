import { Migration } from "@mikro-orm/migrations";

/**
 * `store_item_discount`: the owner's promotion on one article in one store
 * (models/item-discount.ts, docs/PRICE-MATRIX.md).
 *
 * NOTHING IS SEEDED: on the day this runs no article has a discount and every
 * price is exactly what it was.
 *
 * One live row per (store, kind, key) — the partial unique index — so a new
 * percentage replaces the old one instead of stacking a second answer.
 *
 * Idempotent (IF NOT EXISTS everywhere): the migration runs on every deploy.
 * It creates its own table and touches no other, so its place in the module's
 * file-name order (between CreateStoreFrameCostVariation5 and
 * CreateStorePriceBand6) is harmless — tests/migration-order.test.ts.
 */
export class CreateStoreItemDiscount7 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS store_item_discount (
        id               TEXT PRIMARY KEY,
        establishment_id TEXT NOT NULL,
        item_kind        TEXT NOT NULL,
        item_key         TEXT NOT NULL,
        pct              REAL NOT NULL DEFAULT 0,
        created_by       TEXT,
        updated_by       TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at       TIMESTAMPTZ
      );
    `);
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_store_item_discount_item
        ON store_item_discount (establishment_id, item_kind, item_key)
        WHERE deleted_at IS NULL;
    `);
    // The till reads one store's discounts per quote.
    this.addSql(`
      CREATE INDEX IF NOT EXISTS idx_store_item_discount_store
        ON store_item_discount (establishment_id)
        WHERE deleted_at IS NULL;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS store_item_discount;`);
  }
}

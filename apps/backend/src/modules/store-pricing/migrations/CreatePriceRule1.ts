import { Migration } from "@mikro-orm/migrations";

/**
 * Price rules: owner's global prices and each store's adjustment and exact
 * prices. Hand-written to match the module's model (see CreateSeller1).
 */
export class CreatePriceRule1 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS store_price_rule (
        id                TEXT PRIMARY KEY,
        establishment_id  TEXT,
        scope             TEXT NOT NULL CHECK (scope IN ('all', 'frame', 'case')),
        target            TEXT,
        mode              TEXT NOT NULL CHECK (mode IN ('percent', 'delta', 'override')),
        value             NUMERIC NOT NULL,
        valid_from        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        valid_to          TIMESTAMPTZ,
        source            TEXT,
        created_by        TEXT,
        closed_by         TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ
      );
    `);
    // The lookups: current rules of a store, and the global price of a product.
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_store_price_rule_establishment_open" ON "store_price_rule" ("establishment_id") WHERE valid_to IS NULL AND deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_store_price_rule_target_open" ON "store_price_rule" ("scope", "target") WHERE valid_to IS NULL AND deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_store_price_rule_deleted_at" ON "store_price_rule" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS store_price_rule;`);
  }
}

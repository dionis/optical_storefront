import { Migration } from "@mikro-orm/migrations";

/**
 * Per-store cost switches and the pricing panel's own settings.
 *
 *  - `store_cost_toggle`: a store turning one cost OFF (or back ON). Absence
 *    means enabled, so an empty table behaves exactly like before.
 *  - `store_pricing_setting`: key/value numbers the pricing panel owns — today only
 *    `default_commission_pct`.
 *
 * Named to sort after CreatePriceRule1 / CreatePriceRuleMinMode2: Medusa runs a
 * module's migrations in FILE-NAME order (see tests/migration-order.test.ts), so
 * "CreateS…" after "CreateP…" is what makes this safe on an empty database.
 */
export class CreateStoreCostToggle3 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS store_cost_toggle (
        id               TEXT PRIMARY KEY,
        establishment_id TEXT NOT NULL,
        ref_kind         TEXT NOT NULL,
        ref_id           TEXT NOT NULL,
        enabled          BOOLEAN NOT NULL DEFAULT TRUE,
        created_by       TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at       TIMESTAMPTZ
      );
    `);
    this.addSql(`
      ALTER TABLE store_cost_toggle DROP CONSTRAINT IF EXISTS store_cost_toggle_ref_kind_check;
    `);
    this.addSql(`
      ALTER TABLE store_cost_toggle ADD CONSTRAINT store_cost_toggle_ref_kind_check CHECK (ref_kind IN ('rule', 'cost'));
    `);
    // One live switch per (store, kind, reference): a change updates the row.
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_store_cost_toggle_ref
        ON store_cost_toggle (establishment_id, ref_kind, ref_id)
        WHERE deleted_at IS NULL;
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS store_pricing_setting (
        id         TEXT PRIMARY KEY,
        key        TEXT NOT NULL,
        value      DOUBLE PRECISION NOT NULL DEFAULT 0,
        updated_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
    `);
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_setting_key
        ON store_pricing_setting (key)
        WHERE deleted_at IS NULL;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS store_cost_toggle;`);
    this.addSql(`DROP TABLE IF EXISTS store_pricing_setting;`);
  }
}

import { Migration } from "@mikro-orm/migrations";

/**
 * «Reglas y comisiones» in one view + the financial statement (7-nov-2026).
 *
 *  - frequency: daily, weekly and biweekly join the four there were. The
 *    CHECK is replaced, never the column: every existing row keeps its value.
 *  - tax_category: the IRS-style bucket of the statement. Backfilled from the
 *    owner's category with the same map as lib/store-costs.ts CATEGORY_TAX, so
 *    no row is left without one and the code's fallback agrees with the data.
 *  - active: every existing row is active, except the ones a store had
 *    switched off in «Precios y costos» for ITSELF (store_cost_toggle,
 *    ref_kind 'cost', on the store that owns the item): that switch said «no se
 *    cobra», and now the result honours it. A switch on a SHARED item stays a
 *    switch (it never changed a figure and still does not).
 *  - per_sale: «se cobra en cada venta», false for every existing row.
 *
 * Idempotent (IF NOT EXISTS / IS NULL guards): safe to run twice, and while
 * another migration of another module runs.
 */
export class StoreCostFinance2 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE cost_item DROP CONSTRAINT IF EXISTS cost_item_frequency_check;`);
    this.addSql(`ALTER TABLE cost_item ADD CONSTRAINT cost_item_frequency_check CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annual', 'one_time'));`);
    this.addSql(`ALTER TABLE cost_item ADD COLUMN IF NOT EXISTS tax_category TEXT;`);
    this.addSql(`ALTER TABLE cost_item ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;`);
    this.addSql(`ALTER TABLE cost_item ADD COLUMN IF NOT EXISTS per_sale BOOLEAN NOT NULL DEFAULT FALSE;`);
    this.addSql(`
      UPDATE cost_item SET tax_category = CASE category
        WHEN 'rent' THEN 'rent'
        WHEN 'maintenance' THEN 'repairs'
        WHEN 'utilities' THEN 'utilities'
        WHEN 'salaries' THEN 'payroll'
        WHEN 'insurance' THEN 'insurance'
        WHEN 'licenses' THEN 'taxes_licenses'
        WHEN 'subscriptions' THEN 'software'
        WHEN 'equipment' THEN 'depreciation'
        WHEN 'supplies' THEN 'supplies'
        WHEN 'shipping' THEN 'other'
        WHEN 'repairs' THEN 'repairs'
        WHEN 'remakes' THEN 'cost_of_goods'
        WHEN 'accounting' THEN 'professional_fees'
        ELSE 'other' END
      WHERE tax_category IS NULL;
    `);
    this.addSql(`
      DO $$
      BEGIN
        IF to_regclass('public.store_cost_toggle') IS NOT NULL THEN
          UPDATE cost_item c SET active = FALSE
            FROM store_cost_toggle t
           WHERE t.ref_kind = 'cost' AND t.enabled = FALSE AND t.deleted_at IS NULL
             AND t.ref_id = c.id AND t.establishment_id = c.establishment_id;
        END IF;
      END $$;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE cost_item DROP COLUMN IF EXISTS per_sale;`);
    this.addSql(`ALTER TABLE cost_item DROP COLUMN IF EXISTS active;`);
    this.addSql(`ALTER TABLE cost_item DROP COLUMN IF EXISTS tax_category;`);
    this.addSql(`UPDATE cost_item SET frequency = 'monthly' WHERE frequency IN ('daily', 'weekly', 'biweekly');`);
    this.addSql(`ALTER TABLE cost_item DROP CONSTRAINT IF EXISTS cost_item_frequency_check;`);
    this.addSql(`ALTER TABLE cost_item ADD CONSTRAINT cost_item_frequency_check CHECK (frequency IN ('monthly', 'quarterly', 'annual', 'one_time'));`);
  }
}

import { Migration } from "@mikro-orm/migrations";

/**
 * «N × costo + $ fijo» (owner, 19-nov-2026: «precio de costo de Capri × 2.9
 * + $1.00 = precio Rubi-Lens»): a store's `cost_multiple` rule may carry a
 * fixed amount in dollars added after the multiple. `addend` is only read
 * for `mode = 'cost_multiple'`; every existing row gets 0, which is exactly
 * the price it produced before (lib/cost-multiple.ts).
 *
 * Named to sort after UpgradeStoreFrameCostPrev9 and UpgradePriceRuleCostMultiple10. Idempotent.
 */
export class UpgradeStoreRuleAddend11 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE store_price_rule ADD COLUMN IF NOT EXISTS addend NUMERIC NOT NULL DEFAULT 0;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE store_price_rule DROP COLUMN IF EXISTS addend;`);
  }
}

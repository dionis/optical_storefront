import { Migration } from "@mikro-orm/migrations";

/**
 * A store's frame rule can be «N veces el costo de la montura» (owner,
 * 13-nov-2026: «la regla para los espejuelos que se venden en la tienda online
 * sea 3 veces su costo»): `mode = 'cost_multiple'`, scope "frame", no target,
 * value = N. The rule row is the owner's decision; the prices it produces are
 * written as exact prices of each model with `source = 'cost_multiple'`
 * (lib/cost-multiple.ts), so every screen and the web read them like any
 * other store price.
 *
 * Named to sort after UpgradeStoreFrameCostPrev9. Idempotent.
 */
export class UpgradePriceRuleCostMultiple10 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE store_price_rule DROP CONSTRAINT IF EXISTS store_price_rule_mode_check;`);
    this.addSql(`ALTER TABLE store_price_rule ADD CONSTRAINT store_price_rule_mode_check CHECK (mode IN ('percent', 'delta', 'override', 'min', 'cost_multiple'));`);
  }

  async down(): Promise<void> {
    this.addSql(`DELETE FROM store_price_rule WHERE mode = 'cost_multiple' OR source = 'cost_multiple';`);
    this.addSql(`ALTER TABLE store_price_rule DROP CONSTRAINT IF EXISTS store_price_rule_mode_check;`);
    this.addSql(`ALTER TABLE store_price_rule ADD CONSTRAINT store_price_rule_mode_check CHECK (mode IN ('percent', 'delta', 'override', 'min'));`);
  }
}

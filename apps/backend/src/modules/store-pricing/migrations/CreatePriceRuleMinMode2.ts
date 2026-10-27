import { Migration } from "@mikro-orm/migrations";

/**
 * Minimum price (HU-16), as one more rule mode so it gets the same history and
 * scheduling as every other price:
 *
 *  - scope "frame"/"case" + mode "min": lowest price the frame of that model
 *    may be sold at after a discount (value in dollars);
 *  - scope "all" + mode "min": floor of a sale line as a percentage of its
 *    list price (value 70 = never below 70 % of the list).
 *
 * Named to sort after CreatePriceRule1, which creates the table.
 */
export class CreatePriceRuleMinMode2 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE price_rule DROP CONSTRAINT IF EXISTS price_rule_mode_check;`);
    this.addSql(`ALTER TABLE price_rule ADD CONSTRAINT price_rule_mode_check CHECK (mode IN ('percent', 'delta', 'override', 'min'));`);
  }

  async down(): Promise<void> {
    this.addSql(`DELETE FROM price_rule WHERE mode = 'min';`);
    this.addSql(`ALTER TABLE price_rule DROP CONSTRAINT IF EXISTS price_rule_mode_check;`);
    this.addSql(`ALTER TABLE price_rule ADD CONSTRAINT price_rule_mode_check CHECK (mode IN ('percent', 'delta', 'override'));`);
  }
}

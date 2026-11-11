import { Migration } from "@mikro-orm/migrations";

/**
 * A lens cell (design × material × finish) can be HIDDEN without deleting it
 * (owner, 11-nov-2026: «puede que en algún momento no se haga alguno de estos
 * trabajos»): `lens_base_price.is_active`. A hidden cell keeps its price, its
 * lab cost and every store's price and discount, but is not offered — not at
 * the till, not on the web — and a quote for it is refused the way a cell
 * with no price is (`finish_unavailable`). Past sales keep their figures.
 * Switching it back on brings everything back as it was.
 *
 * Named to sort AFTER UpgradeLensPhotoCostByCategory10 (file-name order,
 * tests/migration-order.test.ts). Idempotent.
 */
export class UpgradeLensCellActive11 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE lens_base_price ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE lens_base_price DROP COLUMN IF EXISTS is_active;`);
  }
}

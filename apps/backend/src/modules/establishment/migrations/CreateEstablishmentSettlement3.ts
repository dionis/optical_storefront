import { Migration } from "@mikro-orm/migrations";

/**
 * Settlement with family, partner or consignment stores (HU-33): the share of
 * the net sales the store keeps. The owner's decision on each relationship is
 * still pending, so it is a number the owner sets per store (null = none).
 * Sorted after CreateEstablishment1, which creates the table.
 */
export class CreateEstablishmentSettlement3 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE establishment ADD COLUMN IF NOT EXISTS settlement_pct REAL;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE establishment DROP COLUMN IF EXISTS settlement_pct;`);
  }
}

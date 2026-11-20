import { Migration } from "@mikro-orm/migrations";

/**
 * A sale recorded with patient data missing (owner, 17-nov-2026: «se debe
 * poder registrar la venta aunque falten datos porque luego se puede editar»):
 * `pos_sale.missing` = the keys still to complete (first_name, last_name,
 * phone, address — lib/pos.ts missingCustomerData), recomputed when the sale
 * is corrected. NULL / [] = nothing missing. The prescription and the deposit
 * are read live (rx_pending, paid), not stored. Idempotent.
 */
export class CreatePos10 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS missing JSONB;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE pos_sale DROP COLUMN IF EXISTS missing;`);
  }
}

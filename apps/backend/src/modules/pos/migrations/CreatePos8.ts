import { Migration } from "@mikro-orm/migrations";

/**
 * Correcting the payments of a sale (owner, 15-nov-2026;
 * lib/payment-correction-data.ts): a payment row that was corrected after it
 * was taken says so, with its history.
 *  - `corrected_at` / `corrected_by`: the last correction.
 *  - `corrections`: every correction of the row, oldest first —
 *    [{ at, by, action: edit|delete|add, reason, note, from, to }].
 *
 *
 * And a sale whose prescription comes later (lib/rx-pending.ts):
 *  - `pos_sale.rx_pending`: lenses sold before the exam; cleared when the
 *    prescription is added from the sale.
 *
 * Idempotent: every statement tolerates having run before.
 */
export class CreatePos8 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE pos_sale_payment ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ;`);
    this.addSql(`ALTER TABLE pos_sale_payment ADD COLUMN IF NOT EXISTS corrected_by TEXT;`);
    this.addSql(`ALTER TABLE pos_sale_payment ADD COLUMN IF NOT EXISTS corrections JSONB;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS rx_pending BOOLEAN NOT NULL DEFAULT false;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE pos_sale DROP COLUMN IF EXISTS rx_pending;`);
    this.addSql(`ALTER TABLE pos_sale_payment DROP COLUMN IF EXISTS corrections;`);
    this.addSql(`ALTER TABLE pos_sale_payment DROP COLUMN IF EXISTS corrected_by;`);
    this.addSql(`ALTER TABLE pos_sale_payment DROP COLUMN IF EXISTS corrected_at;`);
  }
}

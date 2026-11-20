import { Migration } from "@mikro-orm/migrations";

/**
 * A sale recorded with an earlier date (owner, 18-nov-2026: «cuando se
 * registre una venta se debe poder poner fecha retroactiva»): the sale's
 * `created_at` is the day it happened, and `pos_sale.backdate` keeps when it
 * was really recorded, by whom, the day/time chosen and the note
 * (lib/sale-date.ts BackdateRecord). NULL = recorded the day it happened.
 * Idempotent.
 */
export class CreatePos11 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS backdate JSONB;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE pos_sale DROP COLUMN IF EXISTS backdate;`);
  }
}

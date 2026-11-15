import { Migration } from "@mikro-orm/migrations";

/**
 * The promotion a sale used (lib/promotions.ts): a copy, so the receipt and
 * the reports keep saying what it was after the owner edits or deletes it —
 * { id, name, kind, pct, buy_qty, get_qty, value_cents, ref, priced }.
 * NULL = no promotion. Idempotent.
 */
export class CreatePos9 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS promotion JSONB;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE pos_sale DROP COLUMN IF EXISTS promotion;`);
  }
}

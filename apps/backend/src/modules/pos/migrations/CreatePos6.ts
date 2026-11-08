import { Migration } from "@mikro-orm/migrations";

/**
 * Editing, deleting and moving a sale (owner, 8-nov-2026; lib/pos-sale-admin.ts):
 *  - `internal_note`, `edited_at`, `edited_by`: the details the seller who made
 *    the sale, or someone above them, may correct afterwards (never the money).
 *  - `deleted_by`, `delete_reason`: who hid the sale and why. The sale keeps
 *    its row (`deleted_at`, Medusa's column) so an owner or superadmin can
 *    restore it; its number is never reused.
 *  - `previous_numbers`: the numbers it had in other stores before a move.
 *
 * Idempotent: every statement tolerates having run before.
 */
export class CreatePos6 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS internal_note TEXT;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS edited_by TEXT;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS deleted_by TEXT;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS delete_reason TEXT;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS previous_numbers JSONB;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pos_sale_deleted" ON "pos_sale" ("deleted_at") WHERE deleted_at IS NOT NULL;`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_pos_sale_deleted";`);
    this.addSql(`ALTER TABLE pos_sale DROP COLUMN IF EXISTS previous_numbers;`);
    this.addSql(`ALTER TABLE pos_sale DROP COLUMN IF EXISTS delete_reason;`);
    this.addSql(`ALTER TABLE pos_sale DROP COLUMN IF EXISTS deleted_by;`);
    this.addSql(`ALTER TABLE pos_sale DROP COLUMN IF EXISTS edited_by;`);
    this.addSql(`ALTER TABLE pos_sale DROP COLUMN IF EXISTS edited_at;`);
    this.addSql(`ALTER TABLE pos_sale DROP COLUMN IF EXISTS internal_note;`);
  }
}

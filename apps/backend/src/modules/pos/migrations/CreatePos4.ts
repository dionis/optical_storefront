import { Migration } from "@mikro-orm/migrations";

/**
 * Cash movements carry a reason category (CASH_CATEGORIES in lib/cash.ts) so
 * the cash report groups cash in/out by why it moved, not only by the free
 * note. Nullable: movements recorded before this column keep none.
 */
export class CreatePos4 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE cash_movement ADD COLUMN IF NOT EXISTS category TEXT;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cash_movement_created" ON "cash_movement" ("created_at");`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_cash_movement_created";`);
    this.addSql(`ALTER TABLE cash_movement DROP COLUMN IF EXISTS category;`);
  }
}

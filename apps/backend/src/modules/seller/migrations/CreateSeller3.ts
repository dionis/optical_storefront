import { Migration } from "@mikro-orm/migrations";

/**
 * Panel user of a seller: the Equipo user with the `seller` role who sells at
 * the counter as this seller. One user per seller and one seller per user.
 */
export class CreateSeller3 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE seller ADD COLUMN IF NOT EXISTS user_id TEXT;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_seller_user_unique" ON "seller" ("user_id") WHERE user_id IS NOT NULL AND deleted_at IS NULL;`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_seller_user_unique";`);
    this.addSql(`ALTER TABLE seller DROP COLUMN IF EXISTS user_id;`);
  }
}

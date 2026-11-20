import { Migration } from "@mikro-orm/migrations";

/**
 * Store and till of a seller. Nullable: an inactive seller may have neither;
 * an active one must have both (enforced in src/lib/sellers.ts).
 */
export class CreateSeller2 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE seller ADD COLUMN IF NOT EXISTS establishment_id TEXT;`);
    this.addSql(`ALTER TABLE seller ADD COLUMN IF NOT EXISTS terminal_id TEXT;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_seller_establishment" ON "seller" ("establishment_id") WHERE deleted_at IS NULL;`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_seller_establishment";`);
    this.addSql(`ALTER TABLE seller DROP COLUMN IF EXISTS terminal_id;`);
    this.addSql(`ALTER TABLE seller DROP COLUMN IF EXISTS establishment_id;`);
  }
}

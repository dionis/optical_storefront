import { Migration } from "@mikro-orm/migrations";

/** The seller's address. Personal data: only the admin routes return it, never the public dashboard. */
export class CreateSeller4 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE seller ADD COLUMN IF NOT EXISTS address TEXT;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE seller DROP COLUMN IF EXISTS address;`);
  }
}

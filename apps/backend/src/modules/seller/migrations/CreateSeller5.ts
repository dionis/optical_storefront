import { Migration } from "@mikro-orm/migrations";

/**
 * Someone chose to keep a different address on the seller record than on the
 * person's profile (lib/seller-address.ts). Off by default: it is one address.
 */
export class CreateSeller5 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE seller ADD COLUMN IF NOT EXISTS address_separate BOOLEAN NOT NULL DEFAULT FALSE;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE seller DROP COLUMN IF EXISTS address_separate;`);
  }
}

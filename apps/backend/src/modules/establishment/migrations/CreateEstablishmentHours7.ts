import { Migration } from "@mikro-orm/migrations";

/**
 * Opening hours of each store (owner, 15-nov-2026; lib/store-hours.ts):
 * `establishment.hours` = { week: { mon…sun: {open, close} | {closed} }, special: [...] }.
 * NULL = not set (nothing is said about hours anywhere).
 * Idempotent. Sorted after CreateEstablishmentOnline6 by file name.
 */
export class CreateEstablishmentHours7 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE establishment ADD COLUMN IF NOT EXISTS hours JSONB;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE establishment DROP COLUMN IF EXISTS hours;`);
  }
}

import { Migration } from "@mikro-orm/migrations";

/**
 * Profile photo (base64 data URL or https URL), editable by the person and by
 * admins. Named so it sorts after CreateStaffProfile2: Medusa runs a module's
 * migrations in file-name order (see tests/migration-order.test.ts).
 */
export class StaffProfilePhotoUrl3 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE IF EXISTS staff_profile ADD COLUMN IF NOT EXISTS photo_url TEXT;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE IF EXISTS staff_profile DROP COLUMN IF EXISTS photo_url;`);
  }
}

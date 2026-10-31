import { Migration } from "@mikro-orm/migrations";

/** Profile photo (base64 data URL or https URL), editable by the person and by admins. */
export class AddStaffPhotoUrl3 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE staff_profile ADD COLUMN IF NOT EXISTS photo_url TEXT;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE staff_profile DROP COLUMN IF EXISTS photo_url;`);
  }
}

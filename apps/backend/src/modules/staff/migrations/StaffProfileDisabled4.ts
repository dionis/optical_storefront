import { Migration } from "@mikro-orm/migrations";

/**
 * Deactivation of a team member without deleting them (HU-04): `disabled_at`
 * set = no access on every /admin request (lib/staff-scope.ts), history and
 * profile kept. Named so it sorts after StaffProfilePhotoUrl3: Medusa runs a
 * module's migrations in file-name order (see tests/migration-order.test.ts).
 */
export class StaffProfileDisabled4 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE IF EXISTS staff_profile ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;`);
    this.addSql(`ALTER TABLE IF EXISTS staff_profile ADD COLUMN IF NOT EXISTS disabled_by TEXT;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE IF EXISTS staff_profile DROP COLUMN IF EXISTS disabled_by;`);
    this.addSql(`ALTER TABLE IF EXISTS staff_profile DROP COLUMN IF EXISTS disabled_at;`);
  }
}

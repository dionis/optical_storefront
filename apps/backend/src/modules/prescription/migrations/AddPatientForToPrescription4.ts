import { Migration } from "@mikro-orm/migrations";

/**
 * Who the glasses are for, chosen in the virtual try-on studio: "me" (the shopper)
 * or "other" (a relative/friend measured as a reference), plus the other person's
 * optional name.
 *
 * Nullable: prescriptions entered outside the studio carry neither, and rows
 * written before this migration have nothing to backfill.
 */
export class AddPatientForToPrescription4 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE prescription ADD COLUMN IF NOT EXISTS patient_for TEXT;`);
    this.addSql(`ALTER TABLE prescription ADD COLUMN IF NOT EXISTS patient_name TEXT;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE prescription DROP COLUMN IF EXISTS patient_for;`);
    this.addSql(`ALTER TABLE prescription DROP COLUMN IF EXISTS patient_name;`);
  }
}

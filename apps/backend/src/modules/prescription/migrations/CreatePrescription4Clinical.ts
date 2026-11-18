import { Migration } from "@mikro-orm/migrations";

/**
 * Visual acuity without and with correction per eye and both, and the dominant
 * eye (owner, 18-nov-2026; lib/visual-acuity.ts): `prescription.clinical`
 * = { va: { sc: { od, os, ou }, cc: { od, os, ou } }, dominant_eye }. NULL =
 * not recorded. Named to sort after CreatePrescription1 (file-name order,
 * tests/migration-order.test.ts). Idempotent.
 */
export class CreatePrescription4Clinical extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE prescription ADD COLUMN IF NOT EXISTS clinical JSONB;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE prescription DROP COLUMN IF EXISTS clinical;`);
  }
}

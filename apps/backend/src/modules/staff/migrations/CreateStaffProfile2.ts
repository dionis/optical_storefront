import { Migration } from "@mikro-orm/migrations";

/** Extended profile of each panel user (seller code, contact, privileges). */
export class CreateStaffProfile2 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS staff_profile (
        id                  TEXT PRIMARY KEY,
        user_id             TEXT NOT NULL,
        display_name        TEXT,
        seller_code         TEXT,
        phone_mobile        TEXT,
        phone_whatsapp      TEXT,
        phone_landline      TEXT,
        email_alt           TEXT,
        address             TEXT,
        alert_email         TEXT,
        locale              TEXT,
        emergency_name      TEXT,
        emergency_relation  TEXT,
        emergency_phone     TEXT,
        hire_date           TEXT,
        commission_pct      REAL,
        monthly_goal        REAL,
        privileges          JSONB,
        internal_notes      TEXT,
        updated_by          TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at          TIMESTAMPTZ
      );
    `);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_staff_profile_user_unique" ON "staff_profile" ("user_id") WHERE deleted_at IS NULL;`);
    // Codes stay unique among live profiles; case-insensitive, as people type them.
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_staff_profile_code_unique" ON "staff_profile" (UPPER(seller_code)) WHERE deleted_at IS NULL AND seller_code IS NOT NULL;`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS staff_profile;`);
  }
}

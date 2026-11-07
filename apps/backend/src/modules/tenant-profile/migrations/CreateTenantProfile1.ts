import { Migration } from "@mikro-orm/migrations";

/** The owner-edited tenant profile — a single row keyed "default". Additive only. */
export class CreateTenantProfile1 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS tenant_profile (
        id                  TEXT PRIMARY KEY,
        display_name        TEXT,
        legal_name          TEXT,
        support_phone       TEXT,
        whatsapp            TEXT,
        social              JSONB,
        pickup              JSONB,
        setup_completed_at  TIMESTAMPTZ,
        updated_by          TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at          TIMESTAMPTZ
      );
    `);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS tenant_profile;`);
  }
}

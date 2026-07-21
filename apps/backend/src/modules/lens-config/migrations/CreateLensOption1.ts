import { Migration } from "@mikro-orm/migrations";

export class CreateLensOption1 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS lens_option (
        id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        usage_type  TEXT NOT NULL,
        index       NUMERIC(4,2) NOT NULL,
        label       TEXT NOT NULL,
        description TEXT,
        price_modifier_cents INTEGER NOT NULL DEFAULT 0,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS coating_option (
        id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        type        TEXT NOT NULL UNIQUE,
        label       TEXT NOT NULL,
        description TEXT,
        price_modifier_cents INTEGER NOT NULL DEFAULT 0,
        compatible_usage_types TEXT[] NOT NULL DEFAULT '{}',
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS coating_option;`);
    this.addSql(`DROP TABLE IF EXISTS lens_option;`);
  }
}

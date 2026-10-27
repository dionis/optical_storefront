import { Migration } from "@mikro-orm/migrations";

/**
 * `lens_option` and `coating_option` were created (CreateLensOption1) without a
 * `deleted_at` column. Every model defined with `model.define()` is soft-deletable in
 * Medusa v2, so the generated `listLensOptions` / `listCoatingOptions` always append
 * `WHERE deleted_at IS NULL` — which Postgres rejects with `column "deleted_at" does
 * not exist`, taking /store/lens-config/options, /coatings and /price down with a 500.
 *
 * The 2026 matrix tables (CreateLens2026Matrix2) already have the column; only these
 * two were missing it.
 *
 * Medusa runs a module's migrations in file-name order, so this one ("Add…")
 * runs BEFORE CreateLensOption1 ("Create…") on an empty database. The two
 * CREATE TABLE IF NOT EXISTS below repeat CreateLensOption1's DDL so a fresh
 * install gets the tables first; where they already exist (every database that
 * applied CreateLensOption1) they do nothing. tests/migration-order.test.ts
 * keeps every module honest about this.
 */
export class AddSoftDeleteToLensOption4 extends Migration {
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

    this.addSql(`ALTER TABLE lens_option ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`);
    this.addSql(`ALTER TABLE coating_option ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`);

    this.addSql(`
      CREATE INDEX IF NOT EXISTS idx_lens_option_deleted_at
        ON lens_option (deleted_at) WHERE deleted_at IS NULL;
    `);
    this.addSql(`
      CREATE INDEX IF NOT EXISTS idx_coating_option_deleted_at
        ON coating_option (deleted_at) WHERE deleted_at IS NULL;
    `);

    // The lookup the module service does on every options query.
    this.addSql(`
      CREATE INDEX IF NOT EXISTS idx_lens_option_usage_index
        ON lens_option (usage_type, index);
    `);
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS idx_lens_option_usage_index;`);
    this.addSql(`DROP INDEX IF EXISTS idx_coating_option_deleted_at;`);
    this.addSql(`DROP INDEX IF EXISTS idx_lens_option_deleted_at;`);
    this.addSql(`ALTER TABLE coating_option DROP COLUMN IF EXISTS deleted_at;`);
    this.addSql(`ALTER TABLE lens_option DROP COLUMN IF EXISTS deleted_at;`);
  }
}

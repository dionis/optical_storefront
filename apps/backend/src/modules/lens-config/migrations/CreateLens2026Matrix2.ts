import { Migration } from "@mikro-orm/migrations";

/**
 * 2026 lens price list ("matriz"): designs × materials base matrix, photochromic
 * and AR add-ons. Hand-written to match the module's existing migration style
 * (see CreateLensOption1). All prices are USD cents (integers).
 */
export class CreateLens2026Matrix2 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS lens_design (
        id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        code          TEXT NOT NULL UNIQUE,
        category      TEXT NOT NULL,
        label_es      TEXT NOT NULL,
        label_en      TEXT NOT NULL,
        requires_rx   BOOLEAN NOT NULL DEFAULT TRUE,
        requires_add  BOOLEAN NOT NULL DEFAULT FALSE,
        sort          INTEGER NOT NULL DEFAULT 0,
        is_active     BOOLEAN NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at    TIMESTAMPTZ
      );
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS lens_material (
        id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        code        TEXT NOT NULL UNIQUE,
        label_es    TEXT NOT NULL,
        label_en    TEXT NOT NULL,
        desc_es     TEXT,
        desc_en     TEXT,
        max_abs     DOUBLE PRECISION NOT NULL DEFAULT 99,
        sort        INTEGER NOT NULL DEFAULT 0,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at  TIMESTAMPTZ
      );
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS lens_base_price (
        id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        design_code   TEXT NOT NULL,
        material_code TEXT NOT NULL,
        price_cents   INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at    TIMESTAMPTZ
      );
    `);
    this.addSql(`
      CREATE INDEX IF NOT EXISTS idx_lens_base_price_cell
        ON lens_base_price (design_code, material_code);
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS lens_photo_option (
        id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        code                TEXT NOT NULL UNIQUE,
        label_es            TEXT NOT NULL,
        label_en            TEXT NOT NULL,
        colors              TEXT[] NOT NULL DEFAULT '{}',
        price_sv_cents      INTEGER,
        price_bifocal_cents INTEGER,
        price_prog_cents    INTEGER,
        sort                INTEGER NOT NULL DEFAULT 0,
        is_active           BOOLEAN NOT NULL DEFAULT TRUE,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at          TIMESTAMPTZ
      );
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS lens_ar_option (
        id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        code        TEXT NOT NULL UNIQUE,
        label_es    TEXT NOT NULL,
        label_en    TEXT NOT NULL,
        ar_group    TEXT NOT NULL,
        price_cents INTEGER NOT NULL DEFAULT 0,
        sort        INTEGER NOT NULL DEFAULT 0,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at  TIMESTAMPTZ
      );
    `);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS lens_ar_option;`);
    this.addSql(`DROP TABLE IF EXISTS lens_photo_option;`);
    this.addSql(`DROP TABLE IF EXISTS lens_base_price;`);
    this.addSql(`DROP TABLE IF EXISTS lens_material;`);
    this.addSql(`DROP TABLE IF EXISTS lens_design;`);
  }
}

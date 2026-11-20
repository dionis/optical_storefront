import { Migration } from "@mikro-orm/migrations";
import { catalogBrandSeedStatements } from "../catalog-brand-seed";

/**
 * `catalog_brand`: the brand registry of «Productos y precios»
 * (models/catalog-brand.ts, docs/PRICE-MATRIX.md v2 «Marcas»), seeded with
 * the Capri brands and their logos (`../catalog-brand-seed.ts`).
 *
 * Idempotent (IF NOT EXISTS, ON CONFLICT DO NOTHING): running it again
 * changes nothing and never undoes an owner's edit. It creates its own table
 * and touches no other, so its place first in the module's file-name order is
 * harmless (tests/migration-order.test.ts).
 */
export class CreateCatalogBrand8 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS catalog_brand (
        id          TEXT PRIMARY KEY,
        slug        TEXT NOT NULL,
        name        TEXT NOT NULL,
        logo_url    TEXT,
        kind        TEXT NOT NULL DEFAULT 'frame',
        source      TEXT NOT NULL DEFAULT 'capri',
        active      BOOLEAN NOT NULL DEFAULT TRUE,
        sort        INTEGER NOT NULL DEFAULT 0,
        created_by  TEXT,
        updated_by  TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at  TIMESTAMPTZ
      );
    `);
    this.addSql(`ALTER TABLE catalog_brand DROP CONSTRAINT IF EXISTS catalog_brand_kind_check;`);
    this.addSql(`ALTER TABLE catalog_brand ADD CONSTRAINT catalog_brand_kind_check CHECK (kind IN ('frame', 'case'));`);
    this.addSql(`ALTER TABLE catalog_brand DROP CONSTRAINT IF EXISTS catalog_brand_source_check;`);
    this.addSql(`ALTER TABLE catalog_brand ADD CONSTRAINT catalog_brand_source_check CHECK (source IN ('capri', 'manual'));`);
    // One live row per slug — and the conflict target of the seed and of the
    // register-on-read insert (lib/catalog-brand-data.ts).
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_brand_slug
        ON catalog_brand (slug)
        WHERE deleted_at IS NULL;
    `);
    for (const sql of catalogBrandSeedStatements()) this.addSql(sql);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS catalog_brand;`);
  }
}

import { Migration } from "@mikro-orm/migrations";

/**
 * Customer reviews of catalogue frames.
 *
 * Hand-written to match the module's model and the project's migration style
 * (see CreateStoreSetting1 / CreateOcrSetting1).
 *
 * Keyed by `product_handle` — the scraped slug the storefront routes on —
 * because the catalogue is re-ingested wholesale and product ids are not stable
 * across a re-scrape, while the handle is. The index carries the only query
 * this table serves: "every review for this frame".
 */
export class CreateProductReview1 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS product_review (
        id              TEXT PRIMARY KEY,
        product_handle  TEXT NOT NULL,
        rating          INTEGER NOT NULL,
        body            TEXT NOT NULL,
        author_name     TEXT NOT NULL,
        author_email    TEXT,
        locale          TEXT,
        photo_urls      TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at      TIMESTAMPTZ
      );
    `);
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_product_review_handle"
        ON product_review (product_handle)
        WHERE deleted_at IS NULL;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_product_review_handle";`);
    this.addSql(`DROP TABLE IF EXISTS product_review;`);
  }
}

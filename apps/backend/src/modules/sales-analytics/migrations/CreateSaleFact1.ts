import { Migration } from "@mikro-orm/migrations";

/** Flat projection of sold lines for the dashboards (technical document). */
export class CreateSaleFact1 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS sale_fact (
        id                TEXT PRIMARY KEY,
        order_id          TEXT NOT NULL,
        line_item_id      TEXT NOT NULL,
        sale_id           TEXT,
        sale_number       TEXT,
        channel           TEXT NOT NULL,
        establishment_id  TEXT,
        terminal_id       TEXT,
        seller_id         TEXT,
        seller_code       TEXT,
        customer_id       TEXT,
        product_id        TEXT,
        variant_id        TEXT,
        sku               TEXT,
        title             TEXT,
        brand             TEXT,
        category          TEXT NOT NULL,
        lens_design       TEXT,
        lens_material     TEXT,
        lens_photo        TEXT,
        lens_ar           TEXT,
        has_prescription  BOOLEAN NOT NULL DEFAULT FALSE,
        qty               INTEGER NOT NULL DEFAULT 1,
        list_cents        INTEGER NOT NULL,
        discount_cents    INTEGER NOT NULL DEFAULT 0,
        tax_cents         INTEGER NOT NULL DEFAULT 0,
        frame_cents       INTEGER NOT NULL DEFAULT 0,
        lenses_cents      INTEGER NOT NULL DEFAULT 0,
        total_cents       INTEGER NOT NULL,
        payment_methods   JSONB,
        status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'voided')),
        sold_at           TIMESTAMPTZ NOT NULL,
        sold_date_local   TEXT NOT NULL,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ
      );
    `);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_sale_fact_line" ON "sale_fact" ("line_item_id");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_fact_store_time" ON "sale_fact" ("establishment_id", "sold_at");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_fact_seller_time" ON "sale_fact" ("seller_id", "sold_at");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_fact_product" ON "sale_fact" ("product_id");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_fact_day" ON "sale_fact" ("sold_date_local");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_fact_sale" ON "sale_fact" ("sale_id");`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS sale_fact;`);
  }
}

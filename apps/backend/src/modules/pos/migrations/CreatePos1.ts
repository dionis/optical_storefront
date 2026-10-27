import { Migration } from "@mikro-orm/migrations";

/**
 * Point of sale: payment methods (configuration, seeded with the owner's five),
 * sales, their payments and the per-store sale counter. Hand-written to match
 * the module's models and the project's migration style (see CreateSeller1).
 */
export class CreatePos1 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS pos_payment_method (
        id          TEXT PRIMARY KEY,
        code        TEXT NOT NULL,
        label       TEXT,
        receivable  BOOLEAN NOT NULL DEFAULT FALSE,
        builtin     BOOLEAN NOT NULL DEFAULT FALSE,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_by  TEXT,
        updated_by  TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at  TIMESTAMPTZ
      );
    `);
    // Old sales point at the code, so it is never reused.
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_pos_payment_method_code_unique" ON "pos_payment_method" ("code");`);
    this.addSql(`
      INSERT INTO pos_payment_method (id, code, receivable, builtin, sort_order) VALUES
        ('pospm_debit', 'debit', FALSE, TRUE, 10),
        ('pospm_credit', 'credit', FALSE, TRUE, 20),
        ('pospm_zelle', 'zelle', FALSE, TRUE, 30),
        ('pospm_cash', 'cash', FALSE, TRUE, 40),
        ('pospm_insurance', 'insurance', TRUE, TRUE, 50)
      ON CONFLICT (id) DO NOTHING;
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS pos_sale (
        id                    TEXT PRIMARY KEY,
        number                TEXT NOT NULL,
        establishment_id      TEXT NOT NULL,
        seq                   INTEGER NOT NULL,
        seller_id             TEXT,
        order_id              TEXT,
        cart_id               TEXT,
        customer_id           TEXT,
        total_cents           INTEGER NOT NULL,
        currency_code         TEXT NOT NULL DEFAULT 'usd',
        status                TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),
        own_frame_photo_keys  JSONB,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at            TIMESTAMPTZ
      );
    `);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_pos_sale_number_unique" ON "pos_sale" ("number");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pos_sale_establishment" ON "pos_sale" ("establishment_id", "created_at");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pos_sale_order" ON "pos_sale" ("order_id");`);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS pos_sale_payment (
        id            TEXT PRIMARY KEY,
        sale_id       TEXT NOT NULL,
        method_code   TEXT NOT NULL,
        amount_cents  INTEGER NOT NULL,
        reference     TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at    TIMESTAMPTZ
      );
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_pos_sale_payment_sale" ON "pos_sale_payment" ("sale_id");`);

    // One row per store, incremented atomically (lib/pos-data.ts nextSaleSeq).
    this.addSql(`
      CREATE TABLE IF NOT EXISTS pos_sale_counter (
        establishment_id  TEXT PRIMARY KEY,
        last_seq          INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS pos_sale_counter;`);
    this.addSql(`DROP TABLE IF EXISTS pos_sale_payment;`);
    this.addSql(`DROP TABLE IF EXISTS pos_sale;`);
    this.addSql(`DROP TABLE IF EXISTS pos_payment_method;`);
  }
}

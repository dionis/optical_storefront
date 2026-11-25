import { Migration } from "@mikro-orm/migrations";

/**
 * Per-store ON/OFF for lens designs, lens cells (design × material × finish),
 * and treatments (photochromics and anti-reflective), including the online store.
 *
 * Opt-out by default: absence of a row means ENABLED, so every existing store
 * keeps behaving identically until the owner switches an item off there.
 * Global switches (`lens_base_price.is_active`, `lens_design.is_active`,
 * `lens_photo_option.is_active`, `lens_ar_option.is_active`) stay intact and
 * take precedence over per-store rows. Costs are untouched.
 *
 * Read and written via Knex SQL (`lib/store-lens-toggle-data.ts`) so a database
 * before this migration safely falls back to everything enabled. Idempotent.
 */
export class CreateStoreLensToggle13 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS store_lens_toggle (
        establishment_id TEXT NOT NULL,
        item_kind        TEXT NOT NULL CHECK (item_kind IN ('design', 'lens', 'photo', 'ar', 'treatment_group')),
        item_key         TEXT NOT NULL,
        enabled          BOOLEAN NOT NULL DEFAULT true,
        updated_by       TEXT,
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (establishment_id, item_kind, item_key)
      );
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_store_lens_toggle_est ON store_lens_toggle (establishment_id);`);
    // Register in operation_log right away (docs/OPERATION-LOG.md).
    this.addSql(`DO $d$ BEGIN IF to_regprocedure('oplog_attach_all()') IS NOT NULL THEN PERFORM oplog_attach_all(); END IF; END $d$;`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS store_lens_toggle;`);
  }
}

import { Migration } from "@mikro-orm/migrations";

/**
 * Stock versus surfaced ("tallado digital") lenses, each with its own price AND
 * its own lab cost (lib/lens-finish.ts).
 *
 *  - `finish`      "stock" | "digital". Every existing cell is a stock cell,
 *                  except those of progressive designs, which are digital by
 *                  nature (there is no stock progressive).
 *  - `cost_cents`  what the lab charges the shop for that cell; null = unknown
 *                  (the cost RULES then answer, lib/costing.ts). Never served
 *                  on the public matrix.
 *
 * The (design, material) uniqueness that SeedLens2026Data3 added as the
 * constraint `uq_lens_base_cell` becomes (design, material, finish) on live
 * rows, so single vision and bifocals can hold a second, digital cell. The
 * digital cells themselves are NOT seeded: the owner types them in Precios y
 * costos → Lentes, and until then the POS answers `finish_unavailable` for
 * that finish instead of inventing a price.
 *
 * Named to sort AFTER UpgradeLensList2026Seed7: Medusa runs a module's
 * migrations in file-name order, and on an empty database this must run after
 * the table exists and after the seed re-adds its two-column constraint
 * (tests/migration-order.test.ts). Idempotent, like the rest of the module.
 */
export class UpgradeLensListFinish8 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE lens_base_price ADD COLUMN IF NOT EXISTS finish TEXT NOT NULL DEFAULT 'stock';`);
    this.addSql(`ALTER TABLE lens_base_price ADD COLUMN IF NOT EXISTS cost_cents INTEGER;`);
    this.addSql(`
      UPDATE lens_base_price SET finish = 'digital', updated_at = NOW()
      WHERE finish <> 'digital'
        AND design_code IN (SELECT code FROM lens_design WHERE category = 'prog');
    `);
    this.addSql(`ALTER TABLE lens_base_price DROP CONSTRAINT IF EXISTS uq_lens_base_cell;`);
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_lens_base_cell_finish
        ON lens_base_price (design_code, material_code, finish)
        WHERE deleted_at IS NULL;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS uq_lens_base_cell_finish;`);
    // The second (digital) cells of non-progressive designs cannot live without
    // the column: with it gone they would duplicate the stock cell.
    this.addSql(`
      DELETE FROM lens_base_price
      WHERE finish = 'digital'
        AND design_code NOT IN (SELECT code FROM lens_design WHERE category = 'prog');
    `);
    this.addSql(`ALTER TABLE lens_base_price DROP COLUMN IF EXISTS cost_cents;`);
    this.addSql(`ALTER TABLE lens_base_price DROP COLUMN IF EXISTS finish;`);
    this.addSql(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_lens_base_cell') THEN
          ALTER TABLE lens_base_price ADD CONSTRAINT uq_lens_base_cell UNIQUE (design_code, material_code);
        END IF;
      END $$;
    `);
  }
}

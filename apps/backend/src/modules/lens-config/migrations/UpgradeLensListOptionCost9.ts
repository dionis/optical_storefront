import { Migration } from "@mikro-orm/migrations";

/**
 * What the lab charges the shop for a photochromic and for an anti-reflective
 * treatment: `cost_cents` on `lens_photo_option` and `lens_ar_option`, the
 * «Costo» column of the Tratamientos section of «Productos y precios»
 * (docs/PRICE-MATRIX.md).
 *
 * One figure per option: a photochromic costs the lab the same whatever the
 * design category it is sold on, so the three category rows of one option in
 * the matrix share it. NULL = unknown — never 0, which would read as a free
 * treatment. Like `lens_base_price.cost_cents`, it is internal and never leaves
 * on the public matrix (lib/lens-matrix.ts strips it).
 *
 * Named to sort AFTER UpgradeLensListFinish8 (Medusa runs a module's
 * migrations in file-name order, tests/migration-order.test.ts). Idempotent.
 */
export class UpgradeLensListOptionCost9 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE lens_photo_option ADD COLUMN IF NOT EXISTS cost_cents INTEGER NULL;`);
    this.addSql(`ALTER TABLE lens_ar_option ADD COLUMN IF NOT EXISTS cost_cents INTEGER NULL;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE lens_ar_option DROP COLUMN IF EXISTS cost_cents;`);
    this.addSql(`ALTER TABLE lens_photo_option DROP COLUMN IF EXISTS cost_cents;`);
  }
}

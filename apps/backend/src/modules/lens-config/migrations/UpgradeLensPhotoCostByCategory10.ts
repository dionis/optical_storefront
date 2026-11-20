import { Migration } from "@mikro-orm/migrations";

/**
 * A photochromic's lab cost per design category (owner, 7-nov-2026: «each type
 * — single vision, bifocal and progressive — has its own cost and its own
 * price»): `cost_sv_cents`, `cost_bifocal_cents`, `cost_prog_cents` on
 * `lens_photo_option`. Each starts as the option's old single `cost_cents`
 * where the category is offered, so no cost already typed is lost; NULL =
 * unknown, never 0. `cost_cents` stays as the read fallback.
 *
 * Named to sort AFTER UpgradeLensListOptionCost9 (file-name order,
 * tests/migration-order.test.ts). Idempotent.
 */
export class UpgradeLensPhotoCostByCategory10 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE lens_photo_option ADD COLUMN IF NOT EXISTS cost_sv_cents INTEGER NULL;`);
    this.addSql(`ALTER TABLE lens_photo_option ADD COLUMN IF NOT EXISTS cost_bifocal_cents INTEGER NULL;`);
    this.addSql(`ALTER TABLE lens_photo_option ADD COLUMN IF NOT EXISTS cost_prog_cents INTEGER NULL;`);
    this.addSql(
      `UPDATE lens_photo_option SET
         cost_sv_cents = COALESCE(cost_sv_cents, CASE WHEN price_sv_cents IS NOT NULL THEN cost_cents END),
         cost_bifocal_cents = COALESCE(cost_bifocal_cents, CASE WHEN price_bifocal_cents IS NOT NULL THEN cost_cents END),
         cost_prog_cents = COALESCE(cost_prog_cents, CASE WHEN price_prog_cents IS NOT NULL THEN cost_cents END)
       WHERE cost_cents IS NOT NULL;`
    );
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE lens_photo_option DROP COLUMN IF EXISTS cost_prog_cents;`);
    this.addSql(`ALTER TABLE lens_photo_option DROP COLUMN IF EXISTS cost_bifocal_cents;`);
    this.addSql(`ALTER TABLE lens_photo_option DROP COLUMN IF EXISTS cost_sv_cents;`);
  }
}

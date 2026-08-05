import { Migration } from "@mikro-orm/migrations";

/**
 * Fitting/segment height (mm) on the prescription record.
 *
 * The storefront has always sent it — the lens funnel makes it mandatory for
 * multifocals — but there was no column, so the value was dropped on insert and
 * neither the order emails nor the lab ever saw it. A progressive or bifocal
 * cannot be cut without it, so it belongs with the rest of the Rx (PHI, stored
 * server-side only). Nullable: single-vision orders don't carry one, and rows
 * written before this migration have no value to backfill.
 */
export class AddSegHeightToPrescription2 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE prescription ADD COLUMN IF NOT EXISTS seg_height DOUBLE PRECISION;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE prescription DROP COLUMN IF EXISTS seg_height;`);
  }
}

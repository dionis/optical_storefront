import { Migration } from "@mikro-orm/migrations";

/**
 * Provenance of the fitting measurements (PD / fitting height): "ai" when they
 * came from the try-on studio's AI measurement and the shopper kept them, plus
 * the quality level the AI reported. Without it the order emails labelled AI
 * measurements as "entered manually" and the lab could not tell them apart.
 *
 * Nullable: manual/OCR measurements carry neither, and older rows have nothing
 * to backfill.
 */
export class AddMeasurementSourceToPrescription5 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE prescription ADD COLUMN IF NOT EXISTS measurement_source TEXT;`);
    this.addSql(`ALTER TABLE prescription ADD COLUMN IF NOT EXISTS measurement_quality TEXT;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE prescription DROP COLUMN IF EXISTS measurement_source;`);
    this.addSql(`ALTER TABLE prescription DROP COLUMN IF EXISTS measurement_quality;`);
  }
}

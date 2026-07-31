import { Migration } from "@mikro-orm/migrations";

/**
 * Runtime OCR configuration — a single row keyed "default".
 * Hand-written to match the module's model and the project's migration style
 * (see CreatePrescription1).
 */
export class CreateOcrSetting1 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS ocr_setting (
        id                   TEXT PRIMARY KEY,
        model_id             TEXT NOT NULL,
        escalation_model_id  TEXT,
        max_image_px         INTEGER NOT NULL,
        updated_by           TEXT,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at           TIMESTAMPTZ
      );
    `);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS ocr_setting;`);
  }
}

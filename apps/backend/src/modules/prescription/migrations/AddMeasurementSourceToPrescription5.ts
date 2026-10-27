import { Migration } from "@mikro-orm/migrations";

/**
 * Provenance of the fitting measurements (PD / fitting height): "ai" when they
 * came from the try-on studio's AI measurement and the shopper kept them, plus
 * the quality level the AI reported. Without it the order emails labelled AI
 * measurements as "entered manually" and the lab could not tell them apart.
 *
 * Nullable: manual/OCR measurements carry neither, and older rows have nothing
 * to backfill.
 *
 * Medusa runs a module's migrations in file-name order, so this one sorts FIRST
 * in the module (before AddPatientFor…, AddSegHeight…, AddTryonImage… and
 * CreatePrescription1). The CREATE TABLE IF NOT EXISTS below repeats
 * CreatePrescription1's DDL so an empty database gets the table before any
 * ALTER; where the table exists it does nothing. See
 * tests/migration-order.test.ts.
 */
export class AddMeasurementSourceToPrescription5 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS prescription (
        id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        od_sph            DOUBLE PRECISION,
        od_cyl            DOUBLE PRECISION,
        od_axis           INTEGER,
        od_add            DOUBLE PRECISION,
        od_prism          DOUBLE PRECISION,
        od_base           TEXT,
        os_sph            DOUBLE PRECISION,
        os_cyl            DOUBLE PRECISION,
        os_axis           INTEGER,
        os_add            DOUBLE PRECISION,
        os_prism          DOUBLE PRECISION,
        os_base           TEXT,
        pd                DOUBLE PRECISION,
        pd_od             DOUBLE PRECISION,
        pd_os             DOUBLE PRECISION,
        source            TEXT NOT NULL DEFAULT 'manual',
        verified_by_user  BOOLEAN NOT NULL DEFAULT FALSE,
        file_url          TEXT,
        customer_id       TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ
      );
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS idx_prescription_customer ON prescription (customer_id);`);

    this.addSql(`ALTER TABLE prescription ADD COLUMN IF NOT EXISTS measurement_source TEXT;`);
    this.addSql(`ALTER TABLE prescription ADD COLUMN IF NOT EXISTS measurement_quality TEXT;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE prescription DROP COLUMN IF EXISTS measurement_source;`);
    this.addSql(`ALTER TABLE prescription DROP COLUMN IF EXISTS measurement_quality;`);
  }
}

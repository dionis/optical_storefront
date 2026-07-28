import { Migration } from "@mikro-orm/migrations";

/**
 * Prescription (PHI) table — health record for a customer's optical prescription.
 * Hand-written to match the module's model and the project's migration style.
 * Rx values are stored here (server-side/Postgres) and referenced by id from the
 * cart/order — never duplicated into cart metadata or the browser.
 */
export class CreatePrescription1 extends Migration {
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
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS prescription;`);
  }
}

import { Migration } from "@mikro-orm/migrations";

/**
 * Point of sale, second part (technical document, "Graduación anterior" and
 * "Identificadores"):
 *
 *  - rx_number: RX-2026-00812, assigned to every prescription made at a store
 *    (yearly sequence in rx_sequence). Identifies the prescription on the lab
 *    ticket even when the customer buys again at another store.
 *  - worn_source: where the prescription the patient wears came from — their
 *    previous prescription, a lensometer reading or a prior sale (HU-120).
 *  - rx_date_approx: the date is an estimate ("about 3 years ago", HU-121).
 *
 * All nullable; web prescriptions stay as they are. Sorted after
 * AddMeasurementSourceToPrescription5, which creates the table on an empty
 * database, so the ALTERs always find it.
 */
export class AddRxNumberToPrescription7 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE prescription ADD COLUMN IF NOT EXISTS rx_number TEXT;`);
    this.addSql(`ALTER TABLE prescription ADD COLUMN IF NOT EXISTS worn_source TEXT CHECK (worn_source IS NULL OR worn_source IN ('previous_rx', 'lensometer', 'prior_sale'));`);
    this.addSql(`ALTER TABLE prescription ADD COLUMN IF NOT EXISTS rx_date_approx BOOLEAN NOT NULL DEFAULT FALSE;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_prescription_rx_number_unique" ON "prescription" ("rx_number") WHERE rx_number IS NOT NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_prescription_customer_kind" ON "prescription" ("customer_id", "kind", "created_at");`);
    this.addSql(`
      CREATE TABLE IF NOT EXISTS rx_sequence (
        year        INTEGER PRIMARY KEY,
        last_value  INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS rx_sequence;`);
    this.addSql(`DROP INDEX IF EXISTS "IDX_prescription_customer_kind";`);
    this.addSql(`DROP INDEX IF EXISTS "IDX_prescription_rx_number_unique";`);
    this.addSql(`ALTER TABLE prescription DROP COLUMN IF EXISTS rx_date_approx;`);
    this.addSql(`ALTER TABLE prescription DROP COLUMN IF EXISTS worn_source;`);
    this.addSql(`ALTER TABLE prescription DROP COLUMN IF EXISTS rx_number;`);
  }
}

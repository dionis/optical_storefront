import { Migration } from "@mikro-orm/migrations";

/**
 * Prescription history for the point of sale (owner's requirement: when a
 * patient with glasses comes in, record the prescription they wear and the new
 * one, to measure the change and how long they wore the old one).
 *
 *  - kind: "worn" (what the patient arrives wearing) or "new" (what is being
 *    made). NULL = rows written before this column, all of them "new" — web
 *    orders only ever stored the prescription being made.
 *  - rx_date: the date written on that prescription, when known.
 *  - previous_prescription_id: on a "new" row, the "worn" row it replaces.
 *
 * All nullable, so every existing row stays valid as it is.
 */
export class AddRxHistoryToPrescription6 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE prescription ADD COLUMN IF NOT EXISTS kind TEXT CHECK (kind IS NULL OR kind IN ('worn', 'new'));`);
    this.addSql(`ALTER TABLE prescription ADD COLUMN IF NOT EXISTS rx_date DATE;`);
    this.addSql(`ALTER TABLE prescription ADD COLUMN IF NOT EXISTS previous_prescription_id TEXT;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE prescription DROP COLUMN IF EXISTS previous_prescription_id;`);
    this.addSql(`ALTER TABLE prescription DROP COLUMN IF EXISTS rx_date;`);
    this.addSql(`ALTER TABLE prescription DROP COLUMN IF EXISTS kind;`);
  }
}

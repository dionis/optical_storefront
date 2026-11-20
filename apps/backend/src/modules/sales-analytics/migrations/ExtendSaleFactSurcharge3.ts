import { Migration } from "@mikro-orm/migrations";

/**
 * The lab surcharge of a sold lens line for a high power (lib/lab-surcharge.ts,
 * 18-nov-2026), in cents, worked out when the line is projected; part of the
 * lenses' cost in the books and the Executive. 0 = none (and every line
 * projected before). Sorts after ExtendSaleFactLensFinish2. Idempotent.
 */
export class ExtendSaleFactSurcharge3 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE sale_fact ADD COLUMN IF NOT EXISTS lab_surcharge_cents INTEGER NOT NULL DEFAULT 0;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE sale_fact DROP COLUMN IF EXISTS lab_surcharge_cents;`);
  }
}

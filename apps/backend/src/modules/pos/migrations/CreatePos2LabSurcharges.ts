import { Migration } from "@mikro-orm/migrations";

/**
 * The owner's lab surcharges for high powers (lib/lab-surcharge.ts, 18-nov-2026):
 * `pos_setting.lab_surcharges` = [{ id, label, scope, op, threshold, cost,
 * active }]. NULL = the defaults (> +6.00 sphere +$30 switched on, the usual
 * steps switched off). Named to sort right after CreatePos2, which creates
 * pos_setting (Medusa runs a module's migrations in file-name order and
 * "CreatePos12" would sort before "CreatePos2"; tests/migration-order.test.ts).
 * Idempotent.
 */
export class CreatePos2LabSurcharges extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE pos_setting ADD COLUMN IF NOT EXISTS lab_surcharges JSONB;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE pos_setting DROP COLUMN IF EXISTS lab_surcharges;`);
  }
}

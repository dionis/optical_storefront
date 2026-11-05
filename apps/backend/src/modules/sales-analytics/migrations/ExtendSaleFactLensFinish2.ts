import { Migration } from "@mikro-orm/migrations";

/**
 * `lens_finish` on the sold-line projection: "stock" | "digital"
 * (lib/lens-finish.ts), null for a bare frame and for lines projected before
 * finishes existed (those were the design's default cell, which is how
 * lib/lens-cost.ts costs a null). Named to sort after CreateSaleFact1: Medusa
 * runs a module's migrations in file-name order (tests/migration-order.test.ts).
 */
export class ExtendSaleFactLensFinish2 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE sale_fact ADD COLUMN IF NOT EXISTS lens_finish TEXT;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE sale_fact DROP COLUMN IF EXISTS lens_finish;`);
  }
}

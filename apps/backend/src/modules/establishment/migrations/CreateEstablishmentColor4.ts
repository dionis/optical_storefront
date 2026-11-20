import { Migration } from "@mikro-orm/migrations";

/**
 * The color that identifies a store in emails. Existing stores get a different
 * one each, in creation order (the palette of src/lib/store-color.ts, frozen
 * here). Sorted after CreateEstablishment1, which creates the table.
 */
export class CreateEstablishmentColor4 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE establishment ADD COLUMN IF NOT EXISTS color TEXT;`);
    this.addSql(`
      UPDATE establishment e
      SET color = (ARRAY['#2563EB','#DC2626','#16A34A','#7C3AED','#EA580C','#DB2777','#0891B2','#854D0E','#65A30D','#475569'])[((r.n - 1) % 10) + 1]
      FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS n FROM establishment) r
      WHERE e.id = r.id AND e.color IS NULL;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE establishment DROP COLUMN IF EXISTS color;`);
  }
}

import { Migration } from "@mikro-orm/migrations";

/**
 * The owner's colors for his stores, as the panel theme shows them
 * (useStoreTheme.js `defaultColorForStore` is the same table, for a store
 * that still has no color at all):
 *   Fry Family Clinic → clinic green  #1B7F4C
 *   El Rancho 39      → copper        #B5651D
 *   El Rancho 41      → fuchsia       #C2185B
 * Only a store that still wears one of the auto-assigned defaults (the ten of
 * CreateEstablishmentColor4, or NULL) is touched: a color the owner already
 * picked in Stores → Edit is his. Idempotent; `down` keeps whatever is there.
 * Sorted after CreateEstablishmentSettlement3 / …Color4 by file name.
 */
export class CreateEstablishmentThemeColor5 extends Migration {
  async up(): Promise<void> {
    const auto = "'#2563EB','#DC2626','#16A34A','#7C3AED','#EA580C','#DB2777','#0891B2','#854D0E','#65A30D','#475569'";
    const set = (color: string, like: string) => `
      UPDATE establishment SET color = '${color}'
      WHERE lower(name) LIKE '${like}'
        AND (color IS NULL OR upper(color) IN (${auto}));
    `;
    this.addSql(set("#1B7F4C", "%fry%"));
    this.addSql(set("#B5651D", "%rancho%39%"));
    this.addSql(set("#C2185B", "%rancho%41%"));
  }

  async down(): Promise<void> {
    // Data only: the colors stay as they are.
  }
}

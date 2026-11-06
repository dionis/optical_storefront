import { Migration } from "@mikro-orm/migrations";
import { DESIGNS, MATERIALS, RETIRED_DESIGN_CODES, cents, sqlNum, sqlText } from "../price-list-2026";

/**
 * Lab sheet change (Nov 2026): where the list said "Bifocal FT-28" the store
 * now sells "Tallado" (surfaced in the lab) and "De stock" (finished lens from
 * inventory). Both rows live in `price-list-2026.ts`; this migration writes
 * them and retires the single "bifocal" design.
 *
 * - The new rows get the old bifocal base prices as a starting point; the
 *   owner prices them per store in Tiendas → Precios (lens_store_price).
 * - "bifocal" is NOT deleted: sales already quoted with it keep their
 *   breakdown. It only stops being offered (is_active = FALSE).
 * - Idempotent: upserts + a WHERE NOT EXISTS for prices, so a re-run never
 *   overwrites a price the owner has since edited.
 */
export class SplitBifocalTalladoStock8 extends Migration {
  async up(): Promise<void> {
    const rows = DESIGNS.filter((d) => d.code === "tallado" || d.code === "stock");
    for (const d of rows) {
      this.addSql(`
        INSERT INTO lens_design (code, category, label_es, label_en, requires_rx, requires_add, sort, tier, use_es, use_en, is_active)
        VALUES (${sqlText(d.code)}, ${sqlText(d.category)}, ${sqlText(d.label_es)}, ${sqlText(d.label_en)}, ${d.requires_rx ? "TRUE" : "FALSE"}, ${d.requires_add ? "TRUE" : "FALSE"}, ${sqlNum(d.sort)}, ${sqlText(d.tier)}, ${sqlText(d.use_es)}, ${sqlText(d.use_en)}, TRUE)
        ON CONFLICT (code) DO UPDATE SET
          category = EXCLUDED.category, label_es = EXCLUDED.label_es, label_en = EXCLUDED.label_en,
          requires_rx = EXCLUDED.requires_rx, requires_add = EXCLUDED.requires_add, sort = EXCLUDED.sort,
          is_active = TRUE, deleted_at = NULL, updated_at = NOW();
      `);
      for (const m of MATERIALS) {
        this.addSql(`
          INSERT INTO lens_base_price (design_code, material_code, price_cents)
          SELECT ${sqlText(d.code)}, ${sqlText(m.code)}, ${sqlNum(cents(d.prices[m.code]))}
          WHERE NOT EXISTS (
            SELECT 1 FROM lens_base_price
            WHERE design_code = ${sqlText(d.code)} AND material_code = ${sqlText(m.code)}
          );
        `);
      }
    }
    this.addSql(`
      UPDATE lens_design SET is_active = FALSE, updated_at = NOW()
      WHERE code IN (${RETIRED_DESIGN_CODES.map((c) => sqlText(c)).join(", ")});
    `);
  }

  async down(): Promise<void> {
    // Reverse the offer only; rows stay so quotes that used them still resolve.
    this.addSql(`UPDATE lens_design SET is_active = TRUE, updated_at = NOW() WHERE code IN (${RETIRED_DESIGN_CODES.map((c) => sqlText(c)).join(", ")});`);
    this.addSql(`UPDATE lens_design SET is_active = FALSE, updated_at = NOW() WHERE code IN ('tallado', 'stock');`);
  }
}

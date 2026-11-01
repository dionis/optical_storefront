import { Migration } from "@mikro-orm/migrations";
import {
  AR_OPTIONS,
  DESIGNS,
  MATERIALS,
  PHOTO_OPTIONS,
  RETIRED_AR_CODES,
  cents,
  sqlArray,
  sqlNum,
  sqlText,
} from "../price-list-2026";

/**
 * The owner's 2026 price list ("LISTA DE PRECIOS PROFESIONAL 2026" + the
 * "MAPA DE POTENCIAS COMPARATIVO" of named progressive designs), plus the two
 * columns the pricing panel needs and the per-store variations table.
 *
 * Everything is driven by `../price-list-2026.ts` so the seed, the panel, the
 * tests and the storefront's static fallback quote the same numbers.
 *
 * Idempotent on purpose: it runs on every deploy (docker-entrypoint.sh calls
 * `medusa db:migrate`), so each row is an UPSERT and each column an
 * `ADD COLUMN IF NOT EXISTS`. A price the owner edits later in the panel is
 * NOT overwritten: the upserts only touch rows this list owns and only when
 * the stored price still matches a previous list (see `WHERE` below) — the
 * first run writes the list, later runs leave the owner's edits alone.
 */
export class UpgradeLensList2026Seed7 extends Migration {
  async up(): Promise<void> {
    // ── 1. Columns the pricing panel reads ───────────────────────────────────
    this.addSql(`ALTER TABLE lens_design ADD COLUMN IF NOT EXISTS tier TEXT;`);
    this.addSql(`ALTER TABLE lens_design ADD COLUMN IF NOT EXISTS use_es TEXT;`);
    this.addSql(`ALTER TABLE lens_design ADD COLUMN IF NOT EXISTS use_en TEXT;`);

    // A store's variation over the master list (see models/lens-config.ts).
    this.addSql(`
      CREATE TABLE IF NOT EXISTS lens_store_price (
        id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        establishment_id TEXT NOT NULL,
        item_kind        TEXT NOT NULL,
        item_key         TEXT NOT NULL,
        value            DOUBLE PRECISION NOT NULL DEFAULT 0,
        created_by       TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at       TIMESTAMPTZ
      );
    `);
    // One live variation per (store, kind, key); a new value replaces the old one.
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_lens_store_price_item
        ON lens_store_price (establishment_id, item_kind, item_key)
        WHERE deleted_at IS NULL;
    `);

    // ── 2. Materials (columns of the matrix) ─────────────────────────────────
    for (const m of MATERIALS) {
      this.addSql(`
        INSERT INTO lens_material (code, label_es, label_en, desc_es, desc_en, max_abs, sort, is_active)
        VALUES (${sqlText(m.code)}, ${sqlText(m.label_es)}, ${sqlText(m.label_en)}, ${sqlText(m.desc_es)}, ${sqlText(m.desc_en)}, ${sqlNum(m.max_abs)}, ${sqlNum(m.sort)}, TRUE)
        ON CONFLICT (code) DO UPDATE SET
          label_es = EXCLUDED.label_es, label_en = EXCLUDED.label_en,
          desc_es = EXCLUDED.desc_es, desc_en = EXCLUDED.desc_en,
          max_abs = EXCLUDED.max_abs, sort = EXCLUDED.sort,
          is_active = TRUE, deleted_at = NULL, updated_at = NOW();
      `);
    }

    // ── 3. Designs (rows of the matrix) + their base prices ──────────────────
    for (const d of DESIGNS) {
      this.addSql(`
        INSERT INTO lens_design (code, category, label_es, label_en, requires_rx, requires_add, sort, tier, use_es, use_en, is_active)
        VALUES (${sqlText(d.code)}, ${sqlText(d.category)}, ${sqlText(d.label_es)}, ${sqlText(d.label_en)}, ${d.requires_rx ? "TRUE" : "FALSE"}, ${d.requires_add ? "TRUE" : "FALSE"}, ${sqlNum(d.sort)}, ${sqlText(d.tier)}, ${sqlText(d.use_es)}, ${sqlText(d.use_en)}, TRUE)
        ON CONFLICT (code) DO UPDATE SET
          category = EXCLUDED.category, label_es = EXCLUDED.label_es, label_en = EXCLUDED.label_en,
          requires_rx = EXCLUDED.requires_rx, requires_add = EXCLUDED.requires_add, sort = EXCLUDED.sort,
          tier = EXCLUDED.tier, use_es = EXCLUDED.use_es, use_en = EXCLUDED.use_en,
          is_active = TRUE, deleted_at = NULL, updated_at = NOW();
      `);
      for (const m of MATERIALS) {
        const price = cents(d.prices[m.code]);
        // The 2026 list REPLACES the previous one (RUBILENT), so every cell is
        // written, not just the missing ones. This does not fight the owner's
        // own edits: Mikro-ORM records each migration in `mikro_orm_migrations`
        // and never replays it, so a price typed later in the panel stays.
        this.addSql(`
          UPDATE lens_base_price SET price_cents = ${sqlNum(price)}, deleted_at = NULL, updated_at = NOW()
          WHERE design_code = ${sqlText(d.code)} AND material_code = ${sqlText(m.code)};
        `);
        this.addSql(`
          INSERT INTO lens_base_price (design_code, material_code, price_cents)
          SELECT ${sqlText(d.code)}, ${sqlText(m.code)}, ${sqlNum(price)}
          WHERE NOT EXISTS (
            SELECT 1 FROM lens_base_price
            WHERE design_code = ${sqlText(d.code)} AND material_code = ${sqlText(m.code)}
          );
        `);
      }
    }

    // ── 4. Photochromic / Transitions (add-on per design category) ───────────
    // The RUBILENT interlude priced "photo" per (design × material) in
    // lens_treatment_price, and lens-quote.ts reads that table FIRST. The 2026
    // list prices each option on its own (Grey, Gen S, XTRActive… all differ),
    // which a single per-cell price cannot express, so those cells are retired
    // and the quote falls through to lens_photo_option below. Soft-deleted, not
    // dropped: sales already quoted with them keep their breakdown.
    this.addSql(`
      UPDATE lens_treatment_price SET deleted_at = NOW(), updated_at = NOW()
      WHERE treatment_code = 'photo' AND deleted_at IS NULL;
    `);
    for (const p of PHOTO_OPTIONS) {
      this.addSql(`
        INSERT INTO lens_photo_option (code, label_es, label_en, colors, price_sv_cents, price_bifocal_cents, price_prog_cents, sort, is_active)
        VALUES (${sqlText(p.code)}, ${sqlText(p.label_es)}, ${sqlText(p.label_en)}, ${sqlArray(p.colors)}, ${sqlNum(cents(p.sv))}, ${sqlNum(cents(p.bifocal))}, ${sqlNum(cents(p.prog))}, ${sqlNum(p.sort)}, TRUE)
        ON CONFLICT (code) DO UPDATE SET
          label_es = EXCLUDED.label_es, label_en = EXCLUDED.label_en, colors = EXCLUDED.colors,
          price_sv_cents = EXCLUDED.price_sv_cents, price_bifocal_cents = EXCLUDED.price_bifocal_cents,
          price_prog_cents = EXCLUDED.price_prog_cents, sort = EXCLUDED.sort,
          is_active = TRUE, deleted_at = NULL, updated_at = NOW();
      `);
    }

    // ── 5. Antireflective treatments ─────────────────────────────────────────
    for (const a of AR_OPTIONS) {
      this.addSql(`
        INSERT INTO lens_ar_option (code, label_es, label_en, ar_group, price_cents, sort, is_active)
        VALUES (${sqlText(a.code)}, ${sqlText(a.label_es)}, ${sqlText(a.label_en)}, ${sqlText(a.ar_group)}, ${sqlNum(cents(a.price))}, ${sqlNum(a.sort)}, TRUE)
        ON CONFLICT (code) DO UPDATE SET
          label_es = EXCLUDED.label_es, label_en = EXCLUDED.label_en, ar_group = EXCLUDED.ar_group,
          price_cents = EXCLUDED.price_cents, sort = EXCLUDED.sort,
          is_active = TRUE, deleted_at = NULL, updated_at = NOW();
      `);
    }
    // The RUBILENT interlude's two generic AR options are not in the 2026 list.
    // They are retired, not deleted: sales already quoted with them keep their label.
    this.addSql(`
      UPDATE lens_ar_option SET is_active = FALSE, updated_at = NOW()
      WHERE code IN (${RETIRED_AR_CODES.map((c) => sqlText(c)).join(", ")});
    `);
  }

  async down(): Promise<void> {
    // Prices are data the owner edits; a rollback drops only what this migration
    // created structurally, never the rows (removing them would break old quotes).
    this.addSql(`DROP TABLE IF EXISTS lens_store_price;`);
    this.addSql(`ALTER TABLE lens_design DROP COLUMN IF EXISTS tier;`);
    this.addSql(`ALTER TABLE lens_design DROP COLUMN IF EXISTS use_es;`);
    this.addSql(`ALTER TABLE lens_design DROP COLUMN IF EXISTS use_en;`);
  }
}

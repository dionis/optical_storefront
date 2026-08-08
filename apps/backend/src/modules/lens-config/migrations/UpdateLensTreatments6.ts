import { Migration } from "@mikro-orm/migrations";

/**
 * Treatments (AR + fotocromático) priced per (design × material), exactly like the
 * RUBILENT price list. The old model priced AR flat per group and fotocromático per
 * category, which could not represent the list (e.g. AR Green en Single Vision es
 * $20 en CR-39/POLY pero $35 en 1.67/1.74, y el fotocromático difiere entre Gama
 * Media y Alta). This adds `lens_treatment_price` and consolidates AR a dos opciones
 * (AR Green / AR Blue). Amounts are USD cents. Idempotente.
 */
export class UpdateLensTreatments6 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS lens_treatment_price (
        id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        design_code    TEXT NOT NULL,
        material_code  TEXT NOT NULL,
        treatment_code TEXT NOT NULL,
        price_cents    INTEGER NOT NULL DEFAULT 0,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at     TIMESTAMPTZ
      );
    `);
    this.addSql(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_lens_treatment_cell') THEN
          ALTER TABLE lens_treatment_price
            ADD CONSTRAINT uq_lens_treatment_cell UNIQUE (design_code, material_code, treatment_code);
        END IF;
      END $$;
    `);

    // Precios de tratamiento por (diseño × material). Orden: cr39, poly, 1.67, 1.74.
    this.addSql(`
      INSERT INTO lens_treatment_price (design_code, material_code, treatment_code, price_cents) VALUES
        ('sv','cr39','ar-green',2000),('sv','poly','ar-green',2000),('sv','1.67','ar-green',3500),('sv','1.74','ar-green',3500),
        ('sv','cr39','ar-blue',3500),('sv','poly','ar-blue',3500),('sv','1.67','ar-blue',4200),('sv','1.74','ar-blue',4500),
        ('sv','cr39','photo',4200),('sv','poly','photo',4600),('sv','1.67','photo',7600),('sv','1.74','photo',8000),
        ('bifocal','cr39','ar-green',3600),('bifocal','poly','ar-green',3600),('bifocal','1.67','ar-green',3600),('bifocal','1.74','ar-green',3600),
        ('bifocal','cr39','ar-blue',7200),('bifocal','poly','ar-blue',7200),('bifocal','1.67','ar-blue',7200),('bifocal','1.74','ar-blue',7200),
        ('bifocal','cr39','photo',8500),('bifocal','poly','photo',8500),('bifocal','1.67','photo',8500),('bifocal','1.74','photo',8500),
        ('prog-mid','cr39','ar-green',3600),('prog-mid','poly','ar-green',3600),('prog-mid','1.67','ar-green',3600),('prog-mid','1.74','ar-green',3600),
        ('prog-mid','cr39','ar-blue',7200),('prog-mid','poly','ar-blue',7200),('prog-mid','1.67','ar-blue',7200),('prog-mid','1.74','ar-blue',7200),
        ('prog-mid','cr39','photo',4400),('prog-mid','poly','photo',5500),('prog-mid','1.67','photo',6800),('prog-mid','1.74','photo',6800),
        ('prog-high','cr39','ar-green',3600),('prog-high','poly','ar-green',3600),('prog-high','1.67','ar-green',3600),('prog-high','1.74','ar-green',3600),
        ('prog-high','cr39','ar-blue',7200),('prog-high','poly','ar-blue',7200),('prog-high','1.67','ar-blue',7200),('prog-high','1.74','ar-blue',7200),
        ('prog-high','cr39','photo',4500),('prog-high','poly','photo',4500),('prog-high','1.67','photo',7300),('prog-high','1.74','photo',7300)
      ON CONFLICT (design_code, material_code, treatment_code) DO UPDATE SET price_cents = EXCLUDED.price_cents;
    `);

    // Consolidar antirreflejos a AR Green / AR Blue. Las opciones antiguas se desactivan.
    this.addSql(`
      UPDATE lens_ar_option SET is_active = FALSE
      WHERE code IN ('ar-green-basic','ar-green-plus','ar-blue-protect','adequate','crystal','flawless','blue-uv-445');
    `);
    this.addSql(`
      INSERT INTO lens_ar_option (code, label_es, label_en, ar_group, price_cents, sort, is_active) VALUES
        ('ar-green','AR Green','AR Green','all',2000,0,TRUE),
        ('ar-blue','AR Blue','AR Blue','all',3500,1,TRUE)
      ON CONFLICT (code) DO UPDATE SET
        label_es = EXCLUDED.label_es, label_en = EXCLUDED.label_en,
        ar_group = EXCLUDED.ar_group, sort = EXCLUDED.sort, is_active = TRUE;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`DELETE FROM lens_ar_option WHERE code IN ('ar-green','ar-blue');`);
    this.addSql(`
      UPDATE lens_ar_option SET is_active = TRUE
      WHERE code IN ('ar-green-basic','ar-green-plus','ar-blue-protect','adequate','crystal','flawless','blue-uv-445');
    `);
    this.addSql(`ALTER TABLE lens_treatment_price DROP CONSTRAINT IF EXISTS uq_lens_treatment_cell;`);
    this.addSql(`DROP TABLE IF EXISTS lens_treatment_price;`);
  }
}

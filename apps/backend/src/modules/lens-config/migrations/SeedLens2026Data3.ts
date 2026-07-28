import { Migration } from "@mikro-orm/migrations";

/**
 * Seed the 2026 lens price list data. Done in a migration (not `medusa exec`) so it
 * runs deterministically as part of db:migrate. Idempotent via ON CONFLICT.
 * Amounts are USD cents (matches the lens-config module's *_cents columns); the
 * storefront converts to dollars at the Medusa cart boundary.
 */
export class SeedLens2026Data3 extends Migration {
  async up(): Promise<void> {
    // Make the (design, material) cell unique so base prices upsert cleanly.
    this.addSql(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_lens_base_cell') THEN
          ALTER TABLE lens_base_price ADD CONSTRAINT uq_lens_base_cell UNIQUE (design_code, material_code);
        END IF;
      END $$;
    `);

    this.addSql(`
      INSERT INTO lens_design (code, category, label_es, label_en, requires_rx, requires_add, sort) VALUES
        ('sv','sv','Visión Sencilla','Single Vision',TRUE,FALSE,0),
        ('bifocal','bifocal','Bifocal FT-28','Bifocal FT-28',TRUE,TRUE,1),
        ('prog-mid','prog','Progresivo Gama Media','Progressive · Mid',TRUE,TRUE,2),
        ('prog-high','prog','Progresivo Gama Alta','Progressive · Premium',TRUE,TRUE,3)
      ON CONFLICT (code) DO NOTHING;
    `);

    this.addSql(`
      INSERT INTO lens_material (code, label_es, label_en, desc_es, desc_en, max_abs, sort) VALUES
        ('cr39','CR-39 (Resina)','CR-39 (Resin)','Estándar, económico.','Standard, budget.',2,0),
        ('poly','Policarbonato','Polycarbonate','Resistente a impactos. Niños/deporte.','Impact-resistant. Kids/sport.',3,1),
        ('1.56','Índice 1.56','Index 1.56','Más delgado que CR-39.','Thinner than CR-39.',3,2),
        ('1.61','Índice 1.61','Index 1.61','Delgado.','Thin.',4,3),
        ('1.67','Índice 1.67','Index 1.67','Muy delgado.','Very thin.',6,4),
        ('1.74','Índice 1.74','Index 1.74','Ultra delgado. Alta graduación.','Ultra-thin. High Rx.',99,5)
      ON CONFLICT (code) DO NOTHING;
    `);

    this.addSql(`
      INSERT INTO lens_base_price (design_code, material_code, price_cents) VALUES
        ('sv','cr39',6000),('sv','poly',9000),('sv','1.56',10000),('sv','1.61',10000),('sv','1.67',12000),('sv','1.74',15000),
        ('bifocal','cr39',13000),('bifocal','poly',14000),('bifocal','1.56',14000),('bifocal','1.61',14000),('bifocal','1.67',16000),('bifocal','1.74',16000),
        ('prog-mid','cr39',18000),('prog-mid','poly',18000),('prog-mid','1.56',18000),('prog-mid','1.61',18000),('prog-mid','1.67',20000),('prog-mid','1.74',23000),
        ('prog-high','cr39',24000),('prog-high','poly',24000),('prog-high','1.56',24000),('prog-high','1.61',24000),('prog-high','1.67',28000),('prog-high','1.74',30000)
      ON CONFLICT (design_code, material_code) DO NOTHING;
    `);

    this.addSql(`
      INSERT INTO lens_photo_option (code, label_es, label_en, colors, price_sv_cents, price_bifocal_cents, price_prog_cents, sort) VALUES
        ('photo-grey','Fotocromático Grey','Photochromic Grey','{grey}',8500,11000,9000,0),
        ('photo-brown','Fotocromático Brown','Photochromic Brown','{brown}',NULL,11000,9000,1),
        ('trans-s-grey','Transitions Gen S Grey','Transitions Gen S Grey','{grey}',10500,10500,10500,2),
        ('trans-s-brown','Transitions Gen S Brown','Transitions Gen S Brown','{brown}',10500,10500,10500,3),
        ('trans-s-green','Transitions Gen S Graphite Green','Transitions Gen S Graphite Green','{green}',10500,10500,10500,4),
        ('trans-x-grey','Transitions Xtractive Grey','Transitions Xtractive Grey','{grey}',13000,13000,13000,5),
        ('trans-x-brown','Transitions Xtractive Brown (RAM)','Transitions Xtractive Brown (RAM)','{brown}',13000,13000,13000,6)
      ON CONFLICT (code) DO NOTHING;
    `);

    this.addSql(`
      INSERT INTO lens_ar_option (code, label_es, label_en, ar_group, price_cents, sort) VALUES
        ('ar-green-basic','AR Green Básico','AR Green Basic','sv',6000,0),
        ('ar-green-plus','AR Green Plus','AR Green Plus','sv',9000,1),
        ('ar-blue-protect','AR Blue Protect','AR Blue Protect','sv',9000,2),
        ('adequate','Adequate','Adequate','bifprog',5000,3),
        ('crystal','Crystal','Crystal','bifprog',8000,4),
        ('flawless','Flawless','Flawless','bifprog',12000,5),
        ('blue-uv-445','Blue UV 445','Blue UV 445','bifprog',12000,6)
      ON CONFLICT (code) DO NOTHING;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`DELETE FROM lens_ar_option WHERE code IN ('ar-green-basic','ar-green-plus','ar-blue-protect','adequate','crystal','flawless','blue-uv-445');`);
    this.addSql(`DELETE FROM lens_photo_option WHERE code IN ('photo-grey','photo-brown','trans-s-grey','trans-s-brown','trans-s-green','trans-x-grey','trans-x-brown');`);
    this.addSql(`DELETE FROM lens_base_price;`);
    this.addSql(`DELETE FROM lens_material WHERE code IN ('cr39','poly','1.56','1.61','1.67','1.74');`);
    this.addSql(`DELETE FROM lens_design WHERE code IN ('sv','bifocal','prog-mid','prog-high');`);
    this.addSql(`ALTER TABLE lens_base_price DROP CONSTRAINT IF EXISTS uq_lens_base_cell;`);
  }
}

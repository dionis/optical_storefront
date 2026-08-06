import { Migration } from "@mikro-orm/migrations";

/**
 * Actualiza la matriz base a los precios de VENTA del listado RUBILENT y elimina
 * los materiales 1.56 y 1.61 (ya no se ofrecen). Se aplica en `db:migrate`, así el
 * precio real de la tienda cambia al desplegar el backend, SIN seeds manuales y
 * SIN valores hardcodeados en el frontend (la fuente de verdad sigue en la BD).
 * Montos en centavos USD (las columnas *_cents del módulo).
 */
export class UpdateLensPricesRubilent5 extends Migration {
  async up(): Promise<void> {
    // 1) Precios base de VENTA por (diseño × material), en centavos.
    this.addSql(`
      UPDATE lens_base_price AS b SET price_cents = v.cents FROM (VALUES
        ('sv','cr39',2400),('sv','poly',3000),('sv','1.67',5200),('sv','1.74',9500),
        ('bifocal','cr39',4700),('bifocal','poly',5500),('bifocal','1.67',16000),('bifocal','1.74',18000),
        ('prog-mid','cr39',7500),('prog-mid','poly',7500),('prog-mid','1.67',13100),('prog-mid','1.74',14500),
        ('prog-high','cr39',10100),('prog-high','poly',10100),('prog-high','1.67',13500),('prog-high','1.74',13500)
      ) AS v(design_code, material_code, cents)
      WHERE b.design_code = v.design_code AND b.material_code = v.material_code;
    `);

    // 2) Quitar materiales 1.56 y 1.61 (y sus celdas de precio).
    this.addSql(`DELETE FROM lens_base_price WHERE material_code IN ('1.56','1.61');`);
    this.addSql(`DELETE FROM lens_material WHERE code IN ('1.56','1.61');`);
  }

  async down(): Promise<void> {
    // Restaura los materiales quitados (los precios previos quedan en el historial de git).
    this.addSql(`
      INSERT INTO lens_material (code, label_es, label_en, desc_es, desc_en, max_abs, sort) VALUES
        ('1.56','Índice 1.56','Index 1.56','Más delgado que CR-39.','Thinner than CR-39.',3,2),
        ('1.61','Índice 1.61','Index 1.61','Delgado.','Thin.',4,3)
      ON CONFLICT (code) DO NOTHING;
    `);
  }
}

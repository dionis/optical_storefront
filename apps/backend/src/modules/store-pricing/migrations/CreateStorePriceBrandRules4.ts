import { Migration } from "@mikro-orm/migrations";

/**
 * (El nombre empieza por «Create…» a propósito: Medusa corre las migraciones
 * de un módulo por ORDEN DE NOMBRE DE ARCHIVO, no por el número del final, y
 * esta tiene que ir después de la que crea `store_price_rule`. Lo vigila
 * tests/migration-order.test.ts.)
 *
 * Reglas de precio POR MARCA y por establecimiento (petición del dueño,
 * 5-nov-2026: «se debe poder poner regla de formación de precio para marcas por
 * separado y por establecimiento»).
 *
 * Dos cosas:
 *
 *  1. El `scope` de `store_price_rule` admite ahora `brand`. Una regla de marca
 *     lleva el *slug* en `target` (`metadata.brand_slug`, el mismo que usa el
 *     surtido), así que los modelos que el scraper añada después la heredan sin
 *     tocar nada. Con `mode` `override` es un PRECIO FIJO para toda la marca;
 *     con `percent`/`delta`, el ajuste de siempre pero solo para esa marca.
 *
 *  2. Siembra los precios que el dueño dictó para las tiendas físicas:
 *     Peachtree 45, Four You 60, Trendy 50, Flexure 75, Millennial 75,
 *     Grande 75 y Di Caprio 90 (USD por montura).
 *
 *     Se escribe UNA regla por tienda activa y marca, solo si esa tienda no
 *     tiene ya una regla abierta para esa marca: si el dueño cambia un precio
 *     en el panel, un despliegue posterior no se lo pisa. La tienda online no
 *     es un establecimiento (es un canal), así que esto no la toca.
 */

/** Slug del catálogo → precio de venta en tienda física (USD). */
const BRAND_PRICES: ReadonlyArray<[string, number]> = [
  ["peachtree", 45],
  ["4u", 60], // «For You» / Four You
  ["trendy", 50], // «Trending»
  ["flexure", 75],
  ["millennial", 75],
  ["grande", 75],
  ["di-caprio", 90],
];

export class CreateStorePriceBrandRules4 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE store_price_rule DROP CONSTRAINT IF EXISTS store_price_rule_scope_check;`);
    this.addSql(`ALTER TABLE store_price_rule ADD CONSTRAINT store_price_rule_scope_check CHECK (scope IN ('all', 'frame', 'case', 'brand'));`);

    for (const [slug, price] of BRAND_PRICES) {
      // Una fila por tienda activa que aún no tenga regla abierta de esa marca.
      // El guard de `to_regclass` es por si en una base nueva esta migración
      // corriera antes de que exista `establishment`: entonces no siembra nada
      // (el dueño pone los precios en el panel) en vez de romper el despliegue.
      this.addSql(`
        DO $$
        BEGIN
          IF to_regclass('public.establishment') IS NOT NULL THEN
            INSERT INTO store_price_rule (id, establishment_id, scope, target, mode, value, valid_from, source, created_by)
            SELECT
              'prule_brand_' || substr(md5(e.id || ':${slug}'), 1, 20),
              e.id, 'brand', '${slug}', 'override', ${price}, NOW(), 'owner-brand-prices-2026-11', NULL
            FROM establishment e
            WHERE e.deleted_at IS NULL
              AND COALESCE(e.is_active, TRUE) = TRUE
              AND NOT EXISTS (
                SELECT 1 FROM store_price_rule r
                WHERE r.establishment_id = e.id AND r.scope = 'brand' AND r.target = '${slug}'
                  AND r.valid_to IS NULL AND r.deleted_at IS NULL
              )
            ON CONFLICT (id) DO NOTHING;
          END IF;
        END $$;
      `);
    }
  }

  async down(): Promise<void> {
    // Solo lo que sembró esta migración; una regla que el dueño haya tocado
    // después tiene otro `source` y se queda.
    this.addSql(`DELETE FROM store_price_rule WHERE source = 'owner-brand-prices-2026-11';`);
    this.addSql(`UPDATE store_price_rule SET scope = 'frame' WHERE scope = 'brand';`);
    this.addSql(`ALTER TABLE store_price_rule DROP CONSTRAINT IF EXISTS store_price_rule_scope_check;`);
    this.addSql(`ALTER TABLE store_price_rule ADD CONSTRAINT store_price_rule_scope_check CHECK (scope IN ('all', 'frame', 'case'));`);
  }
}

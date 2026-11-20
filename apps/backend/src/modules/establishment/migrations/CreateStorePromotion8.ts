import { Migration } from "@mikro-orm/migrations";

/**
 * Promotions per store (owner, 15-nov-2026; lib/promotions.ts, docs/PROMOCIONES.md).
 * `establishment_ids` NULL = every store; `starts_on`/`ends_on` inclusive store
 * dates (NULL = open-ended). The sale keeps a copy of the one it used
 * (`pos_sale.promotion`, migration CreatePos9).
 *
 * Five examples, one of each kind, switched OFF (lib/promotions.ts
 * SEED_PROMOTIONS — keep the two lists the same): only on a table that has
 * never had a row, so a practice that deleted them never gets them back.
 * Idempotent.
 */
export class CreateStorePromotion8 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS store_promotion (
        id                TEXT PRIMARY KEY,
        name              TEXT NOT NULL,
        description       TEXT,
        kind              TEXT NOT NULL CHECK (kind IN ('percent', 'bogo', 'free_service', 'gift')),
        establishment_ids TEXT[],
        starts_on         DATE,
        ends_on           DATE,
        is_active         BOOLEAN NOT NULL DEFAULT true,
        pct               INTEGER CHECK (pct IS NULL OR (pct BETWEEN 1 AND 100)),
        buy_qty           INTEGER,
        get_qty           INTEGER,
        min_total_cents   INTEGER,
        value_cents       INTEGER,
        sort              INTEGER NOT NULL DEFAULT 0,
        created_by        TEXT,
        updated_by        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at        TIMESTAMPTZ
      );
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_store_promotion_live" ON store_promotion (is_active, starts_on, ends_on) WHERE deleted_at IS NULL;`);
    this.addSql(`
      INSERT INTO store_promotion (id, name, description, kind, pct, buy_qty, get_qty, min_total_cents, value_cents, sort, is_active)
      SELECT * FROM (VALUES
          ('promo_seed_1', 'Compre 2, lleve 1 gratis', 'Al comprar dos espejuelos completos, el tercero (el de menor precio) va gratis. Se aplica en la venta del par gratis, con los números de las dos ventas pagadas.', 'bogo', 100, 2, 1, NULL, NULL, 1, false),
          ('promo_seed_2', 'Examen de la vista gratis con tu compra', 'El examen de la vista no se cobra si el paciente compra sus espejuelos con nosotros.', 'free_service', NULL, NULL, NULL, NULL, 5000, 2, false),
          ('promo_seed_3', 'Segundo par al 50 %', 'Al comprar unos espejuelos, el segundo par sale a mitad de precio. Se aplica en la venta del segundo par, con el número de la venta del primero.', 'bogo', 50, 1, 1, NULL, NULL, 3, false),
          ('promo_seed_4', 'Estuche y limpiador de regalo', 'En compras desde $150, el paciente se lleva un estuche y un limpiador sin costo.', 'gift', NULL, NULL, NULL, 15000, 2500, 4, false),
          ('promo_seed_5', 'Temporada escolar: 15 % en toda la compra', '15 % de descuento en toda la compra durante la temporada escolar.', 'percent', 15, NULL, NULL, NULL, NULL, 5, false)
      ) AS v(id, name, description, kind, pct, buy_qty, get_qty, min_total_cents, value_cents, sort, is_active)
      WHERE NOT EXISTS (SELECT 1 FROM store_promotion);
    `);
    // Into the operation log right away (docs/OPERATION-LOG.md), not at the next hourly pass.
    this.addSql(`DO $d$ BEGIN IF to_regprocedure('oplog_attach_all()') IS NOT NULL THEN PERFORM oplog_attach_all(); END IF; END $d$;`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS store_promotion;`);
  }
}

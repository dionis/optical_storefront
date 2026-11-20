import { Migration } from "@mikro-orm/migrations";

/**
 * The floor and the ceiling of a selling price: `store_price_band` (the
 * chain's, see models/price-band.ts) and `store_price_band_variation` (one
 * store's own, see models/price-band-variation.ts).
 *
 * The owner asked for a rule he «lo hace una vez para todas las tiendas» and
 * can then bend store by store: if the converted price lands under a threshold
 * it goes up to a fixed figure, if it lands over another it comes down to a
 * ceiling. Two numbers per side, so "under $30 it is worth $60" is expressible
 * — one number could only have said "under $30 it is worth $30".
 *
 * NOTHING IS SEEDED. On the day this runs there is no band at all and every
 * price is exactly what it was: the owner turns it on from the panel, with the
 * impact preview in front of him. A 30→60 floor moves 285 of today's 581 frame
 * models, and that is not a thing to switch on behind someone's back.
 *
 * Idempotent (IF NOT EXISTS everywhere): the migration runs on every deploy
 * (docker-entrypoint.sh calls `medusa db:migrate`).
 *
 * Named to sort after CreateStoreFrameCostVariation5: Medusa runs a module's
 * migrations in FILE-NAME order (tests/migration-order.test.ts).
 */
export class CreateStorePriceBand6 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS store_price_band (
        id                TEXT PRIMARY KEY,
        scope             TEXT NOT NULL DEFAULT 'chain',
        floor_below_cents INTEGER,
        floor_to_cents    INTEGER,
        cap_above_cents   INTEGER,
        cap_to_cents      INTEGER,
        apply_to_cases    BOOLEAN NOT NULL DEFAULT FALSE,
        enabled           BOOLEAN NOT NULL DEFAULT TRUE,
        updated_by        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ
      );
    `);
    // Exactly ONE live master band: the chain's floor and ceiling are a single
    // decision, and a second row would be a second answer to "what is it?".
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_store_price_band_scope
        ON store_price_band (scope)
        WHERE deleted_at IS NULL;
    `);
    this.addSql(`
      CREATE TABLE IF NOT EXISTS store_price_band_variation (
        id                TEXT PRIMARY KEY,
        establishment_id  TEXT NOT NULL,
        floor_below_cents INTEGER,
        floor_to_cents    INTEGER,
        cap_above_cents   INTEGER,
        cap_to_cents      INTEGER,
        apply_to_cases    BOOLEAN NOT NULL DEFAULT FALSE,
        enabled           BOOLEAN NOT NULL DEFAULT TRUE,
        updated_by        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ
      );
    `);
    // One live band per store: a new one replaces that store's instead of
    // stacking a second row the resolution would have to choose between.
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_store_price_band_variation
        ON store_price_band_variation (establishment_id)
        WHERE deleted_at IS NULL;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS store_price_band_variation;`);
    this.addSql(`DROP TABLE IF EXISTS store_price_band;`);
  }
}

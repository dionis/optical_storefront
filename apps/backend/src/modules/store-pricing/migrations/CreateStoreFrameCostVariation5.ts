import { Migration } from "@mikro-orm/migrations";

/**
 * Per-store cost of a frame or case model
 * (`store_frame_cost_variation`, see models/frame-cost-variation.ts).
 *
 * `CreateStoreFrameCost4` put the chain's cost in place — the supplier's list
 * and the owner's edits over it. This completes the owner's sentence: «los
 * costos se aplican a todas las tiendas, pero cada tienda maneja sus costos por
 * separado». A row here exists ONLY where one store pays something different;
 * everything else inherits the master, exactly as `lens_store_price` does for
 * the lens prices.
 *
 * Nothing is seeded: on the day this runs every store inherits, so every
 * margin reads precisely as it did before — the per-store layer starts empty
 * and only the owner fills it.
 *
 * Idempotent (IF NOT EXISTS everywhere): the migration runs on every deploy
 * (docker-entrypoint.sh calls `medusa db:migrate`).
 *
 * Named to sort after CreateStoreFrameCost4: Medusa runs a module's migrations
 * in FILE-NAME order (tests/migration-order.test.ts).
 */
export class CreateStoreFrameCostVariation5 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS store_frame_cost_variation (
        id               TEXT PRIMARY KEY,
        establishment_id TEXT NOT NULL,
        sku              TEXT NOT NULL,
        cost_cents       INTEGER NOT NULL DEFAULT 0,
        updated_by       TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at       TIMESTAMPTZ
      );
    `);
    // One live variation per (store, normalised SKU): a new figure replaces the
    // store's old one instead of stacking a second row the resolution would
    // have to choose between.
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_store_frame_cost_variation
        ON store_frame_cost_variation (establishment_id, sku)
        WHERE deleted_at IS NULL;
    `);
    // The read that matters is "every variation of this store" (the panel with
    // a store chosen) and "every variation" (warming the cost cache).
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_store_frame_cost_variation_store"
        ON store_frame_cost_variation (establishment_id)
        WHERE deleted_at IS NULL;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS store_frame_cost_variation;`);
  }
}

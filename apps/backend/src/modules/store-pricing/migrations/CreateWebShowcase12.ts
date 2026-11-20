import { Migration } from "@mikro-orm/migrations";

/**
 * «Vitrina de la tienda web» (owner, 20-nov-2026): which brands the web shop
 * shows first as its example frames (home «Los más vendidos» and the
 * catalogue's default order) — the catalogue order (as before), chosen brands,
 * or a random mix of brands. One row, id "default" (lib/web-showcase.ts).
 *
 * Not in the ORM model on purpose: it is read and written by SQL
 * (lib/web-showcase-data.ts) and a database without the table answers the
 * catalogue order, so a failed `db:migrate` never breaks the shop.
 * Idempotent.
 */
export class CreateWebShowcase12 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS web_showcase (
        id          TEXT PRIMARY KEY,
        mode        TEXT NOT NULL DEFAULT 'catalog' CHECK (mode IN ('catalog', 'brands', 'random')),
        brands      JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_by  TEXT,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // Into the operation log right away (docs/OPERATION-LOG.md), not at the next hourly pass.
    this.addSql(`DO $d$ BEGIN IF to_regprocedure('oplog_attach_all()') IS NOT NULL THEN PERFORM oplog_attach_all(); END IF; END $d$;`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS web_showcase;`);
  }
}

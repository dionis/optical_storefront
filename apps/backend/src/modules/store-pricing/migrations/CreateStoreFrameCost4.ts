import { Migration } from "@mikro-orm/migrations";
import { frameCostSeedStatements } from "../frame-cost-seed";

/**
 * The supplier's cost of every frame and case model (`store_frame_cost`,
 * see models/frame-cost.ts), seeded with Capri Optics' "Discount Price List
 * July 2026" — 609 rows.
 *
 * Until now that cost only existed in the browser
 * (apps/capri-storefront/src/data/capriPrices.js, kept by hand), so no margin
 * in the panel started from a real figure. The owner's requirement: "cost and
 * price must appear in every commercial view, and they must be editable, so
 * the accounting is 100 % reliable."
 *
 * THE RULE THAT CANNOT BREAK: a row the owner edited (`source = 'owner_edit'`)
 * is never written again — not by a later run of this migration and not by a
 * new supplier list. The `WHERE` of every upsert lives in
 * `../frame-cost-seed.ts` and is covered by tests/frame-cost.test.ts.
 *
 * Named to sort after CreateStoreCostToggle3: Medusa runs a module's
 * migrations in FILE-NAME order (tests/migration-order.test.ts).
 */
export class CreateStoreFrameCost4 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS store_frame_cost (
        id             TEXT PRIMARY KEY,
        sku            TEXT NOT NULL,
        supplier_model TEXT NOT NULL,
        book_cents     INTEGER NOT NULL DEFAULT 0,
        cost_cents     INTEGER NOT NULL DEFAULT 0,
        source         TEXT NOT NULL DEFAULT 'supplier_list',
        updated_by     TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at     TIMESTAMPTZ
      );
    `);
    this.addSql(`ALTER TABLE store_frame_cost DROP CONSTRAINT IF EXISTS store_frame_cost_source_check;`);
    this.addSql(
      `ALTER TABLE store_frame_cost ADD CONSTRAINT store_frame_cost_source_check CHECK (source IN ('supplier_list', 'owner_edit'));`
    );
    // One live row per normalised SKU — and the conflict target of the seed
    // below, which is why its predicate is repeated there.
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_store_frame_cost_sku
        ON store_frame_cost (sku)
        WHERE deleted_at IS NULL;
    `);
    // The panel reads the whole table in one go (~600 rows) and joins by SKU,
    // so the only other lookup worth an index is "what did the owner change".
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_store_frame_cost_owner_edit"
        ON store_frame_cost (source)
        WHERE source = 'owner_edit' AND deleted_at IS NULL;
    `);

    for (const sql of frameCostSeedStatements()) this.addSql(sql);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS store_frame_cost;`);
  }
}

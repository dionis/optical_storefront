import { Migration } from "@mikro-orm/migrations";
import { frameCostSeedStatements, prevFrameCostSeedRows } from "../frame-cost-seed";

/**
 * v2 (docs/PRICE-MATRIX.md, 7-nov-2026): the PREVIOUS supplier list is the
 * fallback of the 2026 one, so `store_frame_cost.source` gains
 * `supplier_list_prev` (the CHECK constraint of CreateStoreFrameCost4 is
 * rebuilt with the third value) and the previous list's rows that the 2026
 * list does not carry are seeded (`prevFrameCostSeedRows`).
 *
 * THE RULE THAT CANNOT BREAK is the same as in CreateStoreFrameCost4: the
 * upsert's guard (`WHERE store_frame_cost.source = 'supplier_list_prev'`)
 * never touches an owner's edit nor a 2026 row. Idempotent.
 *
 * Note: with today's lists the seed adds NO row — every key of the previous
 * book is either in the 2026 list or had no wholesale figure (DI CAPRIO CASE,
 * GRANDE CASE, SIMPLYLITE CASE). The constraint still has to accept the value
 * for the owner's «clear» (setOwnerFrameCost) and for the next list.
 *
 * Models are matched to these rows by MODEL first (lib/frame-cost.ts
 * `frameCostCandidates`): the rows are keyed by the supplier's key, and every
 * catalogue model — whatever its SKUs look like — resolves to that key, so one
 * row per supplier key IS one row per catalogue model.
 *
 * Named to sort after every Create* migration of the module
 * (tests/migration-order.test.ts).
 */
export class UpgradeStoreFrameCostPrev9 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE store_frame_cost DROP CONSTRAINT IF EXISTS store_frame_cost_source_check;`);
    this.addSql(
      `ALTER TABLE store_frame_cost ADD CONSTRAINT store_frame_cost_source_check CHECK (source IN ('supplier_list', 'supplier_list_prev', 'owner_edit'));`
    );
    for (const sql of frameCostSeedStatements(prevFrameCostSeedRows(), "supplier_list_prev")) this.addSql(sql);
  }

  async down(): Promise<void> {
    this.addSql(`UPDATE store_frame_cost SET source = 'supplier_list' WHERE source = 'supplier_list_prev';`);
    this.addSql(`ALTER TABLE store_frame_cost DROP CONSTRAINT IF EXISTS store_frame_cost_source_check;`);
    this.addSql(
      `ALTER TABLE store_frame_cost ADD CONSTRAINT store_frame_cost_source_check CHECK (source IN ('supplier_list', 'owner_edit'));`
    );
  }
}

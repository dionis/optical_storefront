import { Migration } from "@mikro-orm/migrations";
import { frameCostSeedStatements, prevFrameCostSeedRows } from "../frame-cost-seed";

/**
 * Re-seeds the Capri Optics supplier list on top of whatever `store_frame_cost`
 * holds today (19-nov-2026). The seed was first written in
 * `CreateStoreFrameCost4.ts`, but a database that ran that migration before
 * the seed was added to its `up()` keeps the schema and has NO rows — Medusa
 * tracks migrations by file name and never re-runs one. So every CAPRI
 * cost reads as «falta» in the admin pricing panel, which is the symptom the
 * owner reported: «los costos de los espejuelos de capri deben aparecer en el
 * panel de admin que ahora mismo no salen».
 *
 * Fix: re-run the seed statements verbatim. Each one is an UPSERT whose
 * `DO UPDATE` carries `WHERE store_frame_cost.source = <this list>` (see
 * `../frame-cost-seed.ts`), so:
 *
 *   · an empty table is filled;
 *   · a database that already has the supplier rows gets them refreshed
 *     against the current list;
 *   · a row the owner edited (`source = 'owner_edit'`) is NOT touched.
 *
 * Both the 2026 list and the previous one (v2) are re-seeded, so a model only
 * the previous list carries still reads with a real figure. Idempotent, safe
 * to run on every deploy; the test harness is `tests/frame-cost.test.ts`.
 *
 * Named to sort after every Create*, UpgradeStoreFrameCostPrev9 and
 * UpgradePriceRuleCostMultiple10 (tests/migration-order.test.ts).
 */
export class UpgradeStoreFrameCostReseed11 extends Migration {
  async up(): Promise<void> {
    for (const sql of frameCostSeedStatements()) this.addSql(sql);
    for (const sql of frameCostSeedStatements(prevFrameCostSeedRows(), "supplier_list_prev")) this.addSql(sql);
  }

  async down(): Promise<void> {
    // Nothing to roll back: the seed is idempotent and the previous state
    // (an empty table or a stale snapshot) cannot be rebuilt in reverse
    // without losing the owner's edits. Rolling back is a no-op.
  }
}

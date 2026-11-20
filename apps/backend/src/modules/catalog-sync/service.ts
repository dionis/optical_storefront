import { MedusaService } from "@medusajs/framework/utils";
import { CatalogSyncRun, CatalogSyncSetting } from "./models/index";

/**
 * CRUD only. Claiming a run must be atomic between two workers, so the queue
 * operations are raw SQL in `src/lib/catalog-sync-data.ts`; the rules (when the
 * monthly run is due, what a valid setting is) are pure functions in
 * `src/lib/catalog-sync.ts`.
 */
export default class CatalogSyncModuleService extends MedusaService({
  CatalogSyncRun,
  CatalogSyncSetting,
}) {}

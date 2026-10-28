import { MedusaService } from "@medusajs/framework/utils";
import { StoreAssortmentRule } from "./models/index";

/**
 * CRUD only — what the rules mean lives in src/lib/store-assortment.ts and the
 * reads/writes in src/lib/store-assortment-data.ts.
 */
export default class StoreAssortmentModuleService extends MedusaService({
  StoreAssortmentRule,
}) {}

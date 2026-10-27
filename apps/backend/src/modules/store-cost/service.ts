import { MedusaService } from "@medusajs/framework/utils";
import { CostItem } from "./models/index";

/** CRUD only — proration and the monthly result are in src/lib/store-costs.ts and store-pnl.ts. */
export default class StoreCostModuleService extends MedusaService({
  CostItem,
}) {}

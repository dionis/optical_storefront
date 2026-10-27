import { MedusaService } from "@medusajs/framework/utils";
import { SaleFact } from "./models/index";

/** Writes come from src/lib/sale-facts.ts; aggregation is SQL in src/lib/sales-analytics.ts. */
export default class SalesAnalyticsModuleService extends MedusaService({
  SaleFact,
}) {}

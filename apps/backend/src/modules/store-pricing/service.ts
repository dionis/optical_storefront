import { MedusaService } from "@medusajs/framework/utils";
import { PricingSetting, StoreCostToggle, StorePriceRule } from "./models/index";

/**
 * CRUD only — the price rules' semantics live in src/lib/store-pricing.ts, the
 * writes (close + create) in src/lib/store-pricing-data.ts and the per-store
 * cost switches in src/lib/store-cost-toggle.ts.
 */
export default class StorePricingModuleService extends MedusaService({
  StorePriceRule,
  StoreCostToggle,
  PricingSetting,
}) {}

import { MedusaService } from "@medusajs/framework/utils";
import { PricingSetting, StoreCostToggle, StoreFrameCost, StorePriceRule } from "./models/index";

/**
 * CRUD only — the price rules' semantics live in src/lib/store-pricing.ts, the
 * writes (close + create) in src/lib/store-pricing-data.ts, the per-store
 * cost switches in src/lib/store-cost-toggle.ts and the supplier cost of each
 * frame model in src/lib/frame-cost.ts.
 */
export default class StorePricingModuleService extends MedusaService({
  StorePriceRule,
  StoreCostToggle,
  PricingSetting,
  StoreFrameCost,
}) {}

import { MedusaService } from "@medusajs/framework/utils";
import { StorePriceRule } from "./models/index";

/**
 * CRUD only — the price rules' semantics live in src/lib/store-pricing.ts and
 * the writes (close + create) in src/lib/store-pricing-data.ts.
 */
export default class StorePricingModuleService extends MedusaService({
  StorePriceRule,
}) {}

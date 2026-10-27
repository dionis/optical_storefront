import StorePricingModuleService from "./service";
import { Module } from "@medusajs/framework/utils";

// Module names must be camelCase — a dash here breaks resolution at runtime.
export const STORE_PRICING_MODULE = "storePricing";

export default Module(STORE_PRICING_MODULE, {
  service: StorePricingModuleService,
});

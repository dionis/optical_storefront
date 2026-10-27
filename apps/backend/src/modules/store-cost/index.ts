import StoreCostModuleService from "./service";
import { Module } from "@medusajs/framework/utils";

// Module names must be camelCase — a dash here breaks resolution at runtime.
export const STORE_COST_MODULE = "storeCost";

export default Module(STORE_COST_MODULE, {
  service: StoreCostModuleService,
});

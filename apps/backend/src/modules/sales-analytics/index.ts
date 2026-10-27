import SalesAnalyticsModuleService from "./service";
import { Module } from "@medusajs/framework/utils";

// Module names must be camelCase — a dash here breaks resolution at runtime.
export const SALES_ANALYTICS_MODULE = "salesAnalytics";

export default Module(SALES_ANALYTICS_MODULE, {
  service: SalesAnalyticsModuleService,
});

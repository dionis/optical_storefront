import SalesAlertModuleService from "./service";
import { Module } from "@medusajs/framework/utils";

// Module names must be camelCase — a dash here breaks resolution at runtime.
export const SALES_ALERT_MODULE = "salesAlert";

export default Module(SALES_ALERT_MODULE, {
  service: SalesAlertModuleService,
});

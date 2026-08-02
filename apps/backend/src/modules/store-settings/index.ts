import StoreSettingsModuleService from "./service";
import { Module } from "@medusajs/framework/utils";

// Module names must be camelCase — a dash here breaks resolution at runtime.
export const STORE_SETTINGS_MODULE = "storeSettings";

export default Module(STORE_SETTINGS_MODULE, {
  service: StoreSettingsModuleService,
});

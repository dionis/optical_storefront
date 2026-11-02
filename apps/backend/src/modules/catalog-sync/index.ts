import CatalogSyncModuleService from "./service";
import { Module } from "@medusajs/framework/utils";

// Module names must be camelCase — a dash here breaks resolution at runtime.
export const CATALOG_SYNC_MODULE = "catalogSync";

export default Module(CATALOG_SYNC_MODULE, {
  service: CatalogSyncModuleService,
});

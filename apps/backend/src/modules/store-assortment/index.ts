import StoreAssortmentModuleService from "./service";
import { Module } from "@medusajs/framework/utils";

// Module names must be camelCase — a dash here breaks resolution at runtime.
export const STORE_ASSORTMENT_MODULE = "storeAssortment";

export default Module(STORE_ASSORTMENT_MODULE, {
  service: StoreAssortmentModuleService,
});

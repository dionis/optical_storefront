import CostingModuleService from "./service";
import { Module } from "@medusajs/framework/utils";

export const COSTING_MODULE = "costing";

export default Module(COSTING_MODULE, {
  service: CostingModuleService,
});

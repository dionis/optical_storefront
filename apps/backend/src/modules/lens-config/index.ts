import LensConfigModuleService from "./service.js";
import { Module } from "@medusajs/framework/utils";

export const LENS_CONFIG_MODULE = "lensConfig";

export default Module(LENS_CONFIG_MODULE, {
  service: LensConfigModuleService,
});

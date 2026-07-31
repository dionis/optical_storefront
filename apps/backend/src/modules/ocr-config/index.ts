import OcrConfigModuleService from "./service";
import { Module } from "@medusajs/framework/utils";

// Module names must be camelCase — a dash here breaks resolution at runtime.
export const OCR_CONFIG_MODULE = "ocrConfig";

export default Module(OCR_CONFIG_MODULE, {
  service: OcrConfigModuleService,
});

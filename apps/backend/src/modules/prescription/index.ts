import PrescriptionModuleService from "./service.js";
import { Module } from "@medusajs/framework/utils";

export const PRESCRIPTION_MODULE = "prescription";

export default Module(PRESCRIPTION_MODULE, {
  service: PrescriptionModuleService,
});

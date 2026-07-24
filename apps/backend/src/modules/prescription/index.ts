import PrescriptionModuleService from "./service";
import { Module } from "@medusajs/framework/utils";

export const PRESCRIPTION_MODULE = "prescription";

export default Module(PRESCRIPTION_MODULE, {
  service: PrescriptionModuleService,
});

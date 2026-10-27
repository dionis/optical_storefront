import StaffModuleService from "./service";
import { Module } from "@medusajs/framework/utils";

export const STAFF_MODULE = "staff";

export default Module(STAFF_MODULE, {
  service: StaffModuleService,
});

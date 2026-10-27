import AuditModuleService from "./service";
import { Module } from "@medusajs/framework/utils";

export const AUDIT_MODULE = "audit";

export default Module(AUDIT_MODULE, {
  service: AuditModuleService,
});

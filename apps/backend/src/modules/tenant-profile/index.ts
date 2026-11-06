import TenantProfileModuleService from "./service";
import { Module } from "@medusajs/framework/utils";

// Module names must be camelCase — a dash here breaks resolution at runtime.
export const TENANT_PROFILE_MODULE = "tenantProfile";

export default Module(TENANT_PROFILE_MODULE, {
  service: TenantProfileModuleService,
});

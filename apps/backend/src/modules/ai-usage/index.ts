import AiUsageModuleService from "./service";
import { Module } from "@medusajs/framework/utils";

// Module names must be camelCase — a dash here breaks resolution at runtime.
export const AI_USAGE_MODULE = "aiUsage";

export default Module(AI_USAGE_MODULE, {
  service: AiUsageModuleService,
});

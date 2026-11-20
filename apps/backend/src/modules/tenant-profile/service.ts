import { MedusaService } from "@medusajs/framework/utils";
import { TenantProfile } from "./models/index";

/** CRUD only — rules (cleaning, owner resolution, caching) live in src/lib/tenant-profile.ts. */
export default class TenantProfileModuleService extends MedusaService({
  TenantProfile,
}) {}

import { MedusaService } from "@medusajs/framework/utils";
import { StaffAssignment } from "./models/index";

/**
 * CRUD only — role resolution and the rules around it live in
 * src/lib/staff-roles.ts and src/lib/staff-scope.ts.
 */
export default class StaffModuleService extends MedusaService({
  StaffAssignment,
}) {}

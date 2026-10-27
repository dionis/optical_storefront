import { model } from "@medusajs/framework/utils";

/**
 * A role a panel user holds, optionally limited to one establishment.
 *
 * `establishment_id` null = every establishment (the only kind phase 0 writes;
 * establishments arrive in phase 1). The effective role of a user is resolved
 * from all their rows in src/lib/staff-roles.ts — the owner never needs a row,
 * and a user with no rows at all is a pre-roles admin kept as superadmin.
 *
 * `discount_limit_pct` null = the limit of the role (configured by the owner or
 * a superadmin in phase 2); a number here is a personal override.
 *
 * Configuration, not order data — never purged by purge-orders.
 */
export const StaffAssignment = model.define("staff_assignment", {
  id: model.id({ prefix: "stfa" }).primaryKey(),
  user_id: model.text(),
  establishment_id: model.text().nullable(),
  role: model.enum(["owner", "superadmin", "supervisor", "manager", "seller"]),
  discount_limit_pct: model.float().nullable(),
  can_void: model.boolean().default(false),
  is_active: model.boolean().default(true),
  created_by: model.text().nullable(),
  updated_by: model.text().nullable(),
});

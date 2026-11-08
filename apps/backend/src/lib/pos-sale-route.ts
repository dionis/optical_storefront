import type { MedusaContainer } from "@medusajs/framework/types";
import type { StaffRole } from "./staff-roles";
import { getStaffScope } from "./staff-scope";

/**
 * Role of the person who made a sale, for "edited by them or by someone above
 * them" (lib/sale-permissions.ts). null when the sale has no seller, the user
 * is gone or cannot be read: the rule then treats them as the lowest role.
 */
export async function creatorRoleOf(container: MedusaContainer, sellerId: string | null): Promise<StaffRole | null> {
  if (!sellerId) return null;
  try {
    return (await getStaffScope(container, sellerId)).role;
  } catch {
    return null;
  }
}

/**
 * Who may change a point-of-sale sale after it was recorded (owner, 8-nov-2026).
 * Pure: the routes load the people and the sale, lib/pos-sale-admin.ts does the
 * writes.
 *
 *   edit the details     the person who made the sale, or anyone whose role is
 *                        ABOVE theirs (lib/staff-roles.ts roleRank) and who
 *                        works in the sale's store. Details = customer data,
 *                        prescription, delivery, promised date, internal note;
 *                        never the lines, the prices or the payments.
 *   delete (hide)        owner and superadmin only. Soft: the sale can be
 *                        restored, its number is never reused.
 *   restore              owner and superadmin only.
 *   move to a store      owner and superadmin only; the sale takes the next
 *                        number of the destination store.
 *
 * Reason codes are the panel's adm.err.pos.<reason>.
 */
import { canSellAt } from "./pos";
import { isAdminRole, roleRank, type StaffRole } from "./staff-roles";

export interface SaleActor {
  user_id: string;
  role: StaffRole | null;
  is_admin: boolean;
  establishment_ids: string[] | null;
}

export interface SaleForPermission {
  seller_id: string | null;
  establishment_id: string;
  status: string;
}

/**
 * Rank of the person who made the sale. Someone without a role any more
 * (deactivated, or every assignment switched off) or a user that no longer
 * exists counts as the lowest role — a seller — so a colleague at the same
 * level never gains the right to edit their sales; a supervisor or manager does.
 */
export const creatorRank = (role: StaffRole | null | undefined): number => Math.max(1, roleRank(role));

export function saleEditDenied(actor: SaleActor, sale: SaleForPermission, creatorRole: StaffRole | null): string | null {
  if (sale.status === "voided") return "sale_voided";
  if (!actor.role) return "forbidden_sale";
  if (!canSellAt(actor, sale.establishment_id)) return "forbidden_store";
  if (sale.seller_id && sale.seller_id === actor.user_id) return null;
  return roleRank(actor.role) > creatorRank(creatorRole) ? null : "edit_not_allowed";
}

/**
 * The photo of the patient wearing the frame (lib/pos-wearing-photo.ts):
 * taking, replacing or removing it is for whoever may correct the sale.
 * Removing it is also allowed on a voided sale, so a photo never outlives the
 * reason to keep it just because the sale was voided.
 */
export function wearingPhotoDenied(actor: SaleActor, sale: SaleForPermission, creatorRole: StaffRole | null, op: "set" | "remove"): string | null {
  const s = op === "remove" && sale.status === "voided" ? { ...sale, status: "completed" } : sale;
  return saleEditDenied(actor, s, creatorRole);
}

/** Delete, restore and move: owner and superadmin only. */
export function saleAdminDenied(actor: Pick<SaleActor, "role">): string | null {
  return isAdminRole(actor.role) ? null : "admin_only";
}

export function saleMoveDenied(
  actor: Pick<SaleActor, "role">,
  sale: SaleForPermission,
  target: { id: string; is_active: boolean; sales_channel_id: string | null } | null
): string | null {
  const denied = saleAdminDenied(actor);
  if (denied) return denied;
  if (!target || !target.is_active) return "store_not_found";
  if (target.id === sale.establishment_id) return "same_store";
  if (!target.sales_channel_id) return "store_without_channel";
  if (sale.status === "voided") return "sale_voided";
  return null;
}

/**
 * Prescription values of a sale (health data): owner, superadmin, supervisor
 * and manager on the sales of their stores, and the seller who made THIS sale
 * (owner, 9-nov-2026: they may correct its prescription). Any other seller
 * sees only «with / without prescription».
 */
export function canViewSaleRx(actor: SaleActor, sale: SaleForPermission): boolean {
  if (!actor.role || !canSellAt(actor, sale.establishment_id)) return false;
  if (actor.is_admin || actor.role === "supervisor" || actor.role === "manager") return true;
  return Boolean(sale.seller_id) && sale.seller_id === actor.user_id;
}

/** What the panel may offer on one sale (it never decides on its own: the routes check again). */
export function salePermissions(actor: SaleActor, sale: SaleForPermission, creatorRole: StaffRole | null): { can_edit: boolean; can_delete: boolean; can_move: boolean; can_view_rx: boolean; can_wearing_photo: boolean } {
  const admin = saleAdminDenied(actor) === null;
  return {
    can_edit: saleEditDenied(actor, sale, creatorRole) === null,
    can_delete: admin,
    can_move: admin && sale.status !== "voided",
    can_view_rx: canViewSaleRx(actor, sale),
    can_wearing_photo: wearingPhotoDenied(actor, sale, creatorRole, sale.status === "voided" ? "remove" : "set") === null,
  };
}

/** Length limits of the free texts written on a sale. */
export const INTERNAL_NOTE_MAX = 1000;
export const DELETE_REASON_MAX = 300;

/** Delete reasons offered by the panel; "other" needs a note. */
export const DELETE_REASONS = ["duplicate", "test", "wrong_store", "entered_by_mistake", "other"] as const;
export type DeleteReason = (typeof DELETE_REASONS)[number];

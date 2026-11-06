import type { MedusaContainer } from "@medusajs/framework/types";
import type { IUserModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { STAFF_MODULE } from "../modules/staff";
import { SELLER_MODULE } from "../modules/seller";
import type SellerModuleService from "../modules/seller/service";
import type { CounterSeller } from "./pos";
import { recordAudit } from "./audit";
import { accessStatusByUser, profilesByUser } from "./staff-profile-data";
import { explicitOwnerId } from "./tenant-profile";
import type StaffModuleService from "../modules/staff/service";
import {
  assignmentRowsFor,
  isAdminRole,
  resolveRole,
  type AssignmentLike,
  type ResolvedRole,
  type StaffRole,
} from "./staff-roles";

/**
 * What a signed-in panel user may see and do: their resolved role plus whether
 * they are the owner. Loaded on every /admin request by the staff guard, so it
 * is cached briefly per user; any role change calls invalidateStaffScope().
 */
export interface StaffScope extends ResolvedRole {
  user_id: string;
  is_owner: boolean;
  is_admin: boolean;
  /** Extra privileges granted to the person (staff_profile); admins hold them all implicitly (lib/staff-profile.ts hasPrivilege). */
  privileges: string[];
  /** Code printed on receipts and lab tickets instead of the person's name or email. */
  seller_code: string | null;
  /**
   * Seller record of a user with the `seller` role (null when none is linked).
   * It fixes the store and the one till they sell from (pos.ts sellerTillProblem).
   */
  seller?: CounterSeller | null;
  /** When the person was deactivated (HU-04); null = active. Set ⇒ role null. */
  disabled_at: string | null;
}

/**
 * Why `actorRole` may not deactivate or reactivate someone; null when allowed.
 * Mirrors the vetoes and reason codes of DELETE /admin/team/:id, since a
 * deactivation is "a delete that keeps the history":
 *   · the owner is never deactivated, whoever asks     → `super_admin`
 *   · only owner and superadmin manage the team         → `forbidden_role`
 *   · nobody deactivates themselves (ghost session)     → `self`
 *   · only the owner touches a superadmin               → `owner_only`
 * The same vetoes apply to reactivation: whoever may switch someone off is
 * whoever may switch them back on. Pure: no container, no database.
 */
export function statusChangeDenied(args: {
  actorRole: StaffRole | null;
  targetIsOwner: boolean;
  targetRole: StaffRole | null;
  actorIsTarget: boolean;
}): "super_admin" | "forbidden_role" | "self" | "owner_only" | null {
  if (args.targetIsOwner) return "super_admin";
  if (!isAdminRole(args.actorRole)) return "forbidden_role";
  if (args.actorIsTarget) return "self";
  if (args.targetRole === "superadmin" && args.actorRole !== "owner") return "owner_only";
  return null;
}

/**
 * The scope of someone who may do nothing in the panel: a deleted user whose
 * token has not expired yet, or a deactivated person. The guard answers 403
 * `inactive` to it (role null), and every role-scoped route sees no stores.
 */
function noAccessScope(userId: string, disabledAt: string | null): StaffScope {
  return {
    role: null,
    establishment_ids: [],
    discount_limit_pct: null,
    can_void: false,
    legacy: false,
    user_id: userId,
    is_owner: false,
    is_admin: false,
    privileges: [],
    seller_code: null,
    seller: null,
    disabled_at: disabledAt,
  };
}

/** Live seller record linked to a panel user, or null. */
export async function counterSellerFor(container: MedusaContainer, userId: string): Promise<CounterSeller | null> {
  const svc = container.resolve<SellerModuleService>(SELLER_MODULE);
  const rows = (await svc.listSellers({ user_id: userId } as never, { take: 1 })) as unknown as Record<string, unknown>[];
  const r = rows.find((x) => !x["deleted_at"]);
  if (!r) return null;
  return {
    id: String(r["id"]),
    code: String(r["code"] ?? "").toUpperCase(),
    active: r["active"] !== false,
    establishment_id: (r["establishment_id"] as string | null) ?? null,
    terminal_id: (r["terminal_id"] as string | null) ?? null,
  };
}

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; scope: StaffScope }>();
let ownerCache: { at: number; id: string | null } | null = null;

export function invalidateStaffScope(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
  ownerCache = null;
}

/**
 * The owner: the user the tenant profile names (set by an ownership transfer),
 * or — while none is named, or the named user no longer exists — the oldest
 * admin user, the rule the panel has always used. The ONE place this is
 * decided: /admin/team and the discount approvers ask here too.
 */
export async function ownerUserId(container: MedusaContainer): Promise<string | null> {
  if (ownerCache && Date.now() - ownerCache.at < TTL_MS) return ownerCache.id;
  const users = container.resolve<IUserModuleService>(Modules.USER);
  // A profile that cannot be read (module not migrated yet, database hiccup)
  // must not lock anyone out: the rule falls back to the oldest admin.
  const named = await explicitOwnerId(container).catch(() => null);
  let id: string | null = null;
  if (named) {
    const [found] = await users.listUsers({ id: named }, { take: 1 });
    id = found?.id ?? null;
  }
  if (!id) {
    const [oldest] = await users.listUsers({}, { take: 1, order: { created_at: "ASC" } });
    id = oldest?.id ?? null;
  }
  ownerCache = { at: Date.now(), id };
  return id;
}

export async function assignmentsByUser(
  container: MedusaContainer,
  userIds: string[]
): Promise<Map<string, AssignmentLike[]>> {
  const out = new Map<string, AssignmentLike[]>(userIds.map((id) => [id, []]));
  if (!userIds.length) return out;
  const staff = container.resolve<StaffModuleService>(STAFF_MODULE);
  const rows = await staff.listStaffAssignments({ user_id: userIds }, { take: 1000 });
  for (const r of rows) {
    out.get(r.user_id)?.push({
      role: r.role,
      establishment_id: r.establishment_id ?? null,
      is_active: Boolean(r.is_active),
      discount_limit_pct: r.discount_limit_pct == null ? null : Number(r.discount_limit_pct),
      can_void: Boolean(r.can_void),
    });
  }
  return out;
}

/**
 * Replaces every assignment of `userId` with `role` over `establishmentIds`
 * (null/empty = all stores). The personal discount limit and void permission
 * carry over. Old rows are soft-deleted, not edited, so each change leaves a
 * trail and the partial unique indexes never see two live rows.
 */
export async function writeStaffAssignment(
  container: MedusaContainer,
  input: { userId: string; role: StaffRole; establishmentIds: string[] | null; actorId: string | null }
): Promise<void> {
  const staff = container.resolve<StaffModuleService>(STAFF_MODULE);
  const current = await staff.listStaffAssignments({ user_id: input.userId }, { take: 1000 });
  const limits = current.map((r) => r.discount_limit_pct).filter((v) => v != null).map(Number);
  const carry = {
    discount_limit_pct: limits.length ? Math.max(...limits) : null,
    can_void: current.some((r) => Boolean(r.can_void)),
  };
  const live = current.filter((r) => r.is_active);
  const beforeRole = live[0]?.role ?? null;
  const beforeStores = live.some((r) => !r.establishment_id) ? null : live.map((r) => r.establishment_id as string).sort();
  if (current.length) await staff.softDeleteStaffAssignments(current.map((r) => r.id));
  await staff.createStaffAssignments(
    assignmentRowsFor(input.role, input.establishmentIds).map((row) => ({
      user_id: input.userId,
      ...row,
      ...carry,
      created_by: input.actorId,
    }))
  );
  invalidateStaffScope(input.userId);
  const afterStores = input.establishmentIds?.length ? [...new Set(input.establishmentIds)].sort() : null;
  await recordAudit(container, {
    actorId: input.actorId,
    action: beforeRole !== input.role ? "role.change" : "stores.change",
    entity: "user",
    entityId: input.userId,
    before: { role: beforeRole, establishment_ids: beforeStores },
    after: { role: input.role, establishment_ids: afterStores },
  });
}

/**
 * Whether the authenticated user still exists. Medusa's `authenticate` only
 * verifies the JWT signature: it never checks that the user row is still there.
 * Without this, a person deleted from Equipo kept a working token until it
 * expired, and — with no assignment rows left, since DELETE soft-deletes them —
 * resolveRole's "no rows = admin from before roles" rule made that ghost a
 * SUPERADMIN. Errors propagate: the guard answers 503 rather than failing open.
 */
async function userExists(container: MedusaContainer, userId: string): Promise<boolean> {
  const users = container.resolve<IUserModuleService>(Modules.USER);
  const rows = await users.listUsers({ id: [userId] }, { take: 1, select: ["id"] });
  return rows.length > 0;
}

/**
 * Also the session revocation of the panel. Medusa's JWTs cannot be revoked
 * server-side without a denylist, so the deleted / deactivated checks here, run
 * on every /admin request, ARE what closes a person's open sessions — within the
 * TTL_MS cache window (invalidateStaffScope() shortens it to zero on a change
 * made from this process). A no-access result is cached for the same 30 s and
 * no longer: a reactivation must take effect just as fast.
 */
export async function getStaffScope(container: MedusaContainer, userId: string): Promise<StaffScope> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.scope;

  const [exists, ownerId, byUser, profiles, access] = await Promise.all([
    userExists(container, userId),
    ownerUserId(container),
    assignmentsByUser(container, [userId]),
    profilesByUser(container, [userId]),
    accessStatusByUser(container, [userId]),
  ]);
  const isOwner = ownerId === userId;
  const disabledAt = access.get(userId)?.disabled_at ?? null;
  // The owner can never be deactivated (statusChangeDenied), so a stray flag on
  // their row is ignored rather than locking the store out of its root admin.
  if (!exists || (disabledAt && !isOwner)) {
    const scope = noAccessScope(userId, exists ? disabledAt : null);
    cache.set(userId, { at: Date.now(), scope });
    return scope;
  }

  const profile = profiles.get(userId);
  const resolved = resolveRole({ isOwner, assignments: byUser.get(userId) ?? [] });
  const seller = resolved.role === "seller" ? await counterSellerFor(container, userId) : null;
  const scope: StaffScope = {
    ...resolved,
    user_id: userId,
    is_owner: isOwner,
    is_admin: isAdminRole(resolved.role),
    privileges: profile?.privileges ?? [],
    // The seller record's code identifies a counter seller when the profile has none.
    seller_code: profile?.seller_code ?? seller?.code ?? null,
    seller,
    disabled_at: null,
  };
  cache.set(userId, { at: Date.now(), scope });
  return scope;
}

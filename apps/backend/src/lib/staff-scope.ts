import type { MedusaContainer } from "@medusajs/framework/types";
import type { IUserModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { STAFF_MODULE } from "../modules/staff";
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
}

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; scope: StaffScope }>();
let ownerCache: { at: number; id: string | null } | null = null;

export function invalidateStaffScope(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
  ownerCache = null;
}

/** The owner = the oldest admin user, the same rule /admin/team uses. */
export async function ownerUserId(container: MedusaContainer): Promise<string | null> {
  if (ownerCache && Date.now() - ownerCache.at < TTL_MS) return ownerCache.id;
  const users = container.resolve<IUserModuleService>(Modules.USER);
  const [oldest] = await users.listUsers({}, { take: 1, order: { created_at: "ASC" } });
  ownerCache = { at: Date.now(), id: oldest?.id ?? null };
  return ownerCache.id;
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
}

export async function getStaffScope(container: MedusaContainer, userId: string): Promise<StaffScope> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.scope;

  const [ownerId, byUser] = await Promise.all([
    ownerUserId(container),
    assignmentsByUser(container, [userId]),
  ]);
  const isOwner = ownerId === userId;
  const resolved = resolveRole({ isOwner, assignments: byUser.get(userId) ?? [] });
  const scope: StaffScope = {
    ...resolved,
    user_id: userId,
    is_owner: isOwner,
    is_admin: isAdminRole(resolved.role),
  };
  cache.set(userId, { at: Date.now(), scope });
  return scope;
}

import type { MedusaContainer } from "@medusajs/framework/types";
import { STAFF_MODULE } from "../modules/staff";
import type StaffModuleService from "../modules/staff/service";
import { EMPTY_PROFILE, PRIVILEGES, type Privilege, type StaffProfileData } from "./staff-profile";

/** Reads and writes of staff profiles (one live row per user). */

const svc = (c: MedusaContainer) => c.resolve<StaffModuleService>(STAFF_MODULE);

function toData(r: Record<string, unknown> | undefined): StaffProfileData {
  if (!r) return { ...EMPTY_PROFILE, privileges: [] };
  const out = { ...EMPTY_PROFILE } as Record<string, unknown>;
  for (const k of Object.keys(EMPTY_PROFILE)) if (r[k] !== undefined && r[k] !== null) out[k] = r[k];
  out.commission_pct = r.commission_pct == null ? null : Number(r.commission_pct);
  out.monthly_goal = r.monthly_goal == null ? null : Number(r.monthly_goal);
  out.privileges = Array.isArray(r.privileges)
    ? (r.privileges as unknown[]).map(String).filter((p): p is Privilege => (PRIVILEGES as readonly string[]).includes(p))
    : [];
  return out as unknown as StaffProfileData;
}

export async function profilesByUser(container: MedusaContainer, userIds: string[]): Promise<Map<string, StaffProfileData>> {
  const out = new Map<string, StaffProfileData>();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return out;
  const rows = await svc(container).listStaffProfiles({ user_id: ids }, { take: 1000 });
  for (const id of ids) out.set(id, toData(rows.find((r) => r.user_id === id) as unknown as Record<string, unknown> | undefined));
  return out;
}

export async function profileOf(container: MedusaContainer, userId: string): Promise<StaffProfileData> {
  return (await profilesByUser(container, [userId])).get(userId) ?? toData(undefined);
}

/**
 * Whether a person was deactivated (HU-04). Kept apart from StaffProfileData on
 * purpose: it is an access flag read by the staff guard, not profile content
 * anyone edits through the profile routes.
 */
export interface StaffAccessStatus {
  /** ISO instant of the deactivation; null = active. */
  disabled_at: string | null;
  /** User id of who deactivated them; null when active. */
  disabled_by: string | null;
  /** ISO instant of the last "log out everywhere" (lib/session-control.ts); tokens issued before it are dead. null = never. */
  sessions_revoked_at: string | null;
}

const ACTIVE: StaffAccessStatus = { disabled_at: null, disabled_by: null, sessions_revoked_at: null };

const isoOf = (v: unknown): string | null => (v ? (v instanceof Date ? v.toISOString() : String(v)) : null);

function toStatus(r: Record<string, unknown> | undefined): StaffAccessStatus {
  if (!r) return ACTIVE;
  const sessions_revoked_at = isoOf(r.sessions_revoked_at);
  if (!r.disabled_at) return { ...ACTIVE, sessions_revoked_at };
  return { disabled_at: isoOf(r.disabled_at), disabled_by: r.disabled_by == null ? null : String(r.disabled_by), sessions_revoked_at };
}

export async function accessStatusByUser(container: MedusaContainer, userIds: string[]): Promise<Map<string, StaffAccessStatus>> {
  const out = new Map<string, StaffAccessStatus>();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return out;
  const rows = await svc(container).listStaffProfiles({ user_id: ids }, { take: 1000 });
  for (const id of ids) out.set(id, toStatus(rows.find((r) => r.user_id === id) as unknown as Record<string, unknown> | undefined));
  return out;
}

/**
 * Deactivates (`disabled` true) or reactivates a person, creating their profile
 * row when they have none yet. Returns the previous and the new status for the
 * audit log. The caller invalidates the scope cache and applies the vetoes
 * (lib/staff-scope.ts statusChangeDenied): this only writes.
 */
export async function setAccessDisabled(
  container: MedusaContainer,
  userId: string,
  disabled: boolean,
  actorId: string | null
): Promise<{ before: StaffAccessStatus; after: StaffAccessStatus }> {
  const s = svc(container);
  const [row] = await s.listStaffProfiles({ user_id: userId }, { take: 1 });
  const before = toStatus(row as unknown as Record<string, unknown> | undefined);
  const after: StaffAccessStatus = disabled
    ? { disabled_at: new Date().toISOString(), disabled_by: actorId, sessions_revoked_at: before.sessions_revoked_at }
    : { ...ACTIVE, sessions_revoked_at: before.sessions_revoked_at };
  const data = { disabled_at: after.disabled_at ? new Date(after.disabled_at) : null, disabled_by: after.disabled_by, updated_by: actorId };
  if (row) await s.updateStaffProfiles({ id: row.id, ...data } as never);
  else await s.createStaffProfiles({ user_id: userId, ...data } as never);
  return { before, after };
}

/**
 * Stamps `sessions_revoked_at = at` on the person's profile row (created when
 * they have none yet). Only writes; lib/session-control.ts decides when and
 * audits, and invalidates the scope cache.
 */
export async function setSessionsRevokedAt(container: MedusaContainer, userId: string, at: Date, actorId: string | null): Promise<void> {
  const s = svc(container);
  const [row] = await s.listStaffProfiles({ user_id: userId }, { take: 1 });
  const data = { sessions_revoked_at: at, updated_by: actorId };
  if (row) await s.updateStaffProfiles({ id: row.id, ...data } as never);
  else await s.createStaffProfiles({ user_id: userId, ...data } as never);
}

/** Seller codes in use by live profiles, except `exceptUserId`'s. */
export async function takenSellerCodes(container: MedusaContainer, exceptUserId?: string): Promise<string[]> {
  const rows = await svc(container).listStaffProfiles({}, { take: 1000 });
  return rows
    .filter((r) => r.user_id !== exceptUserId && r.seller_code)
    .map((r) => String(r.seller_code).toUpperCase());
}

/**
 * Applies a cleaned patch, creating the row on first write. Returns the
 * previous and the new profile, for the audit log. Throws `seller_code_taken`
 * when the code is in use (checked first, and again by the unique index).
 */
export async function saveProfile(
  container: MedusaContainer,
  userId: string,
  patch: Partial<StaffProfileData>,
  actorId: string | null
): Promise<{ before: StaffProfileData; after: StaffProfileData }> {
  const s = svc(container);
  if (patch.seller_code && (await takenSellerCodes(container, userId)).includes(patch.seller_code.toUpperCase())) {
    throw new Error("seller_code_taken");
  }
  const [row] = await s.listStaffProfiles({ user_id: userId }, { take: 1 });
  const before = toData(row as unknown as Record<string, unknown> | undefined);
  const data = { ...patch, updated_by: actorId } as Record<string, unknown>;
  try {
    if (row) await s.updateStaffProfiles({ id: row.id, ...data } as never);
    else await s.createStaffProfiles({ user_id: userId, ...data } as never);
  } catch (e) {
    if (/unique|duplicate/i.test((e as Error).message)) throw new Error("seller_code_taken");
    throw e;
  }
  return { before, after: { ...before, ...patch } };
}

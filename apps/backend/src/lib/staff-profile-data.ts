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

/**
 * Roles of the people who use the panel, and the pure rules around them. No
 * container, no database: src/lib/staff-scope.ts loads the data and
 * src/lib/staff-guard.ts enforces the result on every /admin request.
 *
 * Owner decisions this encodes (docs "Gestión de Tiendas RUBI LENS"):
 *  - owner and superadmin have the same rights: store prices, approving
 *    discounts, configuring alerts. Only the owner names or removes superadmins.
 *  - the owner is the oldest admin user (the one created with `medusa user`
 *    when the store was set up), exactly as /admin/team already defines it.
 *  - admins that existed before roles did keep the access they had: a user with
 *    no assignment rows at all resolves to superadmin. Once someone has rows,
 *    only those rows count, so deactivating every row really removes access.
 */

export const STAFF_ROLES = ["owner", "superadmin", "supervisor", "manager", "seller"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Roles that see and do everything in the admin API. */
export const ADMIN_ROLES: ReadonlySet<StaffRole> = new Set<StaffRole>(["owner", "superadmin"]);

/** Roles that can be given through the panel. "owner" is never assigned. */
export const ASSIGNABLE_ROLES: readonly StaffRole[] = ["superadmin", "supervisor", "manager", "seller"];

const RANK: Record<StaffRole, number> = { owner: 5, superadmin: 4, supervisor: 3, manager: 2, seller: 1 };

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

export function isAdminRole(role: StaffRole | null | undefined): boolean {
  return role != null && ADMIN_ROLES.has(role);
}

export interface AssignmentLike {
  role: string;
  establishment_id: string | null;
  is_active: boolean;
  discount_limit_pct: number | null;
  can_void: boolean;
}

export interface ResolvedRole {
  /** null = the person has assignments but none is active: no access at all. */
  role: StaffRole | null;
  /** null = every establishment. */
  establishment_ids: string[] | null;
  /** Personal override; null = the role's limit (configured in phase 2). */
  discount_limit_pct: number | null;
  can_void: boolean;
  /** True when the role comes from the "existed before roles" rule. */
  legacy: boolean;
}

export function resolveRole(input: { isOwner: boolean; assignments: AssignmentLike[] }): ResolvedRole {
  if (input.isOwner) {
    return { role: "owner", establishment_ids: null, discount_limit_pct: null, can_void: true, legacy: false };
  }
  if (input.assignments.length === 0) {
    return { role: "superadmin", establishment_ids: null, discount_limit_pct: null, can_void: true, legacy: true };
  }
  const active = input.assignments.filter((a) => a.is_active && isStaffRole(a.role) && a.role !== "owner");
  if (active.length === 0) {
    return { role: null, establishment_ids: [], discount_limit_pct: null, can_void: false, legacy: false };
  }
  const role = active.reduce<StaffRole>(
    (best, a) => (RANK[a.role as StaffRole] > RANK[best] ? (a.role as StaffRole) : best),
    active[0].role as StaffRole
  );
  const establishment_ids = active.some((a) => a.establishment_id == null)
    ? null
    : [...new Set(active.map((a) => a.establishment_id as string))].sort();
  const limits = active
    .filter((a) => a.role === role && a.discount_limit_pct != null)
    .map((a) => Number(a.discount_limit_pct));
  return {
    role,
    establishment_ids,
    discount_limit_pct: limits.length ? Math.max(...limits) : null,
    can_void: isAdminRole(role) || active.some((a) => a.can_void),
    legacy: false,
  };
}

/**
 * Why `actorRole` may not give `nextRole` to someone whose current role is
 * `targetRole`; null when it is allowed. Reasons are the codes the panel turns
 * into adm.err.team.<reason>.
 */
export function roleChangeDenied(args: {
  actorRole: StaffRole | null;
  targetIsOwner: boolean;
  targetRole: StaffRole | null;
  nextRole: string;
  actorIsTarget: boolean;
}): string | null {
  if (args.targetIsOwner) return "owner_locked";
  if (!isAdminRole(args.actorRole)) return "forbidden_role";
  if (!isStaffRole(args.nextRole) || !ASSIGNABLE_ROLES.includes(args.nextRole)) return "bad_role";
  if (args.actorIsTarget) return "self_role";
  const touchesSuperadmin = args.nextRole === "superadmin" || args.targetRole === "superadmin";
  if (touchesSuperadmin && args.actorRole !== "owner") return "owner_only";
  return null;
}

/**
 * /admin routes a non-admin role may call. Everything else under /admin is
 * refused for them: Medusa's own admin API (products, orders, customers,
 * settings) would otherwise be fully open to any signed-in user. Phase 2 adds
 * the point-of-sale routes here.
 */
const RESTRICTED_ALLOWED: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: "GET", path: /^\/admin\/me\/scope$/ },
  { method: "GET", path: /^\/admin\/team\/me$/ },
  { method: "POST", path: /^\/admin\/team\/password$/ },
  { method: "GET", path: /^\/admin\/users\/me$/ },
];

export function isAllowedForRestrictedRole(method: string, url: string): boolean {
  const path = url.split("?")[0].replace(/\/+$/, "") || "/";
  const m = method.toUpperCase();
  return RESTRICTED_ALLOWED.some((r) => r.method === m && r.path.test(path));
}

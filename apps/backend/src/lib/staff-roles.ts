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
 * The rows that represent `role` limited to `establishmentIds`. Owner and
 * superadmin always cover every store (one row, no establishment); so does any
 * role with no store list. Otherwise one row per distinct store. Writing a
 * person's rows always goes through this, so role and stores cannot drift.
 */
export function assignmentRowsFor(
  role: StaffRole,
  establishmentIds: string[] | null
): Array<{ role: StaffRole; establishment_id: string | null }> {
  const ids = [...new Set((establishmentIds ?? []).filter(Boolean))].sort();
  if (isAdminRole(role) || ids.length === 0) return [{ role, establishment_id: null }];
  return ids.map((establishment_id) => ({ role, establishment_id }));
}

/**
 * /admin routes a non-admin role may call. Everything else under /admin is
 * refused for them: Medusa's own admin API (products, orders, customers,
 * settings) would otherwise be fully open to any signed-in user.
 *
 * The point-of-sale routes are open to every role, and each of them limits the
 * request to the user's own stores and, where the document's permission matrix
 * says so, to the role (lib/pos-route.ts). Some routes are open to a person
 * only with a privilege the owner granted them (PRIVILEGED_ALLOWED).
 */
const RESTRICTED_ALLOWED: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: "GET", path: /^\/admin\/me\/scope$/ },
  { method: "GET", path: /^\/admin\/team\/me$/ },
  { method: "POST", path: /^\/admin\/team\/password$/ },
  { method: "GET", path: /^\/admin\/users\/me$/ },
  { method: "GET", path: /^\/admin\/team\/me\/profile$/ },
  { method: "POST", path: /^\/admin\/team\/me\/profile$/ },
  { method: "GET", path: /^\/admin\/pos\/(context|products|sales|customers|settings|terminals|discount-approvals|insurance-claims)$/ },
  { method: "POST", path: /^\/admin\/pos\/(quote|sales|discount-approvals|terminals|prescriptions\/ocr)$/ },
  { method: "GET", path: /^\/admin\/pos\/(sales|customers|discount-approvals)\/[^/]+$/ },
  { method: "POST", path: /^\/admin\/pos\/sales\/[^/]+\/(payments|deliver|void|receipt|documents)$/ },
  { method: "GET", path: /^\/admin\/pos\/sales\/[^/]+\/documents$/ },
  { method: "POST", path: /^\/admin\/pos\/terminals\/[^/]+$/ },
  { method: "POST", path: /^\/admin\/pos\/insurance-claims\/[^/]+$/ },
];

/** Routes a non-admin may call only with a privilege granted to them (lib/staff-profile.ts). */
const PRIVILEGED_ALLOWED: ReadonlyArray<{ method: string; path: RegExp; privilege: string }> = [
  { method: "GET", path: /^\/admin\/pos\/payment-methods$/, privilege: "payments.manage" },
  { method: "POST", path: /^\/admin\/pos\/payment-methods(\/[^/]+)?$/, privilege: "payments.manage" },
];

export function isAllowedForRestrictedRole(method: string, url: string, privileges: readonly string[] = []): boolean {
  const path = url.split("?")[0].replace(/\/+$/, "") || "/";
  const m = method.toUpperCase();
  if (RESTRICTED_ALLOWED.some((r) => r.method === m && r.path.test(path))) return true;
  return PRIVILEGED_ALLOWED.some((r) => r.method === m && r.path.test(path) && privileges.includes(r.privilege));
}

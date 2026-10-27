import {
  isAllowedForRestrictedRole,
  resolveRole,
  roleChangeDenied,
  type AssignmentLike,
} from "../src/lib/staff-roles";

const row = (over: Partial<AssignmentLike>): AssignmentLike => ({
  role: "seller",
  establishment_id: null,
  is_active: true,
  discount_limit_pct: null,
  can_void: false,
  ...over,
});

describe("resolveRole", () => {
  it("the owner is owner whatever the rows say", () => {
    expect(resolveRole({ isOwner: true, assignments: [row({ role: "seller", is_active: false })] }).role).toBe("owner");
  });

  it("an admin from before roles existed keeps full access as superadmin", () => {
    const r = resolveRole({ isOwner: false, assignments: [] });
    expect(r).toMatchObject({ role: "superadmin", establishment_ids: null, legacy: true });
  });

  it("someone whose rows are all inactive has no access (not the legacy fallback)", () => {
    const r = resolveRole({ isOwner: false, assignments: [row({ is_active: false })] });
    expect(r.role).toBeNull();
    expect(r.legacy).toBe(false);
  });

  it("takes the highest active role and the stores of its rows", () => {
    const r = resolveRole({
      isOwner: false,
      assignments: [
        row({ role: "seller", establishment_id: "est_2" }),
        row({ role: "manager", establishment_id: "est_1", discount_limit_pct: 15 }),
        row({ role: "supervisor", establishment_id: "est_3", is_active: false }),
      ],
    });
    expect(r.role).toBe("manager");
    expect(r.establishment_ids).toEqual(["est_1", "est_2"]);
    expect(r.discount_limit_pct).toBe(15);
  });

  it("a row with no establishment means every store", () => {
    const r = resolveRole({ isOwner: false, assignments: [row({ establishment_id: null }), row({ establishment_id: "est_1" })] });
    expect(r.establishment_ids).toBeNull();
  });

  it("ignores an 'owner' row: owner only comes from being the oldest user", () => {
    const r = resolveRole({ isOwner: false, assignments: [row({ role: "owner" }), row({ role: "seller" })] });
    expect(r.role).toBe("seller");
  });
});

describe("roleChangeDenied", () => {
  const base = { targetIsOwner: false, targetRole: "seller" as const, actorIsTarget: false };

  it("nobody changes the owner", () => {
    expect(roleChangeDenied({ ...base, actorRole: "owner", targetIsOwner: true, nextRole: "seller" })).toBe("owner_locked");
  });

  it("only owner and superadmin assign roles", () => {
    expect(roleChangeDenied({ ...base, actorRole: "manager", nextRole: "seller" })).toBe("forbidden_role");
  });

  it("only the owner names a superadmin", () => {
    expect(roleChangeDenied({ ...base, actorRole: "superadmin", nextRole: "superadmin" })).toBe("owner_only");
    expect(roleChangeDenied({ ...base, actorRole: "owner", nextRole: "superadmin" })).toBeNull();
  });

  it("only the owner demotes a superadmin", () => {
    expect(roleChangeDenied({ ...base, actorRole: "superadmin", targetRole: "superadmin", nextRole: "seller" })).toBe("owner_only");
  });

  it("a superadmin manages the other roles", () => {
    expect(roleChangeDenied({ ...base, actorRole: "superadmin", nextRole: "manager" })).toBeNull();
  });

  it("rejects unknown roles and 'owner'", () => {
    expect(roleChangeDenied({ ...base, actorRole: "owner", nextRole: "owner" })).toBe("bad_role");
    expect(roleChangeDenied({ ...base, actorRole: "owner", nextRole: "god" })).toBe("bad_role");
  });

  it("nobody changes their own role", () => {
    expect(roleChangeDenied({ ...base, actorRole: "superadmin", actorIsTarget: true, nextRole: "seller" })).toBe("self_role");
  });
});

describe("isAllowedForRestrictedRole", () => {
  it("lets a restricted role ask who it is and change its password", () => {
    expect(isAllowedForRestrictedRole("GET", "/admin/me/scope")).toBe(true);
    expect(isAllowedForRestrictedRole("GET", "/admin/team/me?x=1")).toBe(true);
    expect(isAllowedForRestrictedRole("POST", "/admin/team/password")).toBe(true);
  });

  it("refuses Medusa's own admin API and our admin routes", () => {
    expect(isAllowedForRestrictedRole("GET", "/admin/products")).toBe(false);
    expect(isAllowedForRestrictedRole("GET", "/admin/orders/order_1")).toBe(false);
    expect(isAllowedForRestrictedRole("GET", "/admin/team")).toBe(false);
    expect(isAllowedForRestrictedRole("POST", "/admin/team/me")).toBe(false);
    expect(isAllowedForRestrictedRole("GET", "/admin/me/scope/extra")).toBe(false);
  });
});

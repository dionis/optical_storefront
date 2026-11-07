import { assignmentRowsFor, configuredOwnerEmail, pickOwnerId, isAllowedForInactiveUser, isAllowedForRestrictedRole, resolveRole, roleChangeDenied, type AssignmentLike, passwordResetDenied } from "../src/lib/staff-roles";

const row = (over: Partial<AssignmentLike>): AssignmentLike => ({
  role: "seller",
  establishment_id: null,
  is_active: true,
  discount_limit_pct: null,
  can_void: false,
  ...over,
});

describe("setting someone else's password", () => {
  it("is for the owner and superadmins, over anyone but themselves", () => {
    expect(passwordResetDenied({ actorRole: "superadmin", actorId: "a", targetId: "owner" })).toBeNull();
    expect(passwordResetDenied({ actorRole: "owner", actorId: "a", targetId: "b" })).toBeNull();
    expect(passwordResetDenied({ actorRole: "superadmin", actorId: "a", targetId: "a" })).toBe("self_password");
    for (const actorRole of ["supervisor", "manager", "seller", null] as const) {
      expect(passwordResetDenied({ actorRole, actorId: "a", targetId: "b" })).toBe("forbidden_role");
    }
  });

  it("is out of reach of restricted roles at the guard, while their own stays open", () => {
    expect(isAllowedForRestrictedRole("POST", "/admin/team/user_1/password")).toBe(false);
    expect(isAllowedForRestrictedRole("POST", "/admin/team/password")).toBe(true);
    expect(isAllowedForRestrictedRole("POST", "/admin/team/me/profile")).toBe(true);
  });

  it("frame costs and the price band open only with the cost privileges", () => {
    // Without a privilege the guard refuses, before lib/frame-cost-route.ts runs.
    expect(isAllowedForRestrictedRole("GET", "/admin/pricing/frames/costs")).toBe(false);
    expect(isAllowedForRestrictedRole("GET", "/admin/pricing/frames/band")).toBe(false);
    expect(isAllowedForRestrictedRole("POST", "/admin/pricing/frames/cost", ["costs.view"])).toBe(false);
    // Reading with either privilege, writing only with costs.manage.
    expect(isAllowedForRestrictedRole("GET", "/admin/pricing/frames/costs?store=est_1", ["costs.view"])).toBe(true);
    expect(isAllowedForRestrictedRole("GET", "/admin/pricing/frames/band", ["costs.manage"])).toBe(true);
    expect(isAllowedForRestrictedRole("POST", "/admin/pricing/frames/cost", ["costs.manage"])).toBe(true);
    expect(isAllowedForRestrictedRole("POST", "/admin/pricing/frames/band", ["costs.manage"])).toBe(true);
    // The rest of /admin/pricing stays owner/superadmin only.
    expect(isAllowedForRestrictedRole("POST", "/admin/pricing/frames/override", ["costs.manage"])).toBe(false);
    expect(isAllowedForRestrictedRole("GET", "/admin/pricing/overview", ["costs.manage"])).toBe(false);
  });
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

describe("assignmentRowsFor", () => {
  it("no store list means every store (one row)", () => {
    expect(assignmentRowsFor("seller", null)).toEqual([{ role: "seller", establishment_id: null }]);
    expect(assignmentRowsFor("seller", [])).toEqual([{ role: "seller", establishment_id: null }]);
  });

  it("one row per distinct store", () => {
    expect(assignmentRowsFor("manager", ["est_2", "est_1", "est_2"])).toEqual([
      { role: "manager", establishment_id: "est_1" },
      { role: "manager", establishment_id: "est_2" },
    ]);
  });

  it("superadmin always covers every store, whatever list it is given", () => {
    expect(assignmentRowsFor("superadmin", ["est_1"])).toEqual([{ role: "superadmin", establishment_id: null }]);
  });

  it("round-trips through resolveRole", () => {
    const rows = assignmentRowsFor("seller", ["est_3", "est_1"]).map((r) => ({
      ...r, is_active: true, discount_limit_pct: null, can_void: false,
    }));
    expect(resolveRole({ isOwner: false, assignments: rows })).toMatchObject({ role: "seller", establishment_ids: ["est_1", "est_3"] });
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

  it("lets the board's GETs through (the routes scope them by role) but none of its writes", () => {
    expect(isAllowedForRestrictedRole("GET", "/admin/order-board?view=stages")).toBe(true);
    // The single order: the sale sheet's stage block for a manager (slim, scoped in the route).
    expect(isAllowedForRestrictedRole("GET", "/admin/order-board/order_1")).toBe(true);
    expect(isAllowedForRestrictedRole("POST", "/admin/order-board/order_1/stage")).toBe(false);
    expect(isAllowedForRestrictedRole("POST", "/admin/order-board/order_1/note")).toBe(false);
  });

  it("opens the till but not its settings", () => {
    expect(isAllowedForRestrictedRole("GET", "/admin/pos/context")).toBe(true);
    expect(isAllowedForRestrictedRole("GET", "/admin/pos/products?store=est_1&q=ray")).toBe(true);
    expect(isAllowedForRestrictedRole("POST", "/admin/pos/quote")).toBe(true);
    expect(isAllowedForRestrictedRole("POST", "/admin/pos/sales")).toBe(true);
    // The lens price list the till picks from (every POS role, store prices only).
    expect(isAllowedForRestrictedRole("GET", "/admin/pos/lens-matrix")).toBe(true);
    expect(isAllowedForRestrictedRole("GET", "/admin/pos/lens-matrix?store=est_1")).toBe(true);
    expect(isAllowedForRestrictedRole("GET", "/admin/pos/payment-methods")).toBe(false);
    expect(isAllowedForRestrictedRole("POST", "/admin/pos/payment-methods")).toBe(false);
    expect(isAllowedForRestrictedRole("POST", "/admin/pos/payment-methods/pospm_cash")).toBe(false);
    expect(isAllowedForRestrictedRole("POST", "/admin/pos/sales/poss_1/void")).toBe(true);
    expect(isAllowedForRestrictedRole("POST", "/admin/pos/discount-approvals/posdisc_1/decide")).toBe(false);
    expect(isAllowedForRestrictedRole("POST", "/admin/pos/settings")).toBe(false);
  });

  it("opens payment-method settings to whoever holds the privilege", () => {
    expect(isAllowedForRestrictedRole("POST", "/admin/pos/payment-methods", ["payments.manage"])).toBe(true);
    expect(isAllowedForRestrictedRole("POST", "/admin/pos/payment-methods/pospm_cash", ["payments.manage"])).toBe(true);
    expect(isAllowedForRestrictedRole("POST", "/admin/pos/payment-methods", ["costs.manage"])).toBe(false);
  });
});

describe("isAllowedForInactiveUser", () => {
  it("lets a person without an active role ask who they are and sign out, nothing else", () => {
    expect(isAllowedForInactiveUser("GET", "/admin/team/me")).toBe(true);
    expect(isAllowedForInactiveUser("GET", "/admin/users/me")).toBe(true);
    expect(isAllowedForInactiveUser("DELETE", "/admin/team/me/sessions")).toBe(true);
    expect(isAllowedForInactiveUser("GET", "/admin/pos/context")).toBe(false);
    expect(isAllowedForInactiveUser("POST", "/admin/pos/sales")).toBe(false);
    expect(isAllowedForInactiveUser("GET", "/admin/team/me/profile")).toBe(false);
    expect(isAllowedForInactiveUser("POST", "/admin/team/password")).toBe(false);
  });
});

describe("pickOwnerId", () => {
  const users = [{ id: "u_dev", email: "dev@example.com" }, { id: "u_owner", email: "Owner@Example.com" }];
  it("the oldest user without STORE_OWNER_EMAIL", () => {
    expect(pickOwnerId(users, "")).toBe("u_dev");
    expect(pickOwnerId(users, null)).toBe("u_dev");
  });
  it("the user with STORE_OWNER_EMAIL, whatever the case and spaces", () => {
    expect(pickOwnerId(users, " owner@example.COM ")).toBe("u_owner");
  });
  it("falls back to the oldest when nobody has that email, and null with no users", () => {
    expect(pickOwnerId(users, "nobody@example.com")).toBe("u_dev");
    expect(pickOwnerId([], "owner@example.com")).toBeNull();
  });
  it("reads STORE_OWNER_EMAIL trimmed and lower-cased", () => {
    expect(configuredOwnerEmail({ STORE_OWNER_EMAIL: "  Rubi@Example.com " } as NodeJS.ProcessEnv)).toBe("rubi@example.com");
    expect(configuredOwnerEmail({} as NodeJS.ProcessEnv)).toBe("");
  });
});

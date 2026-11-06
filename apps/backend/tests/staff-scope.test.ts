/**
 * The staff scope is what every /admin request is judged by, so two things
 * must never resolve to an admin: a user that no longer exists (a deleted
 * person's still-valid JWT — with their rows soft-deleted, resolveRole's
 * "no rows = legacy superadmin" rule used to make them a ghost superadmin) and a
 * person deactivated from Equipo (HU-04).
 */
import { getStaffScope, invalidateStaffScope, statusChangeDenied } from "../src/lib/staff-scope";

type Row = Record<string, unknown>;

/** A container whose user, staff and seller modules answer from these lists. */
function containerWith(opts: { users: Row[]; assignments?: Row[]; profiles?: Row[] }) {
  const users = {
    listUsers: jest.fn(async (filter: Row = {}, config: Row = {}) => {
      const ids = filter.id as string[] | undefined;
      const rows = ids ? opts.users.filter((u) => ids.includes(String(u.id))) : [...opts.users];
      const take = typeof config.take === "number" ? config.take : rows.length;
      return rows.slice(0, take);
    }),
  };
  const staff = {
    listStaffAssignments: jest.fn(async (filter: Row) => (opts.assignments ?? []).filter((a) => (filter.user_id as string[]).includes(String(a.user_id)))),
    listStaffProfiles: jest.fn(async (filter: Row) => (opts.profiles ?? []).filter((p) => (filter.user_id as string[]).includes(String(p.user_id)))),
  };
  const seller = { listSellers: jest.fn(async () => []) };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const resolve = jest.fn((key: string) => {
    if (key === "user") return users;
    if (key === "staff") return staff;
    if (key === "seller") return seller;
    return logger;
  });
  return { container: { resolve } as never, users, staff };
}

const OWNER = { id: "u_owner", email: "owner@x.co", created_at: "2026-01-01T00:00:00.000Z" };
const PERSON = { id: "u_ana", email: "ana@x.co", created_at: "2026-02-01T00:00:00.000Z" };
const manager = (user_id: string): Row => ({ user_id, role: "manager", establishment_id: "est_1", is_active: true, discount_limit_pct: null, can_void: false });

beforeEach(() => invalidateStaffScope());

describe("getStaffScope", () => {
  it("resolves an existing person from their rows", async () => {
    const { container } = containerWith({ users: [OWNER, PERSON], assignments: [manager("u_ana")] });
    const scope = await getStaffScope(container, "u_ana");
    expect(scope).toMatchObject({ role: "manager", is_admin: false, is_owner: false, establishment_ids: ["est_1"], disabled_at: null });
  });

  it("gives a deleted user no access even though they have no rows left", async () => {
    // Only the owner remains; "u_gone" still holds a signed token.
    const { container, users } = containerWith({ users: [OWNER], assignments: [] });
    const scope = await getStaffScope(container, "u_gone");
    expect(scope).toMatchObject({ role: null, is_admin: false, is_owner: false, establishment_ids: [], privileges: [], seller: null });
    expect(scope.legacy).toBe(false);
    expect(users.listUsers).toHaveBeenCalledWith({ id: ["u_gone"] }, expect.objectContaining({ take: 1 }));
  });

  it("still treats an existing admin without rows as the legacy superadmin", async () => {
    const { container } = containerWith({ users: [OWNER, PERSON], assignments: [] });
    const scope = await getStaffScope(container, "u_ana");
    expect(scope).toMatchObject({ role: "superadmin", legacy: true, is_admin: true });
  });

  it("gives a deactivated person no access regardless of their rows", async () => {
    const { container } = containerWith({
      users: [OWNER, PERSON],
      assignments: [manager("u_ana")],
      profiles: [{ user_id: "u_ana", privileges: ["costs.view"], disabled_at: new Date("2026-11-05T10:00:00.000Z"), disabled_by: "u_owner" }],
    });
    const scope = await getStaffScope(container, "u_ana");
    expect(scope).toMatchObject({ role: null, is_admin: false, establishment_ids: [], privileges: [], disabled_at: "2026-11-05T10:00:00.000Z" });
  });

  it("never locks the owner out through the flag", async () => {
    const { container } = containerWith({ users: [OWNER, PERSON], profiles: [{ user_id: "u_owner", disabled_at: new Date() }] });
    const scope = await getStaffScope(container, "u_owner");
    expect(scope).toMatchObject({ role: "owner", is_owner: true, is_admin: true, disabled_at: null });
  });

  it("caches a no-access answer only until the cache is invalidated", async () => {
    const profiles: Row[] = [{ user_id: "u_ana", disabled_at: new Date() }];
    const { container } = containerWith({ users: [OWNER, PERSON], assignments: [manager("u_ana")], profiles });
    expect((await getStaffScope(container, "u_ana")).role).toBeNull();
    profiles.length = 0;
    // Same 30 s window as any other scope: the cached refusal is served…
    expect((await getStaffScope(container, "u_ana")).role).toBeNull();
    // …until the status route invalidates the person, after which the rows count again.
    invalidateStaffScope("u_ana");
    expect((await getStaffScope(container, "u_ana")).role).toBe("manager");
  });

  it("propagates a user-module failure instead of failing open or closed", async () => {
    const { container, users } = containerWith({ users: [OWNER, PERSON] });
    users.listUsers.mockRejectedValueOnce(new Error("db down"));
    await expect(getStaffScope(container, "u_ana")).rejects.toThrow("db down");
  });
});

describe("statusChangeDenied", () => {
  const base = { actorRole: "superadmin" as const, targetIsOwner: false, targetRole: "manager" as const, actorIsTarget: false };

  it("lets owner and superadmin deactivate or reactivate the rest of the team", () => {
    expect(statusChangeDenied(base)).toBeNull();
    expect(statusChangeDenied({ ...base, actorRole: "owner", targetRole: "seller" })).toBeNull();
    expect(statusChangeDenied({ ...base, actorRole: "owner", targetRole: null })).toBeNull();
  });

  it("never touches the owner, whoever asks", () => {
    expect(statusChangeDenied({ ...base, actorRole: "owner", targetIsOwner: true, targetRole: "owner" })).toBe("super_admin");
    expect(statusChangeDenied({ ...base, targetIsOwner: true, targetRole: "owner" })).toBe("super_admin");
  });

  it("refuses non-admin roles before anything else", () => {
    expect(statusChangeDenied({ ...base, actorRole: "supervisor" })).toBe("forbidden_role");
    expect(statusChangeDenied({ ...base, actorRole: "manager", actorIsTarget: true })).toBe("forbidden_role");
    expect(statusChangeDenied({ ...base, actorRole: null })).toBe("forbidden_role");
  });

  it("nobody deactivates themselves", () => {
    expect(statusChangeDenied({ ...base, actorIsTarget: true })).toBe("self");
    expect(statusChangeDenied({ ...base, actorRole: "owner", actorIsTarget: true })).toBe("self");
  });

  it("only the owner switches a superadmin off or back on", () => {
    expect(statusChangeDenied({ ...base, targetRole: "superadmin" })).toBe("owner_only");
    expect(statusChangeDenied({ ...base, actorRole: "owner", targetRole: "superadmin" })).toBeNull();
  });
});

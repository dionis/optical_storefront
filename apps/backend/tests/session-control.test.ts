/**
 * Session revocation (lib/session-control.ts): the decision is pure — a token
 * dated by its `iat` against the person's `sessions_revoked_at` — and the
 * writer stamps the profile row, clears the scope cache and audits.
 */
import { revokeSessions, revokeSessionsAfterPasswordRecovery, sessionRevoked, tokenIssuedAtMs } from "../src/lib/session-control";
import { recordAudit } from "../src/lib/audit";
import { getStaffScope, invalidateStaffScope } from "../src/lib/staff-scope";

jest.mock("../src/lib/audit", () => ({ recordAudit: jest.fn(async () => undefined) }));

const jwt = (payload: Record<string, unknown>): string =>
  ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");

beforeEach(() => {
  jest.clearAllMocks();
  invalidateStaffScope();
});

describe("the token's issue time", () => {
  it("comes from the verified payload Medusa left on auth_context, in ms", () => {
    expect(tokenIssuedAtMs({ iat: 1_762_300_000 })).toBe(1_762_300_000_000);
    // auth_context wins over the header when both are there.
    expect(tokenIssuedAtMs({ iat: 1_762_300_000 }, `Bearer ${jwt({ iat: 1 })}`)).toBe(1_762_300_000_000);
  });
  it("falls back to decoding the bearer token", () => {
    expect(tokenIssuedAtMs({}, `Bearer ${jwt({ iat: 1_762_300_000, actor_id: "u1" })}`)).toBe(1_762_300_000_000);
    expect(tokenIssuedAtMs(null, `bearer ${jwt({ iat: 7 })}`)).toBe(7_000);
  });
  it("is null when the token cannot be dated", () => {
    expect(tokenIssuedAtMs(undefined, undefined)).toBeNull();
    expect(tokenIssuedAtMs({}, "Basic abc")).toBeNull();
    expect(tokenIssuedAtMs({ iat: "soon" }, `Bearer ${jwt({ actor_id: "u1" })}`)).toBeNull();
    expect(tokenIssuedAtMs({}, "Bearer not.a.jwt")).toBeNull();
    expect(tokenIssuedAtMs({}, "Bearer ab.$$$.c")).toBeNull();
  });
});

describe("whether a token is refused", () => {
  const revokedAt = "2026-11-05T03:00:00.000Z";
  const T = Date.parse(revokedAt);

  it("a token older than the revocation is dead; a newer one lives", () => {
    expect(sessionRevoked(revokedAt, T - 1_000)).toBe(true);
    expect(sessionRevoked(revokedAt, T + 1_000)).toBe(false);
  });

  it("a token issued in the same second as the revocation survives (the one the password change just minted)", () => {
    expect(sessionRevoked(revokedAt, T + 400)).toBe(false);
    expect(sessionRevoked(revokedAt, T)).toBe(false);
    expect(sessionRevoked("2026-11-05T03:00:00.700Z", T + 200)).toBe(false);
    expect(sessionRevoked("2026-11-05T03:00:01.000Z", T + 200)).toBe(true);
  });

  it("without a mark, a datable token or a parsable mark, nothing is refused", () => {
    expect(sessionRevoked(null, T - 10_000)).toBe(false);
    expect(sessionRevoked(undefined, T - 10_000)).toBe(false);
    expect(sessionRevoked(revokedAt, null)).toBe(false);
    expect(sessionRevoked("garbage", T - 10_000)).toBe(false);
  });
});

type Row = Record<string, unknown>;

/** A container whose user and staff modules answer from these lists; profiles are written in place. */
function containerWith(opts: { users: Row[]; profiles: Row[] }) {
  const users = {
    listUsers: jest.fn(async (filter: Row = {}, config: Row = {}) => {
      const ids = filter.id as string[] | undefined;
      const email = filter.email as string | undefined;
      let rows = [...opts.users];
      if (ids) rows = rows.filter((u) => ids.includes(String(u.id)));
      if (email) rows = rows.filter((u) => u.email === email);
      const take = typeof config.take === "number" ? config.take : rows.length;
      return rows.slice(0, take);
    }),
  };
  const staff = {
    listStaffAssignments: jest.fn(async () => []),
    listStaffProfiles: jest.fn(async (filter: Row) => opts.profiles.filter((p) => (filter.user_id as string[]).includes(String(p.user_id)))),
    updateStaffProfiles: jest.fn(async (patch: Row) => {
      const row = opts.profiles.find((p) => p.id === patch.id);
      if (row) Object.assign(row, patch);
    }),
    createStaffProfiles: jest.fn(async (row: Row) => {
      opts.profiles.push({ id: `prof_${opts.profiles.length + 1}`, ...row });
    }),
  };
  const seller = { listSellers: jest.fn(async () => []) };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const resolve = jest.fn((key: string) => {
    if (key === "user") return users;
    if (key === "staff") return staff;
    if (key === "seller") return seller;
    return logger;
  });
  return { container: { resolve } as never, users, staff, logger };
}

const OWNER = { id: "u_owner", email: "owner@x.co", created_at: "2026-01-01T00:00:00.000Z" };
const PERSON = { id: "u_ana", email: "ana@x.co", created_at: "2026-02-01T00:00:00.000Z" };

describe("revokeSessions", () => {
  it("stamps the profile row, invalidates the scope and audits session.revoke with the reason", async () => {
    const profiles: Row[] = [{ id: "prof_1", user_id: "u_ana", privileges: [] }];
    const { container, staff } = containerWith({ users: [OWNER, PERSON], profiles });
    expect((await getStaffScope(container, "u_ana")).sessions_revoked_at).toBeNull();

    const at = await revokeSessions(container, { userId: "u_ana", actorId: "u_owner", reason: "remote_logout" });

    expect(staff.updateStaffProfiles).toHaveBeenCalledWith({ id: "prof_1", sessions_revoked_at: new Date(at), updated_by: "u_owner" });
    expect(recordAudit).toHaveBeenCalledWith(container, expect.objectContaining({ action: "session.revoke", actorId: "u_owner", entityId: "u_ana", after: { reason: "remote_logout", sessions_revoked_at: at } }));
    // The cache was cleared: the next scope carries the mark (within the 30 s window otherwise).
    expect((await getStaffScope(container, "u_ana")).sessions_revoked_at).toBe(at);
  });

  it("creates the profile row for a person who had none, and a deactivated person keeps the mark", async () => {
    const profiles: Row[] = [];
    const { container, staff } = containerWith({ users: [OWNER, PERSON], profiles });
    const at = await revokeSessions(container, { userId: "u_ana", actorId: null, reason: "password_changed" });
    expect(staff.createStaffProfiles).toHaveBeenCalledWith({ user_id: "u_ana", sessions_revoked_at: new Date(at), updated_by: null });
    profiles[0].disabled_at = new Date("2026-11-06T00:00:00.000Z");
    invalidateStaffScope("u_ana");
    expect(await getStaffScope(container, "u_ana")).toMatchObject({ role: null, disabled_at: "2026-11-06T00:00:00.000Z", sessions_revoked_at: at });
  });
});

describe("revokeSessionsAfterPasswordRecovery", () => {
  function run(status: number, body: Row, users: Row[]) {
    const profiles: Row[] = [];
    const ctx = containerWith({ users, profiles });
    const listeners: Record<string, () => void> = {};
    const res = { statusCode: status, on: (ev: string, fn: () => void) => { listeners[ev] = fn; } };
    const next = jest.fn();
    revokeSessionsAfterPasswordRecovery({ scope: ctx.container, body } as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    listeners.finish();
    return { ...ctx, profiles };
  }

  it("signs the person's previous sessions out once the new password is set", async () => {
    const { staff } = run(200, { email: "ana@x.co", password: "new-secret-1" }, [OWNER, PERSON]);
    await new Promise((r) => setImmediate(r));
    expect(staff.createStaffProfiles).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u_ana", sessions_revoked_at: expect.any(Date) }));
    expect(recordAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "session.revoke", after: expect.objectContaining({ reason: "password_recovered" }) }));
  });

  it("does nothing on a refused token or an unknown address", async () => {
    const a = run(401, { email: "ana@x.co" }, [OWNER, PERSON]);
    const b = run(200, { email: "nobody@x.co" }, [OWNER, PERSON]);
    await new Promise((r) => setImmediate(r));
    expect(a.staff.createStaffProfiles).not.toHaveBeenCalled();
    expect(b.staff.createStaffProfiles).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

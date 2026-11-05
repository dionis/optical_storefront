/**
 * The staff guard (lib/staff-guard.ts) with the scope stubbed: a revoked
 * session is refused before any role check, admins included; everything else
 * keeps the role rules.
 */
import { staffGuard } from "../src/lib/staff-guard";
import { getStaffScope, type StaffScope } from "../src/lib/staff-scope";

jest.mock("../src/lib/staff-scope", () => ({ getStaffScope: jest.fn() }));

const scopeOf = (over: Partial<StaffScope>): StaffScope => ({
  role: "owner",
  establishment_ids: [],
  discount_limit_pct: null,
  can_void: true,
  legacy: false,
  user_id: "u_owner",
  is_owner: true,
  is_admin: true,
  privileges: [],
  seller_code: null,
  seller: null,
  disabled_at: null,
  sessions_revoked_at: null,
  ...over,
});

function request(over: { iat?: number; method?: string; url?: string; actor?: string | null } = {}) {
  const ctx = over.actor === null ? undefined : { actor_id: over.actor ?? "u_owner", actor_type: "user", ...(over.iat !== undefined ? { iat: over.iat } : {}) };
  const req = {
    auth_context: ctx,
    method: over.method ?? "GET",
    originalUrl: over.url ?? "/admin/products",
    url: over.url ?? "/admin/products",
    get: () => undefined,
    scope: { resolve: () => ({ error: jest.fn() }) },
  };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const next = jest.fn();
  return { req, res, next };
}

const REVOKED = "2026-11-05T12:00:00.000Z";
const T = Math.floor(Date.parse(REVOKED) / 1000);

beforeEach(() => jest.clearAllMocks());

describe("staffGuard and revoked sessions", () => {
  it("refuses a token issued before the revocation with 401 session_revoked, even for the owner", async () => {
    (getStaffScope as jest.Mock).mockResolvedValue(scopeOf({ sessions_revoked_at: REVOKED }));
    const { req, res, next } = request({ iat: T - 60 });
    await staffGuard(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reason: "session_revoked" }));
  });

  it("lets a token issued after (or in the same second as) the revocation through", async () => {
    (getStaffScope as jest.Mock).mockResolvedValue(scopeOf({ sessions_revoked_at: REVOKED }));
    for (const iat of [T, T + 5]) {
      const { req, res, next } = request({ iat });
      await staffGuard(req as never, res as never, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it("a token without iat is not subject to revocation; a person never revoked passes as before", async () => {
    (getStaffScope as jest.Mock).mockResolvedValue(scopeOf({ sessions_revoked_at: REVOKED }));
    const a = request({});
    await staffGuard(a.req as never, a.res as never, a.next);
    expect(a.next).toHaveBeenCalled();
    (getStaffScope as jest.Mock).mockResolvedValue(scopeOf({}));
    const b = request({ iat: T - 60 });
    await staffGuard(b.req as never, b.res as never, b.next);
    expect(b.next).toHaveBeenCalled();
  });

  it("the revocation check comes before the role check: a revoked seller is 401, an active one 403 off its allowlist", async () => {
    (getStaffScope as jest.Mock).mockResolvedValue(scopeOf({ role: "seller", is_owner: false, is_admin: false, sessions_revoked_at: REVOKED }));
    const a = request({ iat: T - 1, url: "/admin/products" });
    await staffGuard(a.req as never, a.res as never, a.next);
    expect(a.res.status).toHaveBeenCalledWith(401);
    (getStaffScope as jest.Mock).mockResolvedValue(scopeOf({ role: "seller", is_owner: false, is_admin: false }));
    const b = request({ iat: T - 1, url: "/admin/products" });
    await staffGuard(b.req as never, b.res as never, b.next);
    expect(b.res.status).toHaveBeenCalledWith(403);
    expect(b.res.json).toHaveBeenCalledWith(expect.objectContaining({ reason: "forbidden_role" }));
    // "Log out everywhere" itself is on every role's allowlist.
    const c = request({ iat: T + 1, method: "DELETE", url: "/admin/team/me/sessions" });
    await staffGuard(c.req as never, c.res as never, c.next);
    expect(c.next).toHaveBeenCalled();
  });

  it("requests without a user are left to Medusa", async () => {
    const { req, res, next } = request({ actor: null });
    await staffGuard(req as never, res as never, next);
    expect(next).toHaveBeenCalled();
    expect(getStaffScope).not.toHaveBeenCalled();
  });
});

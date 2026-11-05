import { sessionControlFrom, sessionRejected, tokenIssuedAt } from "../src/lib/session-control";

const jwt = (payload: Record<string, unknown>): string =>
  ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");

describe("reading the marks from user metadata", () => {
  it("tolerates missing, null and malformed values", () => {
    expect(sessionControlFrom(null)).toEqual({ sessions_revoked_at: null, disabled_at: null });
    expect(sessionControlFrom({ sessions_revoked_at: "garbage", disabled_at: 12 })).toEqual({ sessions_revoked_at: null, disabled_at: null });
    expect(sessionControlFrom({ sessions_revoked_at: "2026-11-05T03:00:00.000Z" }).sessions_revoked_at).toBe("2026-11-05T03:00:00.000Z");
  });
});

describe("the token's issue time", () => {
  it("comes from the bearer JWT's iat, in ms", () => {
    expect(tokenIssuedAt(`Bearer ${jwt({ iat: 1_762_300_000, actor_id: "u1" })}`)).toBe(1_762_300_000_000);
  });
  it("is null without a bearer token or without iat", () => {
    expect(tokenIssuedAt(undefined)).toBeNull();
    expect(tokenIssuedAt("Basic abc")).toBeNull();
    expect(tokenIssuedAt(`Bearer ${jwt({ actor_id: "u1" })}`)).toBeNull();
    expect(tokenIssuedAt("Bearer not.a.jwt")).toBeNull();
  });
});

describe("whether a request is refused", () => {
  const revokedAt = "2026-11-05T03:00:00.000Z";
  const T = Date.parse(revokedAt);

  it("a deactivated account loses whatever the token", () => {
    expect(sessionRejected({ disabled_at: "2026-11-01T00:00:00Z", sessions_revoked_at: null }, T + 60_000)).toBe("disabled");
    expect(sessionRejected({ disabled_at: "2026-11-01T00:00:00Z", sessions_revoked_at: null }, null)).toBe("disabled");
  });

  it("a token older than the revocation is dead; a newer one lives", () => {
    const ctrl = { disabled_at: null, sessions_revoked_at: revokedAt };
    expect(sessionRejected(ctrl, T - 1_000)).toBe("session_revoked");
    expect(sessionRejected(ctrl, T + 1_000)).toBeNull();
  });

  it("a token issued in the same second as the revocation survives (the one the password change just minted)", () => {
    expect(sessionRejected({ disabled_at: null, sessions_revoked_at: revokedAt }, T + 400)).toBeNull();
    expect(sessionRejected({ disabled_at: null, sessions_revoked_at: revokedAt }, T)).toBeNull();
  });

  it("without marks, or without a datable token, nothing is refused", () => {
    expect(sessionRejected({ disabled_at: null, sessions_revoked_at: null }, T - 10_000)).toBeNull();
    expect(sessionRejected({ disabled_at: null, sessions_revoked_at: revokedAt }, null)).toBeNull();
  });
});

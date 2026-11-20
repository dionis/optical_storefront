/**
 * Session revocation for panel users: "log out everywhere", a remote sign-out
 * from Equipo, and every password change.
 *
 * Medusa signs stateless JWTs, so a token stays valid until it expires even
 * after the password changed or the owner wanted the person out. Deleting or
 * deactivating a person already closes their sessions (lib/staff-scope.ts
 * resolves them to no access on every request); this closes them for someone
 * who KEEPS their account: `staff_profile.sessions_revoked_at` is stamped, and
 * the staff guard refuses with 401 `session_revoked` any token issued before
 * it (its `iat`). The person simply signs in again and gets a newer token.
 *
 * The decision (`sessionRevoked`, `tokenIssuedAtMs`) is pure and tested without
 * a database; `revokeSessions` is the only writer.
 */
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IUserModuleService, Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { recordAudit } from "./audit";
import { setSessionsRevokedAt } from "./staff-profile-data";
import { invalidateStaffScope } from "./staff-scope";

export type RevokeReason = "password_changed" | "password_reset" | "password_recovered" | "remote_logout" | "self_logout";

/**
 * Issue time of the request's token, in ms. Medusa's `authenticate` puts the
 * VERIFIED JWT payload on `req.auth_context` (bearer tokens and the session
 * cookie alike), so `iat` is read from there; the bearer header is decoded
 * (not verified — Medusa already did) only as a fallback for a context that
 * lost it. Null when the token cannot be dated (API keys, no `iat`): those are
 * not subject to revocation.
 */
export function tokenIssuedAtMs(authContext: { iat?: unknown } | null | undefined, authorization?: string | null): number | null {
  const fromContext = authContext?.iat;
  if (typeof fromContext === "number" && Number.isFinite(fromContext)) return fromContext * 1000;
  if (!authorization) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!m) return null;
  const parts = m[1].split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { iat?: unknown };
    return typeof payload.iat === "number" && Number.isFinite(payload.iat) ? payload.iat * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Whether a token predates the person's last revocation. `iat` has second
 * precision, so a token issued in the SAME second as the revocation survives:
 * that is the one the panel mints right after a password change (it signs in
 * again with the new password), and a strictly older one is what dies.
 */
export function sessionRevoked(sessionsRevokedAt: string | null | undefined, tokenIatMs: number | null): boolean {
  if (!sessionsRevokedAt || tokenIatMs === null) return false;
  const revokedMs = Date.parse(sessionsRevokedAt);
  if (!Number.isFinite(revokedMs)) return false;
  return Math.floor(tokenIatMs / 1000) < Math.floor(revokedMs / 1000);
}

/**
 * Signs a person out of every device: tokens issued before now stop working on
 * their next request (the 30 s scope cache is cleared for them here). Audited
 * as `session.revoke` with the reason; never the token.
 */
export async function revokeSessions(
  container: MedusaContainer,
  args: { userId: string; actorId: string | null; reason: RevokeReason; at?: Date }
): Promise<string> {
  const at = args.at ?? new Date();
  await setSessionsRevokedAt(container, args.userId, at, args.actorId);
  invalidateStaffScope(args.userId);
  await recordAudit(container, {
    actorId: args.actorId,
    action: "session.revoke",
    entity: "user",
    entityId: args.userId,
    after: { reason: args.reason, sessions_revoked_at: at.toISOString() },
  });
  return at.toISOString();
}

/**
 * After a successful password recovery (Medusa's `POST
 * /auth/user/emailpass/update`, bearer = the e-mailed token), the sessions the
 * person had before are signed out too — a stolen session is one of the
 * reasons to recover a password. Medusa's route emits no event, so this runs
 * when its response finishes with 200. The panel signs in with the new
 * password right after (adminApi.js completePasswordReset), and that token is
 * newer than the mark. Best-effort: a failure is logged, the password change
 * already happened. Three arguments on purpose (tests/middleware-arity.test.ts).
 */
export function revokeSessionsAfterPasswordRecovery(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void {
  const container = req.scope;
  const email = String((req.body as { email?: unknown } | undefined)?.email ?? (req as { auth_context?: { actor_id?: unknown } }).auth_context?.actor_id ?? "").trim();
  res.on("finish", () => {
    if (res.statusCode !== 200 || !email) return;
    // Stamped with the instant the response left, before any lookup: the
    // token the panel obtains next can only be the same second or later.
    const at = new Date();
    void (async () => {
      const users = container.resolve<IUserModuleService>(Modules.USER);
      const [u] = await users.listUsers({ email }, { take: 1, select: ["id"] });
      if (!u) return;
      await revokeSessions(container, { userId: u.id, actorId: null, reason: "password_recovered", at });
    })().catch((e: Error) => {
      container.resolve<Logger>(ContainerRegistrationKeys.LOGGER).warn(`[session-control] sessions not revoked after password recovery: ${e.message}`);
    });
  });
  next();
}

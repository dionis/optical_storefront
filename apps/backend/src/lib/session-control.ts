/**
 * Session control for panel users (M3 of the store-management plan): remote
 * logout, "log out everywhere" after a password change, and deactivating a
 * person without deleting them.
 *
 * Medusa signs stateless JWTs, so a token stays valid until it expires even
 * after its password changed or the person left. Two timestamps on the user's
 * metadata close that gap, and the staff guard checks them on every /admin
 * request:
 *
 *   · `sessions_revoked_at` — tokens issued (`iat`) before it are refused with
 *     401 `session_revoked`; the person simply signs in again.
 *   · `disabled_at` — every request is refused with 403 `disabled`, whatever
 *     the token. The user, their sales, roles and audit trail stay; only the
 *     door closes. Clearing it reopens it (no re-registration, same id).
 *
 * Pure decisions live in `sessionRejected` and `tokenIssuedAt` so they are
 * unit-tested without a database; the two writers below are the only I/O.
 */
import type { IUserModuleService, MedusaContainer } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { recordAudit } from "./audit";
import { invalidateStaffScope } from "./staff-scope";

export interface SessionControl {
  /** ISO instant; tokens issued before it are dead. Null = never revoked. */
  sessions_revoked_at: string | null;
  /** ISO instant the account was deactivated; null = active. */
  disabled_at: string | null;
}

export type SessionRejection = "disabled" | "session_revoked" | null;

/** Reads both marks from a user's metadata (missing or malformed = none). */
export function sessionControlFrom(metadata: Record<string, unknown> | null | undefined): SessionControl {
  const iso = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);
  return {
    sessions_revoked_at: iso(metadata?.["sessions_revoked_at"]),
    disabled_at: iso(metadata?.["disabled_at"]),
  };
}

/**
 * Issue time of the bearer token, in ms, read from the JWT payload. Medusa has
 * already verified the signature before any user middleware runs, so decoding
 * (not verifying) is enough here. Null when there is no bearer token or no
 * `iat` (cookie sessions, API keys): those are not subject to revocation.
 */
export function tokenIssuedAt(authorization: string | undefined | null): number | null {
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
 * Whether a request must be refused. A disabled account loses regardless of the
 * token; a revoked session only when the token predates the revocation. A
 * token without `iat` cannot be dated, so revocation does not apply to it.
 */
export function sessionRejected(ctrl: SessionControl, tokenIatMs: number | null): SessionRejection {
  if (ctrl.disabled_at) return "disabled";
  if (ctrl.sessions_revoked_at && tokenIatMs !== null) {
    // Same-second issue and revocation: the token issued *by* the password
    // change (or right after it) must survive, so only strictly older dies.
    const revokedSecond = Math.floor(Date.parse(ctrl.sessions_revoked_at) / 1000);
    if (Math.floor(tokenIatMs / 1000) < revokedSecond) return "session_revoked";
  }
  return null;
}

async function patchUserMetadata(container: MedusaContainer, userId: string, patch: Record<string, unknown>): Promise<void> {
  const users = container.resolve<IUserModuleService>(Modules.USER);
  const user = await users.retrieveUser(userId, { select: ["id", "metadata"] });
  await users.updateUsers({ id: userId, metadata: { ...((user.metadata as Record<string, unknown>) ?? {}), ...patch } });
  invalidateStaffScope(userId);
}

/**
 * Logs a person out of every device: tokens issued before now stop working on
 * the next request. Used after any password change and by the owner's "cerrar
 * sesión en todos los equipos". `reason` is for the audit trail only.
 */
export async function revokeSessions(
  container: MedusaContainer,
  args: { userId: string; actorId: string | null; reason: "password_changed" | "password_reset" | "remote_logout" | "disabled" }
): Promise<string> {
  const at = new Date().toISOString();
  await patchUserMetadata(container, args.userId, { sessions_revoked_at: at });
  await recordAudit(container, { actorId: args.actorId, action: "session.revoke", entity: "user", entityId: args.userId, after: { reason: args.reason } });
  return at;
}

/**
 * Deactivates (or reactivates) a panel user without deleting anything. A
 * deactivated person cannot use the panel at all; their rows, sales and audit
 * entries remain, and their email is not freed for a new account (that is what
 * DELETE is for).
 */
export async function setUserDisabled(
  container: MedusaContainer,
  args: { userId: string; disabled: boolean; actorId: string | null }
): Promise<SessionControl> {
  const at = args.disabled ? new Date().toISOString() : null;
  await patchUserMetadata(container, args.userId, { disabled_at: at, ...(args.disabled ? { sessions_revoked_at: at } : {}) });
  await recordAudit(container, {
    actorId: args.actorId,
    action: args.disabled ? "user.disable" : "user.enable",
    entity: "user",
    entityId: args.userId,
  });
  const users = container.resolve<IUserModuleService>(Modules.USER);
  const user = await users.retrieveUser(args.userId, { select: ["id", "metadata"] });
  return sessionControlFrom(user.metadata as Record<string, unknown>);
}

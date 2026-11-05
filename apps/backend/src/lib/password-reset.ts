import type { IUserModuleService, Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { recordAudit } from "./audit";
import { renderPasswordResetEmail } from "./email/password-reset-email";
import { resolveEmailLocale, type EmailLocale } from "./email/copy";
import { accessStatusByUser } from "./staff-profile-data";
import { tenant } from "./tenant";
import type { RenderedEmail } from "./email/order-confirmation";

/**
 * Self-service password recovery for the panel (HU-03).
 *
 * Medusa does the hard part: `POST /auth/user/emailpass/reset-password` issues
 * a single-use token (hash stored in its own table, 15 minutes, a new request
 * invalidates the previous one) and emits `auth.password_reset`; `POST
 * /auth/user/emailpass/update` with that token as bearer sets the password.
 * What Medusa does NOT do is send the mail — that is this module, wired from
 * `subscribers/auth-password-reset.ts`. Everything here is injectable so the
 * decision (who gets a link, who does not) is tested without a container.
 */

/**
 * Token lifetime. Fixed inside Medusa's generate-reset-password-token
 * workflow (`RESET_PASSWORD_TOKEN_TTL_SECONDS = 15 * 60`, not exported), so the
 * copy states it here. Check that constant when upgrading @medusajs/core-flows.
 */
export const RESET_TOKEN_TTL_MINUTES = 15;

/** Payload of Medusa's `auth.password_reset` event. */
export interface PasswordResetEvent {
  entity_id: string;
  actor_type: string;
  token: string;
  metadata?: Record<string, unknown>;
}

export interface ResetUser {
  id: string;
  email: string;
}

/** The panel's "new password" form reads `reset` and `email` from the query. */
export function buildResetLink(origin: string, token: string, email: string): string {
  const base = origin.trim().replace(/\/+$/, "");
  return `${base}/admin?reset=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
}

export type ResetDecision =
  | { send: false; reason: "not_user" | "no_user" | "disabled"; user: ResetUser | null }
  | { send: true; to: string; user: ResetUser };

/**
 * Who gets the link. Only panel users (`actor_type: "user"`) that exist and
 * are active: a deactivated person (HU-04, `staff_profile.disabled_at`) must
 * not be able to let themselves back in with a password nobody gave them.
 * For emailpass the event's `entity_id` IS the login email (the auth
 * identity's identifier), so that is the address the mail goes to.
 */
export function decideResetRecipient(input: {
  actorType: string;
  user: ResetUser | null;
  disabledAt: string | null;
}): ResetDecision {
  if (input.actorType !== "user") return { send: false, reason: "not_user", user: null };
  if (!input.user) return { send: false, reason: "no_user", user: null };
  if (input.disabledAt) return { send: false, reason: "disabled", user: input.user };
  return { send: true, to: input.user.email, user: input.user };
}

export interface PasswordResetDeps {
  /** Panel user by login email; null when none. */
  findUserByEmail(email: string): Promise<ResetUser | null>;
  /** ISO instant of the deactivation, null when active. */
  disabledAt(userId: string): Promise<string | null>;
  send(to: string, email: RenderedEmail, userId: string): Promise<void>;
  /** Audit `password.reset_requested` — never with the token. */
  audit(user: ResetUser, delivered: boolean): Promise<void>;
  log: Pick<Logger, "info" | "warn" | "error">;
  /** Public storefront origin the link is built on. */
  origin: string;
  locale: EmailLocale;
}

/**
 * The whole subscriber, minus the container. Never throws: a mail failure
 * must not surface anywhere (the route already answered 201) and the token
 * itself is never written to the log — only whether a mail went out.
 */
export async function handlePasswordResetEvent(deps: PasswordResetDeps, event: PasswordResetEvent): Promise<ResetDecision> {
  const email = String(event.entity_id ?? "").trim();
  if (event.actor_type !== "user" || !email) {
    return { send: false, reason: "not_user", user: null };
  }
  let user: ResetUser | null = null;
  try {
    user = await deps.findUserByEmail(email);
  } catch (e) {
    deps.log.error(`[password-reset] could not look up the user for a reset request: ${(e as Error).message}`);
    return { send: false, reason: "no_user", user: null };
  }
  let disabledAt: string | null = null;
  if (user) {
    try {
      disabledAt = await deps.disabledAt(user.id);
    } catch (e) {
      // Unknown status = treat as disabled. Failing closed costs one retry;
      // failing open could hand a link to someone who was shown the door.
      deps.log.error(`[password-reset] could not read the access status of user ${user.id}: ${(e as Error).message}`);
      disabledAt = "unknown";
    }
  }
  const decision = decideResetRecipient({ actorType: event.actor_type, user, disabledAt });

  if (!decision.send) {
    if (decision.reason === "no_user") {
      // The auth identity exists (Medusa only emits for one that does) but no
      // panel user carries that email: an orphan identity, nothing to open.
      deps.log.warn("[password-reset] reset requested for an identity with no panel user — no email sent.");
    } else if (decision.reason === "disabled" && decision.user) {
      deps.log.info(`[password-reset] reset requested for deactivated user ${decision.user.id} — no email sent.`);
      await deps.audit(decision.user, false);
    }
    return decision;
  }

  const rendered = renderPasswordResetEmail(
    { email: decision.to, link: buildResetLink(deps.origin, event.token, decision.to), minutes: RESET_TOKEN_TTL_MINUTES },
    deps.locale
  );
  try {
    await deps.send(decision.to, rendered, decision.user.id);
    deps.log.info(`[password-reset] reset link sent to user ${decision.user.id}.`);
  } catch (e) {
    deps.log.error(`[password-reset] reset email to user ${decision.user.id} failed: ${(e as Error).message}`);
  }
  await deps.audit(decision.user, true);
  return decision;
}

/** Container-backed dependencies for the subscriber. */
export function containerDeps(container: MedusaContainer): PasswordResetDeps {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const t = tenant();
  return {
    async findUserByEmail(email) {
      const users = container.resolve<IUserModuleService>(Modules.USER);
      const candidates = [...new Set([email, email.toLowerCase()])];
      for (const candidate of candidates) {
        const [u] = await users.listUsers({ email: candidate }, { take: 1, select: ["id", "email"] });
        if (u) return { id: u.id, email: u.email };
      }
      return null;
    },
    async disabledAt(userId) {
      return (await accessStatusByUser(container, [userId])).get(userId)?.disabled_at ?? null;
    },
    async send(to, email, userId) {
      // Same channel the order confirmation uses: the Resend provider when its
      // credentials exist, otherwise notification-local (logs the message).
      await container.resolve(Modules.NOTIFICATION).createNotifications({
        to,
        channel: "email",
        template: "password-reset",
        trigger_type: "auth.password_reset",
        resource_id: userId,
        resource_type: "user",
        content: email,
        data: { user_id: userId },
      });
    },
    async audit(user, delivered) {
      // No actor: nobody was signed in. Entity = the user whose password it is.
      await recordAudit(container, {
        actorId: null,
        action: "password.reset_requested",
        entity: "user",
        entityId: user.id,
        after: { delivered },
      });
    },
    log: logger,
    origin: t.storefrontUrl,
    locale: resolveEmailLocale(t.locale),
  };
}

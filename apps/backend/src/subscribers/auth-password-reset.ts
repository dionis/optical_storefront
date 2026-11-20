/**
 * Emails the "choose a new password" link when someone asks for one from the
 * panel's login (HU-03).
 *
 * Medusa's `POST /auth/user/emailpass/reset-password` always answers 201 and
 * emits `auth.password_reset` only when the identity exists; the token in the
 * payload is single-use and lives 15 minutes. The decision of who actually
 * receives a link (active panel users only) and the mail itself live in
 * lib/password-reset.ts, so they are tested without a container. The token is
 * never logged.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { AuthWorkflowEvents } from "@medusajs/framework/utils";
import { containerDeps, handlePasswordResetEvent, type PasswordResetEvent } from "../lib/password-reset";

export default async function authPasswordResetSubscriber({
  event: { data },
  container,
}: SubscriberArgs<PasswordResetEvent>): Promise<void> {
  await handlePasswordResetEvent(containerDeps(container), data);
}

export const config: SubscriberConfig = {
  event: AuthWorkflowEvents.PASSWORD_RESET,
  context: {
    subscriberId: "auth-password-reset-email",
  },
};

/**
 * Delivers the password-recovery link that Medusa only emits as an event.
 *
 * `POST /auth/user/emailpass/reset-password { identifier }` always answers
 * 201 (no account enumeration) and, when the identity exists, emits
 * `auth.password_reset` with `{ entity_id (the e-mail), actor_type, token }`.
 * Only `user` identities (panel staff) get an e-mail here; customers do not
 * sign in with a password on this store.
 *
 * A delivery failure is logged and swallowed — it must never surface as an
 * error to the anonymous caller. The e-mail goes through the notification
 * module (Resend in production, logs locally), like every other e-mail.
 */
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import type { INotificationModuleService, Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { renderPasswordResetEmail } from "../lib/email/password-reset";
import { tenant } from "../lib/tenant";

interface PasswordResetEvent {
  entity_id: string;
  actor_type: string;
  token: string;
}

export default async function authPasswordResetHandler({ event, container }: SubscriberArgs<PasswordResetEvent>): Promise<void> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const { entity_id: email, actor_type, token } = event.data ?? ({} as PasswordResetEvent);
  if (actor_type !== "user" || !email || !token) return;
  try {
    const locale = tenant().locale === "en" ? "en" : "es";
    const content = renderPasswordResetEmail({ email, token, locale });
    await container.resolve<INotificationModuleService>(Modules.NOTIFICATION).createNotifications({
      to: email,
      channel: "email",
      template: "password-reset",
      trigger_type: "auth.password_reset",
      resource_type: "user",
      content,
    });
    logger.info(`[auth] password-reset e-mail sent to ${email.replace(/(.).+(@.*)/, "$1***$2")}`);
  } catch (e) {
    logger.error(`[auth] password-reset e-mail not sent: ${(e as Error).message}`);
  }
}

export const config: SubscriberConfig = { event: "auth.password_reset" };

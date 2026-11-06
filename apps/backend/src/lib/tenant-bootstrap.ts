/**
 * Hand a freshly deployed store to its owner (docs/MULTI-TENANT-TECNICO.md §7.2,
 * §11) — the logic behind src/scripts/tenant-bootstrap.ts.
 *
 *   1. finds or creates the owner's panel user. A new user gets a random
 *      password nobody ever sees: the owner creates their own from the
 *      activation mail (the "forgot my password" flow, 15-minute link);
 *   2. names that user owner in the store profile (`owner_user_id`), so the
 *      technician who ran `npx medusa user` to deploy is NOT the owner;
 *   3. clears `setup_completed_at`, so the panel opens on "Primeros pasos";
 *   4. audits it and mails the activation link (also printed, for when the
 *      mail provider is not configured yet).
 *
 * Refuses when the profile already names a different, existing owner: from
 * then on only that owner can give the store away (POST /admin/tenant/transfer-owner).
 * Running it again for the same owner is safe and resends the mail.
 */
import { randomBytes } from "node:crypto";
import type { IAuthModuleService, IUserModuleService, Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { recordAudit } from "./audit";
import { resolveEmailLocale } from "./email/copy";
import { buildActivationLink, renderOwnerActivationEmail } from "./email/owner-activation-email";
import { storefrontOrigin } from "./order-access";
import { invalidateStaffScope } from "./staff-scope";
import { resolveStoreSettings } from "./store-settings";
import { tenant } from "./tenant";
import { readTenantProfile, saveTenantProfile } from "./tenant-profile";

export class TenantBootstrapError extends Error {
  constructor(public reason: "bad_email" | "owner_already_set" | "identity_exists") {
    super(reason);
  }
}

export interface BootstrapInput {
  email: string;
  firstName?: string;
  lastName?: string;
  /** false = report what would happen and change nothing. */
  confirm: boolean;
}

export interface BootstrapReport {
  dry_run: boolean;
  email: string;
  user: "existing" | "created" | "would_create";
  user_id: string | null;
  previous_owner_id: string | null;
  activation_link: string;
  mail: "sent" | "failed" | "skipped";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function bootstrapTenant(container: MedusaContainer, input: BootstrapInput): Promise<BootstrapReport> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new TenantBootstrapError("bad_email");

  const users = container.resolve<IUserModuleService>(Modules.USER);
  const profile = await readTenantProfile(container, { fresh: true });
  const [existing] = await users.listUsers({ email }, { take: 1 });

  const named = profile.owner_user_id;
  if (named && named !== existing?.id) {
    const [stillThere] = await users.listUsers({ id: named }, { take: 1 });
    if (stillThere) throw new TenantBootstrapError("owner_already_set");
  }

  const link = buildActivationLink(storefrontOrigin(), email);
  const report: BootstrapReport = {
    dry_run: !input.confirm,
    email,
    user: existing ? "existing" : input.confirm ? "created" : "would_create",
    user_id: existing?.id ?? null,
    previous_owner_id: named,
    activation_link: link,
    mail: "skipped",
  };
  if (!input.confirm) return report;

  let userId = existing?.id ?? null;
  if (!userId) {
    const auth = container.resolve<IAuthModuleService>(Modules.AUTH);
    // Never shown, never stored outside the auth module: the owner replaces it.
    const registered = await auth.register("emailpass", { body: { email, password: randomBytes(32).toString("base64url") } });
    if (!registered.success || !registered.authIdentity) throw new TenantBootstrapError("identity_exists");
    const user = await users.createUsers({
      email,
      first_name: input.firstName?.trim().slice(0, 80) || undefined,
      last_name: input.lastName?.trim().slice(0, 80) || undefined,
      metadata: { created_by: "tenant-bootstrap" },
    });
    await auth.updateAuthIdentities([{ id: registered.authIdentity.id, app_metadata: { user_id: user.id } }]);
    userId = user.id;
  }
  report.user_id = userId;

  await saveTenantProfile(container, { owner_user_id: userId, setup_completed: false }, null);
  invalidateStaffScope();
  await recordAudit(container, {
    actorId: null,
    action: "tenant.bootstrap",
    entity: "user",
    entityId: userId,
    before: { owner_user_id: named },
    after: { owner_user_id: userId, email, user: report.user },
  });

  report.mail = await sendActivation(container, email, link);
  return report;
}

async function sendActivation(container: MedusaContainer, to: string, link: string): Promise<"sent" | "failed"> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  try {
    const settings = await resolveStoreSettings(container);
    const email = renderOwnerActivationEmail({ link, support: settings.support_email }, resolveEmailLocale(tenant().locale));
    await container.resolve(Modules.NOTIFICATION).createNotifications({
      to,
      channel: "email",
      template: "owner-activation",
      trigger_type: "tenant.bootstrap",
      resource_type: "user",
      content: email,
      data: {},
    });
    return "sent";
  } catch (e) {
    logger.warn(`[tenant-bootstrap] activation mail not sent: ${(e as Error).message}`);
    return "failed";
  }
}

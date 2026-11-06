/**
 * Ownership transfer — the step that hands a store to its owner
 * (docs/MULTI-TENANT-TECNICO.md §7.2).
 *
 * Only the current owner may give ownership away, and only after typing their
 * password again: an unattended open panel must not be enough. The previous
 * owner stays as a superadmin (an explicit assignment, so it shows as such in
 * Equipo), the change is audited, and both people get an email.
 *
 * Separate from tenant-profile.ts because it needs the staff helpers, which in
 * turn ask tenant-profile.ts who the owner is.
 */
import type { IAuthModuleService, IUserModuleService, Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { recordAudit } from "./audit";
import { resolveEmailLocale } from "./email/copy";
import { renderOwnerTransferEmail } from "./email/owner-transfer-email";
import { accessStatusByUser, profilesByUser } from "./staff-profile-data";
import { invalidateStaffScope, ownerUserId, writeStaffAssignment } from "./staff-scope";
import { resolveStoreSettings } from "./store-settings";
import { tenant } from "./tenant";
import { saveTenantProfile } from "./tenant-profile";

export class OwnerTransferError extends Error {
  constructor(public reason: string, public status = 422) {
    super(reason);
  }
}

export interface TransferInput {
  actorId: string;
  targetUserId: string;
  password: string;
}

export async function transferOwnership(container: MedusaContainer, input: TransferInput): Promise<{ owner_user_id: string }> {
  const users = container.resolve<IUserModuleService>(Modules.USER);
  const current = await ownerUserId(container);
  if (!current || current !== input.actorId) throw new OwnerTransferError("not_owner", 403);
  if (!input.targetUserId) throw new OwnerTransferError("target_required");
  if (input.targetUserId === input.actorId) throw new OwnerTransferError("same_user");

  const [me, target] = await Promise.all([
    users.retrieveUser(input.actorId).catch(() => null),
    users.retrieveUser(input.targetUserId).catch(() => null),
  ]);
  if (!me) throw new OwnerTransferError("not_owner", 403);
  if (!target) throw new OwnerTransferError("target_not_found", 404);
  if ((await accessStatusByUser(container, [target.id])).get(target.id)?.disabled_at) {
    throw new OwnerTransferError("target_disabled");
  }

  const auth = container.resolve<IAuthModuleService>(Modules.AUTH);
  const check = await auth.authenticate("emailpass", { body: { email: me.email, password: input.password } });
  if (!check.success) throw new OwnerTransferError("bad_password", 401);

  await saveTenantProfile(container, { owner_user_id: target.id }, input.actorId);
  // The previous owner keeps full access, now as an explicit superadmin.
  await writeStaffAssignment(container, { userId: me.id, role: "superadmin", establishmentIds: null, actorId: input.actorId });
  invalidateStaffScope();

  await recordAudit(container, {
    actorId: input.actorId,
    action: "owner.transfer",
    entity: "user",
    entityId: target.id,
    before: { owner_user_id: me.id, email: me.email },
    after: { owner_user_id: target.id, email: target.email },
  });

  await notifyTransfer(container, { from: me, to: target });
  return { owner_user_id: target.id };
}

/** One mail each, in each person's language. Best-effort: the transfer stands either way. */
async function notifyTransfer(
  container: MedusaContainer,
  people: { from: { id: string; email: string }; to: { id: string; email: string } }
): Promise<void> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  try {
    const [profiles, settings] = await Promise.all([
      profilesByUser(container, [people.from.id, people.to.id]),
      resolveStoreSettings(container),
    ]);
    const at = new Date();
    const notifications = container.resolve(Modules.NOTIFICATION);
    for (const [who, role] of [[people.from, "previous"], [people.to, "new"]] as const) {
      const p = profiles.get(who.id);
      const locale = resolveEmailLocale(p?.locale || tenant().locale);
      const email = renderOwnerTransferEmail(
        { role, from: people.from.email, to: people.to.email, at, support: settings.support_email },
        locale
      );
      await notifications.createNotifications({
        to: (p?.alert_email || who.email).toLowerCase(),
        channel: "email",
        template: "owner-transfer",
        trigger_type: "tenant.owner_transfer",
        resource_id: who.id,
        resource_type: "user",
        content: email,
        data: { role },
      });
    }
  } catch (e) {
    logger.warn(`[tenant-owner] transfer notice not sent: ${(e as Error).message}`);
  }
}

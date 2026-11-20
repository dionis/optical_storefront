/**
 * Ownership transfer between superadmins (owner's decision, 7-nov-2026).
 *
 *  - Who: the owner or any superadmin (`ownerTransferDenied`).
 *  - To whom: another ACTIVE superadmin only. Anyone else must be made
 *    superadmin first, which only the owner can do — so ownership never lands
 *    on someone the owner did not already trust with full access.
 *  - Exactly one owner: the transfer overwrites store_setting.owner_user_id
 *    (one column, one row); `ownerUserId` reads it before STORE_OWNER_EMAIL and
 *    the oldest-user rule.
 *  - The previous owner stays as a superadmin (explicit assignment, so Equipo
 *    shows them as such and the "no rows = legacy superadmin" rule is not what
 *    keeps them in).
 *  - The actor types their own password again: an unattended open panel must
 *    not be enough to hand the store over. Audited as `owner.transfer`.
 */
import type { IAuthModuleService, IUserModuleService, MedusaContainer } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { recordAudit } from "./audit";
import { accessStatusByUser } from "./staff-profile-data";
import { ownerTransferDenied } from "./staff-roles";
import { getStaffScope, invalidateStaffScope, ownerUserId, writeStaffAssignment } from "./staff-scope";
import { saveStoredOwnerUserId } from "./store-settings";

export class OwnerTransferError extends Error {
  constructor(public reason: string, public status = 403) {
    super(reason);
  }
}

export interface OwnerTransferInput {
  actorId: string;
  targetId: string;
  password: string;
}

export async function transferOwnership(
  container: MedusaContainer,
  input: OwnerTransferInput
): Promise<{ owner_user_id: string; previous_owner_id: string | null }> {
  const users = container.resolve<IUserModuleService>(Modules.USER);
  const [actor, me, target] = await Promise.all([
    getStaffScope(container, input.actorId),
    users.retrieveUser(input.actorId).catch(() => null),
    input.targetId ? users.retrieveUser(input.targetId).catch(() => null) : Promise.resolve(null),
  ]);
  if (!me) throw new OwnerTransferError("forbidden_role");
  if (!target) throw new OwnerTransferError("not_found", 404);

  // The target's role as the guard sees it (owner first, explicit rows, legacy rule).
  const [targetScope, access, previousOwnerId] = await Promise.all([
    getStaffScope(container, target.id),
    accessStatusByUser(container, [target.id]),
    ownerUserId(container),
  ]);
  const denied = ownerTransferDenied({
    actorRole: actor.role,
    actorIsTarget: target.id === me.id,
    targetIsOwner: previousOwnerId === target.id,
    targetRole: targetScope.role,
    targetDisabled: Boolean(access.get(target.id)?.disabled_at),
  });
  if (denied) throw new OwnerTransferError(denied, denied === "forbidden_role" ? 403 : 422);

  if (!input.password) throw new OwnerTransferError("password_required", 422);
  const auth = container.resolve<IAuthModuleService>(Modules.AUTH);
  const check = await auth.authenticate("emailpass", { body: { email: me.email, password: input.password } });
  if (!check.success) throw new OwnerTransferError("bad_current", 401);

  await saveStoredOwnerUserId(container, target.id, me.id);
  // The previous owner keeps full access, now as an explicit superadmin. Done
  // after the switch: while they are still the owner, resolveRole ignores rows.
  if (previousOwnerId && previousOwnerId !== target.id) {
    await writeStaffAssignment(container, { userId: previousOwnerId, role: "superadmin", establishmentIds: null, actorId: me.id });
  }
  // Every cached scope knows who the owner was; drop them all.
  invalidateStaffScope();

  const previous = previousOwnerId ? await users.retrieveUser(previousOwnerId).catch(() => null) : null;
  await recordAudit(container, {
    actorId: me.id,
    action: "owner.transfer",
    entity: "user",
    entityId: target.id,
    before: { owner_user_id: previousOwnerId, email: previous?.email ?? null },
    after: { owner_user_id: target.id, email: target.email },
  });

  return { owner_user_id: target.id, previous_owner_id: previousOwnerId };
}

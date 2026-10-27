import type { INotificationModuleService, IUserModuleService, Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { resolveEmailLocale } from "./email/copy";
import { renderApprovalRequestEmail } from "./email/pos-emails";
import type { EstablishmentRow } from "./establishments";
import { storefrontOrigin } from "./order-access";
import type { ApprovalRow } from "./pos-data";
import { isAdminRole, resolveRole } from "./staff-roles";
import { profilesByUser } from "./staff-profile-data";
import { assignmentsByUser } from "./staff-scope";
import { tenant } from "./tenant";

/**
 * Who decides discounts: the owner and the superadmins (owner's decision, not
 * delegable). Each gets the request at their alert email if they set one in
 * their profile, else at their login email, in their language.
 */
export async function approverRecipients(container: MedusaContainer): Promise<Array<{ email: string; locale: string }>> {
  const users = container.resolve<IUserModuleService>(Modules.USER);
  const all = await users.listUsers({}, { take: 500, order: { created_at: "ASC" } });
  const ids = all.map((u) => u.id);
  const [byUser, profiles] = await Promise.all([assignmentsByUser(container, ids), profilesByUser(container, ids)]);
  const seen = new Set<string>();
  const out: Array<{ email: string; locale: string }> = [];
  all.forEach((u, i) => {
    const role = resolveRole({ isOwner: i === 0, assignments: byUser.get(u.id) ?? [] }).role;
    if (!isAdminRole(role)) return;
    const p = profiles.get(u.id);
    const email = (p?.alert_email || u.email || "").toLowerCase();
    if (!email || seen.has(email)) return;
    seen.add(email);
    out.push({ email, locale: p?.locale || tenant().locale });
  });
  return out;
}

/**
 * Emails a discount request to everyone who can decide it, one mail each so
 * nobody sees the others' addresses. Best-effort: the request is recorded and
 * visible in the panel whether or not the mail goes out.
 */
export async function notifyApprovalRequest(
  container: MedusaContainer,
  approval: ApprovalRow,
  store: EstablishmentRow,
  sellerLabel: string
): Promise<number> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const notifications = container.resolve<INotificationModuleService>(Modules.NOTIFICATION);
  const link = `${storefrontOrigin()}/admin?tab=approvals&approval=${encodeURIComponent(approval.id)}`;
  let sent = 0;
  for (const r of await approverRecipients(container)) {
    const locale = resolveEmailLocale(r.locale);
    try {
      await notifications.createNotifications({
        to: r.email,
        channel: "email",
        template: "pos-discount-approval",
        trigger_type: "pos.discount.requested",
        resource_id: approval.id,
        resource_type: "discount_approval",
        content: renderApprovalRequestEmail(
          {
            storeCode: store.code,
            storeName: store.name,
            seller: sellerLabel,
            pct: approval.discount_pct,
            limitPct: approval.limit_pct,
            belowMinimum: approval.below_minimum,
            list: approval.list,
            total: approval.total,
            lines: approval.lines,
            reason: approval.reason,
            link,
          },
          locale
        ),
      });
      sent++;
    } catch (e) {
      logger.warn(`[pos] discount request ${approval.id} to ${r.email} failed: ${(e as Error).message}`);
    }
  }
  return sent;
}

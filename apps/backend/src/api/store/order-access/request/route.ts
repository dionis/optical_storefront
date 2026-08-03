import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { INotificationModuleService, Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { resolveEmailLocale } from "../../../../lib/email/copy";
import { renderMagicLinkEmail } from "../../../../lib/email/order-access-emails";
import { buildMagicLink, issueToken, normalizeEmail } from "../../../../lib/order-access";

/**
 * POST /store/order-access/request — mail a passwordless link to see one's orders.
 *
 * Deliberately indistinguishable responses: whether or not the address has ever
 * bought here, the caller gets the same 200. Anything else turns this endpoint
 * into an oracle for "is this person a customer of an eyewear store", which is a
 * health-adjacent fact we have no business confirming to strangers.
 *
 * Rate limiting lives in the route middleware (see src/api/middlewares.ts).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as { email?: unknown; locale?: unknown };
  const email = normalizeEmail(body.email);
  const locale = resolveEmailLocale(body.locale);

  // Uniform acknowledgement, sent regardless of what we find below.
  const ack = () => res.status(200).json({ ok: true });

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    // Even a malformed address gets the neutral answer — telling the caller the
    // difference between "invalid" and "unknown" is the same leak in disguise.
    ack();
    return;
  }

  let hasOrders = false;
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id"],
      filters: { email },
      pagination: { take: 1 },
    });
    hasOrders = (orders?.length ?? 0) > 0;
  } catch (error) {
    logger.error(
      `[order-access] could not look up orders for a magic-link request: ${(error as Error).message}`
    );
    ack();
    return;
  }

  if (!hasOrders) {
    ack();
    return;
  }

  try {
    const token = issueToken(email, "magic");
    const rendered = renderMagicLinkEmail(buildMagicLink(token), locale);
    const notificationService = req.scope.resolve<INotificationModuleService>(
      Modules.NOTIFICATION
    );
    await notificationService.createNotifications({
      to: email,
      channel: "email",
      template: "order-access-magic-link",
      trigger_type: "order-access.requested",
      content: rendered,
    });
  } catch (error) {
    // Log, but still answer 200: a mail failure must not become a probe either.
    logger.error(`[order-access] magic link could not be sent: ${(error as Error).message}`);
  }

  ack();
}

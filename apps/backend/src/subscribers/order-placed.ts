/**
 * Sends the order confirmation once the gateway has cleared the payment.
 *
 * `order.placed` is emitted by the complete-cart workflow, which only runs after
 * the payment session was authorized — Stripe, PayPal and Square all pass
 * through it — so this is the earliest point where "the customer paid" is true.
 * Capture may still settle asynchronously afterwards; that is `payment.captured`
 * and it is a different (later) notification, not this one.
 *
 * A failed email must never take an order down with it: everything here is
 * wrapped so an SMTP/API hiccup is logged and swallowed. The order is already
 * committed by the time this subscriber runs.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import type { INotificationModuleService, Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { resolveEmailLocale } from "../lib/email/copy";
import {
  renderAdminOrderNotification,
  renderCustomerOrderConfirmation,
  type OrderEmailData,
} from "../lib/email/order-confirmation";

const ORDER_FIELDS = [
  "id",
  "display_id",
  "email",
  "currency_code",
  "created_at",
  "metadata",
  // Medusa carries `locale` from the cart onto the order; the storefront sets it
  // from the active UI language (see apps/capri-storefront/src/data/medusaCart.js).
  "locale",
  "subtotal",
  "shipping_total",
  "tax_total",
  "discount_total",
  "total",
  "items.*",
  "shipping_address.*",
  "customer.first_name",
  "customer.last_name",
];

export default async function orderPlacedSubscriber({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>): Promise<void> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const notificationService = container.resolve<INotificationModuleService>(
    Modules.NOTIFICATION
  );

  let order:
    | (OrderEmailData & {
        locale?: string | null;
        metadata?: Record<string, unknown> | null;
      })
    | undefined;
  try {
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ORDER_FIELDS,
      filters: { id: data.id },
    });
    order = orders?.[0] as typeof order;
  } catch (error) {
    logger.error(
      `[order-placed] could not load order ${data.id} for the confirmation email: ${(error as Error).message}`
    );
    return;
  }

  if (!order) {
    logger.warn(`[order-placed] order ${data.id} not found — no email sent.`);
    return;
  }

  // The storefront stores the shopper's active language on the cart, which the
  // order inherits as `order.locale`. `metadata.locale` is checked as a fallback
  // so orders placed before the storefront started setting the native field
  // still resolve. Absent both, `es` is the store default.
  const customerLocale = resolveEmailLocale(order.locale ?? order.metadata?.["locale"]);
  const storeLocale = resolveEmailLocale(process.env.STORE_NOTIFICATION_LOCALE);

  if (order.email) {
    try {
      // Rendering is inside the try on purpose: a template that throws on some
      // unusual order shape must not take the store's copy down with it, which
      // is exactly what would happen if this ran before the guard.
      const customerEmail = renderCustomerOrderConfirmation(order, customerLocale);
      await notificationService.createNotifications({
        to: order.email,
        channel: "email",
        template: "order-placed-customer",
        trigger_type: "order.placed",
        resource_id: order.id,
        resource_type: "order",
        content: customerEmail,
        data: { order_id: order.id, display_id: order.display_id },
      });
    } catch (error) {
      logger.error(
        `[order-placed] customer confirmation for order ${order.id} failed: ${(error as Error).message}`
      );
    }
  } else {
    logger.warn(`[order-placed] order ${order.id} has no email — customer copy skipped.`);
  }

  // Store copy. Falls back to the sender address so a misconfigured deployment
  // still lands the notification somewhere the operator can see.
  const storeRecipient =
    process.env.STORE_ORDER_NOTIFICATION_EMAIL ?? process.env.RESEND_FROM_EMAIL;

  if (!storeRecipient) {
    logger.warn(
      "[order-placed] STORE_ORDER_NOTIFICATION_EMAIL is unset — the store copy was not sent."
    );
    return;
  }

  try {
    const adminEmail = renderAdminOrderNotification(order, storeLocale);
    await notificationService.createNotifications({
      to: storeRecipient,
      channel: "email",
      template: "order-placed-admin",
      trigger_type: "order.placed",
      resource_id: order.id,
      resource_type: "order",
      content: adminEmail,
      data: { order_id: order.id, display_id: order.display_id },
    });
  } catch (error) {
    logger.error(
      `[order-placed] store notification for order ${order.id} failed: ${(error as Error).message}`
    );
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: {
    subscriberId: "order-placed-email",
  },
};

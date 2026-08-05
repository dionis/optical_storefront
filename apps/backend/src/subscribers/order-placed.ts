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
  type OrderEmailExtras,
  type PrescriptionForEmail,
} from "../lib/email/order-confirmation";
import { enrichLensItems, extractPaymentInfo, extractTracking } from "../lib/email/order-enrich";
import type { Knex } from "@mikro-orm/knex";
import { renderAdminOrderSms, renderCustomerOrderSms } from "../lib/sms/order-sms";
import { notificationHealth, undeliverableReason } from "../lib/notification-health";
import { resolveStoreSettings } from "../lib/store-settings";
import { PRESCRIPTION_MODULE } from "../modules/prescription/index";
import type PrescriptionModuleService from "../modules/prescription/service";

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

  // Load the prescription values referenced by the order's line items so both
  // emails can show the full Rx (the lab needs it to make the lenses, and the
  // customer gets a copy of their own). PHI stays server-side otherwise; here it
  // only goes into the order emails the customer and owner already receive.
  const prescriptions: Record<string, PrescriptionForEmail> = {};
  try {
    const rxService = container.resolve<PrescriptionModuleService>(PRESCRIPTION_MODULE);
    const ids = new Set<string>();
    for (const it of order.items ?? []) {
      const pid = it.metadata?.["prescription_id"];
      if (pid) ids.add(String(pid));
    }
    for (const pid of ids) {
      try {
        const record = (await rxService.retrievePrescriptionRecord(pid)) as Record<string, unknown>;
        const rx = rxService.recordToRx(record);
        prescriptions[pid] = {
          od: rx.od,
          os: rx.os,
          pd: rx.pd,
          pd_od: rx.pd_od,
          pd_os: rx.pd_os,
          source: (rx as { source?: string | null }).source ?? null,
        };
      } catch (error) {
        logger.warn(`[order-placed] could not load prescription ${pid} for order ${order.id}: ${(error as Error).message}`);
      }
    }
  } catch {
    // Prescription module unavailable — emails still send, just without the Rx block.
  }

  // Extra email data (rich lens breakdown with names+prices, delivery method,
  // payment method for the admin, tracking). All best-effort — any failure leaves
  // the base email intact. Reads only; never touches the cart/checkout flow.
  let customerExtras: OrderEmailExtras | undefined;
  let adminExtras: OrderEmailExtras | undefined;
  try {
    const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
    const { data: extRows } = await query.graph({
      entity: "order",
      fields: [
        "shipping_methods.name",
        "shipping_methods.amount",
        "payment_collections.payments.provider_id",
        "payment_collections.payments.data",
        "fulfillments.labels.tracking_number",
        "fulfillments.labels.tracking_url",
      ],
      filters: { id: data.id },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext = extRows?.[0] as Record<string, any> | undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shippingMethods = (ext?.shipping_methods ?? []) as Array<any>;
    const shippingMethod = shippingMethods[0]?.name
      ? { name: String(shippingMethods[0].name), amount: Number(shippingMethods[0].amount ?? 0) }
      : null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payments = ((ext?.payment_collections ?? []) as Array<any>).flatMap((pc) => pc?.payments ?? []);
    const payment = await extractPaymentInfo(payments, process.env.STRIPE_SECRET_KEY);

    const tracking = extractTracking(ext?.fulfillments);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderItems = (order.items ?? []) as Array<Record<string, any>>;
    const itemsCustomer = await enrichLensItems(pg, orderItems, customerLocale);
    const itemsAdmin =
      customerLocale === storeLocale
        ? itemsCustomer
        : await enrichLensItems(pg, orderItems, storeLocale);

    customerExtras = { items: itemsCustomer, shippingMethod, tracking };
    adminExtras = { items: itemsAdmin, shippingMethod, tracking, payment };
  } catch (error) {
    logger.warn(`[order-placed] could not build email extras for order ${order.id}: ${(error as Error).message}`);
  }

  // The storefront records the shopper's email opt-in on the cart, which the
  // order inherits as metadata (complete-cart copies `cart.metadata` verbatim).
  // Absent means SEND: orders placed before the checkbox existed, and any order
  // created outside the storefront, must still get their confirmation — an
  // opt-in we never asked for is not a refusal.
  // Say it out loud, once per order, when a channel cannot actually deliver.
  // createNotifications() succeeds either way — the logging fallback reports
  // success — so without this an order confirmation that went nowhere is
  // indistinguishable in the logs from one that landed in the inbox.
  const health = notificationHealth();
  const emailUndeliverable = undeliverableReason(health.email);
  if (emailUndeliverable) {
    logger.error(`[order-placed] order ${data.id} email ${emailUndeliverable}`);
  }

  const orderMetadata = (order.metadata ?? {}) as Record<string, unknown>;
  const wantsEmail =
    orderMetadata["notify_email"] === undefined ||
    orderMetadata["notify_email"] === null ||
    orderMetadata["notify_email"] === true ||
    orderMetadata["notify_email"] === "true";

  if (order.email && wantsEmail) {
    try {
      // Rendering is inside the try on purpose: a template that throws on some
      // unusual order shape must not take the store's copy down with it, which
      // is exactly what would happen if this ran before the guard.
      const customerEmail = renderCustomerOrderConfirmation(order, customerLocale, prescriptions, customerExtras);
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
  } else if (!order.email) {
    logger.warn(`[order-placed] order ${order.id} has no email — customer copy skipped.`);
  } else {
    logger.info(`[order-placed] order ${order.id} opted out of the email copy.`);
  }

  // Store copy. The owner's contact settings come from the admin-configurable
  // store settings (resolveStoreSettings), which itself falls back to the
  // STORE_ORDER_NOTIFICATION_* / RESEND_FROM_EMAIL env vars — so behaviour is
  // identical to before until an owner saves settings in the admin.
  const storeSettings = await resolveStoreSettings(container);
  // Every administrator, owner included and de-duplicated by resolveStoreSettings.
  // Configured in the admin dashboard, falling back to
  // STORE_ADMIN_NOTIFICATION_EMAILS / STORE_ORDER_NOTIFICATION_EMAIL.
  const adminRecipients = storeSettings.admin_notification_emails;

  // No early return here: even without a store email, the SMS section below must
  // still run (owner SMS / customer SMS are independent of the email copy).
  if (!adminRecipients.length) {
    logger.warn(
      "[order-placed] no administrator notification email is configured — the store email copy was not sent."
    );
  } else {
    // Rendered once and reused: identical for every administrator, and a template
    // that throws should fail before we start sending, not halfway down the list.
    let adminEmail: ReturnType<typeof renderAdminOrderNotification> | null = null;
    try {
      adminEmail = renderAdminOrderNotification(order, storeLocale, prescriptions, adminExtras);
    } catch (error) {
      logger.error(
        `[order-placed] store notification for order ${order.id} could not be rendered: ${(error as Error).message}`
      );
    }

    if (adminEmail) {
      // Sent one by one rather than as a single multi-recipient message so the
      // administrators cannot see each other's addresses, and so one bad address
      // does not sink the notification for everybody else.
      for (const recipient of adminRecipients) {
        try {
          await notificationService.createNotifications({
            to: recipient,
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
            `[order-placed] store notification for order ${order.id} to ${recipient} failed: ${(error as Error).message}`
          );
        }
      }
    }
  }

  // ── SMS (opcional) ──────────────────────────────────────────────────────
  // The storefront records the shopper's SMS opt-in and phone on the cart, which
  // the order inherits as metadata (see calcShipping in medusaCart/MedusaCheckout).
  // Only text the customer when they asked for it AND we have a number. If Twilio
  // isn't configured the notification module routes SMS to the logging provider,
  // so this never crashes an order — same contract as the email above.
  const md = (order.metadata ?? {}) as Record<string, unknown>;
  const wantsSms = md["notify_sms"] === true || md["notify_sms"] === "true";
  const customerPhone =
    (typeof md["phone"] === "string" && md["phone"].trim()) ||
    (order.shipping_address?.phone ? String(order.shipping_address.phone).trim() : "") ||
    "";

  const smsUndeliverable = undeliverableReason(health.sms);
  if (smsUndeliverable && (wantsSms || storeSettings.owner_notification_sms)) {
    logger.error(`[order-placed] order ${order.id} SMS ${smsUndeliverable}`);
  }

  if (wantsSms && customerPhone) {
    try {
      const smsText = renderCustomerOrderSms(order, customerLocale);
      await notificationService.createNotifications({
        to: customerPhone,
        channel: "sms",
        template: "order-placed-customer-sms",
        trigger_type: "order.placed",
        resource_id: order.id,
        resource_type: "order",
        content: { subject: "", text: smsText },
        data: { order_id: order.id, display_id: order.display_id },
      });
    } catch (error) {
      logger.error(
        `[order-placed] customer SMS for order ${order.id} failed: ${(error as Error).message}`
      );
    }
  }

  // Owner SMS copy — only when an owner number is configured (admin settings,
  // falling back to STORE_ORDER_NOTIFICATION_SMS). Kept separate from the
  // customer opt-in: the store always wants to hear about a new order.
  const ownerSmsRecipient = storeSettings.owner_notification_sms;
  if (ownerSmsRecipient) {
    try {
      const adminSmsText = renderAdminOrderSms(order, storeLocale);
      await notificationService.createNotifications({
        to: ownerSmsRecipient,
        channel: "sms",
        template: "order-placed-admin-sms",
        trigger_type: "order.placed",
        resource_id: order.id,
        resource_type: "order",
        content: { subject: "", text: adminSmsText },
        data: { order_id: order.id, display_id: order.display_id },
      });
    } catch (error) {
      logger.error(
        `[order-placed] owner SMS for order ${order.id} failed: ${(error as Error).message}`
      );
    }
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
  context: {
    subscriberId: "order-placed-email",
  },
};

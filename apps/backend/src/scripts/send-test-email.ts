/**
 * Smoke-tests the notification wiring end to end.
 * Run with: medusa exec src/scripts/send-test-email.ts
 *
 * Goes through the real notification module, so it proves the provider, the
 * credentials and the module registration all work — not just that the Resend
 * API is reachable. Override the recipient with TEST_EMAIL_TO.
 *
 * Set TEST_EMAIL_TEMPLATE=order to send the real order-confirmation template
 * filled with sample data, which is how you iterate on the layout without
 * placing an order. TEST_EMAIL_TEMPLATE=admin sends the store's copy instead.
 */

import type { INotificationModuleService, Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { resolveEmailLocale } from "../lib/email/copy";
import {
  renderAdminOrderNotification,
  renderCustomerOrderConfirmation,
  type OrderEmailData,
} from "../lib/email/order-confirmation";

/** Stand-in order used only by the template preview modes. */
const SAMPLE_ORDER: OrderEmailData = {
  id: "order_sample",
  display_id: 1042,
  email: "cliente@example.com",
  currency_code: "usd",
  created_at: new Date(),
  subtotal: 189,
  shipping_total: 8,
  tax_total: 0,
  discount_total: 0,
  total: 197,
  customer: { first_name: "Ana", last_name: "Pérez" },
  items: [
    {
      title: "Montura Capri Aviator",
      variant_title: "Dorado / 52-18-140",
      quantity: 1,
      unit_price: 189,
      total: 189,
      metadata: {
        kind: "configured-frame",
        prescription_id: "presc_sample",
        lens_config: {
          design_code: "prog-mid",
          material_code: "1.61",
          treatment_code: "ar-premium",
        },
      },
    },
  ],
  shipping_address: {
    first_name: "Ana",
    last_name: "Pérez",
    address_1: "Calle 23 #456",
    city: "La Habana",
    postal_code: "10400",
    country_code: "cu",
    phone: "+53 5555 5555",
  },
};

export default async function sendTestEmail({
  container,
}: {
  container: { resolve: <T>(id: string) => T };
}): Promise<void> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const notificationService = container.resolve<INotificationModuleService>(
    Modules.NOTIFICATION
  );

  const to =
    process.env.TEST_EMAIL_TO ??
    process.env.STORE_ORDER_NOTIFICATION_EMAIL ??
    process.env.RESEND_FROM_EMAIL;

  if (!to) {
    logger.error(
      "No recipient. Set TEST_EMAIL_TO, STORE_ORDER_NOTIFICATION_EMAIL or RESEND_FROM_EMAIL."
    );
    return;
  }

  const mode = process.env.TEST_EMAIL_TEMPLATE ?? "plain";
  const locale = resolveEmailLocale(process.env.TEST_EMAIL_LOCALE);

  let template: string;
  let content: { subject: string; text: string; html: string };

  if (mode === "order") {
    template = "order-placed-customer";
    content = renderCustomerOrderConfirmation(SAMPLE_ORDER, locale);
  } else if (mode === "admin") {
    template = "order-placed-admin";
    content = renderAdminOrderNotification(SAMPLE_ORDER, locale);
  } else {
    const text = "envio de datos correctos de la compra";
    template = "test-verification";
    content = {
      subject: "Prueba de verificacion de correo",
      text,
      html: `<p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#111827">${text}</p>`,
    };
  }

  const result = await notificationService.createNotifications({
    to,
    channel: "email",
    template,
    content,
  });

  logger.info(
    `Test email dispatched to ${to} (notification ${Array.isArray(result) ? result[0]?.id : result?.id})`
  );
}

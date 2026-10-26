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
  type PrescriptionForEmail,
  type OrderEmailExtras,
} from "../lib/email/order-confirmation";
import type { EnrichedItem } from "../lib/email/order-enrich";

/** Stand-in order used only by the template preview modes. */
const SAMPLE_ORDER: OrderEmailData = {
  id: "order_sample",
  display_id: 1042,
  email: "cliente@example.com",
  currency_code: "usd",
  created_at: new Date(),
  subtotal: 276,
  shipping_total: 12,
  tax_total: 0,
  discount_total: 0,
  total: 288,
  customer: { first_name: "Ana", last_name: "Pérez" },
  items: [
    {
      title: "Flexure FX-2043",
      variant_title: "Black / 54-17-140",
      quantity: 1,
      unit_price: 288,
      total: 288,
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

/** Enriched items with specs, photo, lens breakdown — triggers the card layout. */
const SAMPLE_ITEMS: EnrichedItem[] = [
  {
    frame_name: "Flexure FX-2043",
    image_url: null, // no image for the test — triggers the fallback icon
    collection: "FLEXURE",
    color: "Negro Mate",
    frame_price: 89,
    design: "Progresivo",
    material: { label: "1.61 Alto Índice", price: 75 },
    photo: { label: "Transitions Gen 8 Gris", price: 65 },
    ar: { label: "AR Premium Multi-capa", price: 47 },
    specs: {
      sku: "889756112094",
      size: "54 □ 17 – 140",
      lens_width: 54,
      lens_height: 38,
      bridge: 17,
      temple: 140,
      shape: "Rectangular",
      style: "Full-rim",
      material: "TR-90 (Nylon)",
      gender: "Unisex",
      age_group: "Adulto",
      features: ["Bisagra flexible", "Hipoalergénico"],
    },
    with_rx: true,
    quantity: 1,
    total: 288,
  },
];

/** Prescription with realistic values, including fitting height for progressives. */
const SAMPLE_PRESCRIPTIONS: Record<string, PrescriptionForEmail> = {
  presc_sample: {
    od: { sph: -2.25, cyl: -0.75, axis: 175, add: 1.5, prism: null, base: null },
    os: { sph: -1.75, cyl: -1.0, axis: 10, add: 1.5, prism: null, base: null },
    pd: 63,
    pd_od: null,
    pd_os: null,
    seg_height: 22,
    source: "manual",
    verified_by_user: true,
    created_at: new Date(),
    has_file: false,
    has_tryon: false,
    patient_for: "me",
    measurement_source: null,
    id: "rx_01_sample",
  },
};

const SAMPLE_EXTRAS: OrderEmailExtras = {
  items: SAMPLE_ITEMS,
  shippingMethod: { name: "Entrega personal en tienda", amount: 0 },
  payment: { provider: "stripe", method: "card", brand: "visa", last4: "4242" },
  tracking: [],
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
    content = renderCustomerOrderConfirmation(
      SAMPLE_ORDER,
      locale,
      SAMPLE_PRESCRIPTIONS,
      SAMPLE_EXTRAS
    );
  } else if (mode === "admin") {
    template = "order-placed-admin";
    content = renderAdminOrderNotification(
      SAMPLE_ORDER,
      locale,
      SAMPLE_PRESCRIPTIONS,
      SAMPLE_EXTRAS
    );
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

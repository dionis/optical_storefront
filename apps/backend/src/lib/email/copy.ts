/**
 * Email copy dictionary for backend-sent transactional mail.
 *
 * The storefront's `t(key)` dictionary lives in the browser bundle and is not
 * reachable from the server, so email strings get their own table here. Same
 * rule applies: never hardcode a string in a template — add the key to both
 * `es` and `en`. `es` is the default when an order carries no locale.
 */

export type EmailLocale = "es" | "en";

export const DEFAULT_EMAIL_LOCALE: EmailLocale = "es";

/** Narrows an arbitrary locale hint to a locale the email templates support. */
export function resolveEmailLocale(value: unknown): EmailLocale {
  return value === "en" ? "en" : DEFAULT_EMAIL_LOCALE;
}

interface EmailCopy {
  order_confirmation_subject: string;
  order_confirmation_preheader: string;
  order_confirmation_greeting: string;
  order_confirmation_intro: string;
  order_confirmation_next_steps_title: string;
  order_confirmation_next_steps_body: string;
  admin_order_subject: string;
  admin_order_title: string;
  admin_order_intro: string;
  order_number: string;
  order_date: string;
  customer: string;
  items: string;
  quantity: string;
  unit_price: string;
  line_total: string;
  subtotal: string;
  shipping: string;
  taxes: string;
  discount: string;
  total: string;
  shipping_address: string;
  no_shipping_address: string;
  lens_configuration: string;
  lens_design: string;
  lens_material: string;
  lens_treatment: string;
  lens_photochromic: string;
  lens_ar: string;
  prescription_values: string;
  pupillary_distance: string;
  fitting_height: string;
  right_eye: string;
  left_eye: string;
  order_frame: string;
  order_brand: string;
  order_color: string;
  order_use: string;
  delivery_method: string;
  purchase_datetime: string;
  tracking: string;
  tracking_pending: string;
  payment_method: string;
  payment_card: string;
  payment_link: string;
  card_ending: string;
  rx_source: string;
  rx_source_manual: string;
  rx_source_ocr: string;
  prescription_attached: string;
  payment_confirmed: string;
  questions: string;
  footer_automatic: string;
}

const es: EmailCopy = {
  order_confirmation_subject: "Confirmación de tu pedido #{{display_id}}",
  order_confirmation_preheader: "Recibimos tu pago y ya estamos preparando tus espejuelos.",
  order_confirmation_greeting: "Hola{{name}},",
  order_confirmation_intro:
    "Gracias por tu compra. Confirmamos que el pago se procesó correctamente y tu pedido ya está en preparación.",
  order_confirmation_next_steps_title: "¿Qué sigue?",
  order_confirmation_next_steps_body:
    "Nuestro laboratorio tallará los lentes según tu graduación y montará el armazón. Te escribiremos de nuevo cuando el pedido salga hacia tu dirección.",
  admin_order_subject: "Nuevo pedido #{{display_id}} — {{total}}",
  admin_order_title: "Nuevo pedido pagado",
  admin_order_intro: "Se completó un pedido y la pasarela confirmó el pago.",
  order_number: "Pedido",
  order_date: "Fecha",
  customer: "Cliente",
  items: "Artículos",
  quantity: "Cant.",
  unit_price: "Precio unit.",
  line_total: "Importe",
  subtotal: "Subtotal",
  shipping: "Envío",
  taxes: "Impuestos",
  discount: "Descuento",
  total: "Total",
  shipping_address: "Dirección de envío",
  no_shipping_address: "Sin dirección de envío registrada.",
  lens_configuration: "Configuración de lentes",
  lens_design: "Diseño",
  lens_material: "Material",
  lens_treatment: "Tratamiento",
  lens_photochromic: "Fotocromático",
  lens_ar: "Antirreflejo",
  prescription_values: "Datos de la receta",
  pupillary_distance: "Distancia pupilar (DP)",
  fitting_height: "Altura de montaje",
  right_eye: "OD (derecho)",
  left_eye: "OS (izquierdo)",
  order_frame: "Montura",
  order_brand: "Marca / colección",
  order_color: "Color",
  order_use: "Uso",
  delivery_method: "Método de envío",
  purchase_datetime: "Fecha y hora de compra",
  tracking: "Seguimiento",
  tracking_pending: "El número de seguimiento se enviará cuando el pedido salga a reparto.",
  payment_method: "Método de pago",
  payment_card: "Tarjeta",
  payment_link: "Stripe Link",
  card_ending: "terminada en",
  rx_source: "Origen de la receta",
  rx_source_manual: "Ingresada manualmente",
  rx_source_ocr: "Foto subida (leída por OCR)",
  prescription_attached: "Receta médica asociada al pedido.",
  payment_confirmed: "Pago confirmado",
  questions: "Si tienes alguna duda, responde a este correo y te ayudamos.",
  footer_automatic: "Este es un correo automático. No compartas datos de tarjeta por esta vía.",
};

const en: EmailCopy = {
  order_confirmation_subject: "Your order confirmation #{{display_id}}",
  order_confirmation_preheader: "We received your payment and your glasses are being prepared.",
  order_confirmation_greeting: "Hi{{name}},",
  order_confirmation_intro:
    "Thanks for your purchase. Your payment went through and we have started preparing your order.",
  order_confirmation_next_steps_title: "What happens next?",
  order_confirmation_next_steps_body:
    "Our lab will cut the lenses to your prescription and fit the frame. We will email you again as soon as the order ships.",
  admin_order_subject: "New order #{{display_id}} — {{total}}",
  admin_order_title: "New paid order",
  admin_order_intro: "An order was completed and the gateway confirmed the payment.",
  order_number: "Order",
  order_date: "Date",
  customer: "Customer",
  items: "Items",
  quantity: "Qty",
  unit_price: "Unit price",
  line_total: "Amount",
  subtotal: "Subtotal",
  shipping: "Shipping",
  taxes: "Taxes",
  discount: "Discount",
  total: "Total",
  shipping_address: "Shipping address",
  no_shipping_address: "No shipping address on file.",
  lens_configuration: "Lens configuration",
  lens_design: "Design",
  lens_material: "Material",
  lens_treatment: "Treatment",
  lens_photochromic: "Photochromic",
  lens_ar: "Anti-reflective",
  prescription_values: "Prescription details",
  pupillary_distance: "Pupillary distance (PD)",
  fitting_height: "Fitting height",
  right_eye: "OD (right)",
  left_eye: "OS (left)",
  order_frame: "Frame",
  order_brand: "Brand / collection",
  order_color: "Color",
  order_use: "Use",
  delivery_method: "Delivery method",
  purchase_datetime: "Purchase date & time",
  tracking: "Tracking",
  tracking_pending: "The tracking number will be sent once the order ships.",
  payment_method: "Payment method",
  payment_card: "Card",
  payment_link: "Stripe Link",
  card_ending: "ending in",
  rx_source: "Prescription source",
  rx_source_manual: "Entered manually",
  rx_source_ocr: "Uploaded photo (read by OCR)",
  prescription_attached: "A prescription is linked to this order.",
  payment_confirmed: "Payment confirmed",
  questions: "If you have any questions, just reply to this email.",
  footer_automatic: "This is an automated message. Never send card details by email.",
};

const DICTIONARY: Record<EmailLocale, EmailCopy> = { es, en };

/** Looks up an email string, interpolating `{{token}}` placeholders. */
export function t(
  locale: EmailLocale,
  key: keyof EmailCopy,
  vars: Record<string, string | number> = {}
): string {
  const template = DICTIONARY[locale][key];
  return template.replace(/\{\{(\w+)\}\}/g, (match, token: string) =>
    token in vars ? String(vars[token]) : match
  );
}

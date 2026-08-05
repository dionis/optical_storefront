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
  // ── Order tracking (magic link + stage names) ──
  track_cta: string;
  track_link_intro: string;
  magic_link_subject: string;
  magic_link_title: string;
  magic_link_intro: string;
  magic_link_button: string;
  magic_link_expiry: string;
  magic_link_ignore: string;
  stage_confirmed: string;
  stage_in_lab: string;
  stage_in_lab_frame: string;
  stage_shipped: string;
  stage_in_transit: string;
  stage_delivered: string;
  state_canceled: string;
  state_refunded: string;
  state_payment_pending: string;
  // ── Support message raised from the tracking page ──
  support_subject: string;
  support_title: string;
  support_intro: string;
  support_from: string;
  support_reason: string;
  support_message: string;
  support_ack_subject: string;
  support_ack_title: string;
  support_ack_body: string;
  reason_delay: string;
  reason_wrong: string;
  reason_cancel: string;
  reason_other: string;
  // ── Order canceled by the shopper from the tracking page ──
  cancel_ack_subject: string;
  cancel_ack_title: string;
  cancel_ack_body: string;
  cancel_refund_issued: string;
  cancel_hold_released: string;
  cancel_nothing_charged: string;
  cancel_admin_subject: string;
  cancel_admin_title: string;
  cancel_admin_intro: string;
  cancel_money: string;
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
  track_cta: "Ver el estado de mi pedido",
  track_link_intro:
    "Puedes seguir el estado de este y de todos tus pedidos desde un mismo lugar:",
  magic_link_subject: "Tus pedidos en {{store}}",
  magic_link_title: "Acceso a tus pedidos",
  magic_link_intro:
    "Pulsa el botón para ver el estado de todos tus pedidos. No necesitas contraseña.",
  magic_link_button: "Ver mis pedidos",
  magic_link_expiry: "Este enlace caduca en 30 minutos por seguridad.",
  magic_link_ignore:
    "Si no pediste este enlace, puedes ignorar este correo: nadie ha accedido a tus datos.",
  stage_confirmed: "Pedido confirmado",
  stage_in_lab: "Lentes en el laboratorio",
  stage_in_lab_frame: "Preparando tu pedido",
  stage_shipped: "Listo para enviar",
  stage_in_transit: "En camino",
  stage_delivered: "Entregado",
  state_canceled: "Pedido cancelado",
  state_refunded: "Pedido reembolsado",
  state_payment_pending: "Pago pendiente",
  support_subject: "Consulta sobre el pedido #{{display_id}} ({{reason}})",
  support_title: "Mensaje de un cliente sobre su pedido",
  support_intro:
    "Un cliente escribió desde la página de seguimiento. Responde directamente a su correo.",
  support_from: "Cliente",
  support_reason: "Motivo",
  support_message: "Mensaje",
  support_ack_subject: "Recibimos tu mensaje sobre el pedido #{{display_id}}",
  support_ack_title: "Tu mensaje llegó",
  support_ack_body:
    "Gracias por escribirnos. Nuestro equipo revisará tu pedido y te responderá a este mismo correo lo antes posible.",
  reason_delay: "Demora en la entrega",
  reason_wrong: "Algo no está correcto",
  reason_cancel: "Quiero cancelar o cambiar",
  reason_other: "Otra consulta",
  cancel_ack_subject: "Cancelamos tu pedido #{{display_id}}",
  cancel_ack_title: "Pedido cancelado",
  cancel_ack_body:
    "Cancelamos tu pedido tal como pediste. No hay nada más que tengas que hacer.",
  cancel_refund_issued:
    "Devolvimos {{amount}} al mismo método de pago con el que compraste. Según tu banco, puede tardar entre 5 y 10 días hábiles en aparecer en tu estado de cuenta.",
  cancel_hold_released:
    "Liberamos la retención sobre tu tarjeta. Nunca llegamos a cobrarte, así que no verás ningún cargo.",
  cancel_nothing_charged: "No se te cobró nada por este pedido.",
  cancel_admin_subject: "Pedido #{{display_id}} cancelado por el cliente",
  cancel_admin_title: "Cancelación del cliente",
  cancel_admin_intro:
    "El cliente canceló este pedido desde la página de seguimiento. Medusa ya lo marcó como cancelado y procesó el reembolso que correspondiera.",
  cancel_money: "Dinero",
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
  track_cta: "Track my order",
  track_link_intro: "You can follow this and all your other orders in one place:",
  magic_link_subject: "Your orders at {{store}}",
  magic_link_title: "Access your orders",
  magic_link_intro:
    "Tap the button to see the status of all your orders. No password needed.",
  magic_link_button: "View my orders",
  magic_link_expiry: "This link expires in 30 minutes for your security.",
  magic_link_ignore:
    "If you did not request this link you can ignore this email — nobody accessed your data.",
  stage_confirmed: "Order confirmed",
  stage_in_lab: "Lenses in the lab",
  stage_in_lab_frame: "Preparing your order",
  stage_shipped: "Ready to ship",
  stage_in_transit: "On its way",
  stage_delivered: "Delivered",
  state_canceled: "Order canceled",
  state_refunded: "Order refunded",
  state_payment_pending: "Payment pending",
  support_subject: "Question about order #{{display_id}} ({{reason}})",
  support_title: "Customer message about their order",
  support_intro:
    "A customer wrote in from the order tracking page. Reply straight to their address.",
  support_from: "Customer",
  support_reason: "Reason",
  support_message: "Message",
  support_ack_subject: "We received your message about order #{{display_id}}",
  support_ack_title: "Your message arrived",
  support_ack_body:
    "Thanks for reaching out. Our team will review your order and reply to this email as soon as possible.",
  reason_delay: "Delivery is late",
  reason_wrong: "Something is not right",
  reason_cancel: "I want to cancel or change it",
  reason_other: "Another question",
  cancel_ack_subject: "We canceled your order #{{display_id}}",
  cancel_ack_title: "Order canceled",
  cancel_ack_body: "We canceled your order as you asked. There is nothing else for you to do.",
  cancel_refund_issued:
    "We refunded {{amount}} to the payment method you used. Depending on your bank it can take 5 to 10 business days to show up on your statement.",
  cancel_hold_released:
    "We released the hold on your card. You were never charged, so no charge will appear.",
  cancel_nothing_charged: "You were not charged for this order.",
  cancel_admin_subject: "Order #{{display_id}} canceled by the customer",
  cancel_admin_title: "Customer cancellation",
  cancel_admin_intro:
    "The customer canceled this order from the tracking page. Medusa has already marked it canceled and processed any refund that was due.",
  cancel_money: "Money",
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

// ─────────────────────────────────────────────────────────────────────────
// Notificación de orden (comprobante al cliente y aviso al admin).
//
// REALIDAD: enviar correos/SMS automáticos NO se puede desde un frontend puro
// (hace falta un servicio de envío con credenciales). Por eso esta capa hace
// dos cosas:
//   1) `notifyOrder(order)` — POST a un webhook configurable
//      (VITE_ORDER_NOTIFY_URL). Ahí puedes conectar Zapier/Make/Twilio/SendGrid
//      o el backend de Medusa para que ENVÍE email + SMS al cliente y al admin.
//      Si la variable no está configurada, no hace nada (no rompe la compra).
//   2) `orderMailto(order)` — genera un enlace mailto con el comprobante ya
//      redactado, para que el cliente pueda enviarse/enviar una copia con un clic
//      (respaldo que funciona sin ningún servicio).
//
// Además, el admin SIEMPRE ve la orden al instante en su panel de "Pedidos"
// (es su aviso en vivo, sin depender de correo).
// ─────────────────────────────────────────────────────────────────────────

const money = (n) => "$" + (Number(n) || 0).toFixed(2);
// Correo de la tienda (para el aviso al admin). Configurable por env.
const STORE_EMAIL = (import.meta.env && import.meta.env.VITE_STORE_EMAIL) || "";
const NOTIFY_URL = (import.meta.env && import.meta.env.VITE_ORDER_NOTIFY_URL) || "";

/** Arma el texto del comprobante (asunto + cuerpo) en el idioma dado. */
export function buildOrderText(order, lang = "es") {
  const es = lang !== "en";
  const lines = [];
  lines.push(es ? `Pedido ${order.id}` : `Order ${order.id}`);
  lines.push("");
  (order.items || []).forEach((it) => {
    const specs = Array.isArray(it.specs) && it.specs.length ? ` (${it.specs.map((s) => s.label).join(" · ")})` : "";
    lines.push(`• ${it.name}${it.color ? " · " + it.color : ""}${specs} — ${money(it.total)}`);
  });
  lines.push("");
  lines.push((es ? "Total: " : "Total: ") + money(order.total));
  if (order.shipping) {
    lines.push((es ? "Entrega: " : "Delivery: ") + (order.shipping.method === "ship"
      ? (es ? "envío a domicilio" : "home shipping")
      : (es ? "recogida en tienda" : "store pickup")));
  }
  if (order.delivery?.address) lines.push(`${order.delivery.address}, ${order.delivery.city || ""}`);
  const subject = es ? `Tu pedido ${order.id} — Óptica El Rancho` : `Your order ${order.id} — Óptica El Rancho`;
  return { subject, body: lines.join("\n") };
}

/** Enlace mailto con el comprobante redactado (respaldo que funciona sin backend). */
export function orderMailto(order, lang = "es", to) {
  const { subject, body } = buildOrderText(order, lang);
  const dest = to || order.customer?.email || order.delivery?.email || "";
  return `mailto:${encodeURIComponent(dest)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Dispara la notificación real (best-effort). POST al webhook configurado con el
 * payload de la orden + los correos destino (cliente y tienda). Nunca lanza:
 * si falla o no está configurado, devuelve {sent:false, reason} y la compra sigue.
 */
export async function notifyOrder(order, lang = "es") {
  if (!NOTIFY_URL) return { sent: false, reason: "not-configured" };
  try {
    await fetch(NOTIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order,
        lang,
        to: {
          customer: order.customer?.email || order.delivery?.email || null,
          store: STORE_EMAIL || null,
        },
        text: buildOrderText(order, lang),
      }),
      keepalive: true, // permite que el POST salga aunque se cierre el panel
    });
    return { sent: true };
  } catch {
    return { sent: false, reason: "error" };
  }
}

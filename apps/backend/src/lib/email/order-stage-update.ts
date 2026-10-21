/**
 * Stage-change email to the customer.
 *
 * Sent by POST /admin/order-board/:id/stage after a SUCCESSFUL transition, so
 * the customer hears "your glasses are in the lab / shipped / delivered" the
 * moment the owner records it — with the tracking link when there is one.
 *
 * Same contract as every other outbound email here: `{ subject, html, text }`
 * composed server-side (the Resend provider ships it verbatim), bilingual via
 * the order's locale, inline styles only, and a plain-text alternative.
 */
import { type EmailLocale, t } from "./copy";
import { esc, BRAND, MUTED, GOLD, GOLD_LIGHT, INK, shell, iconImg } from "./order-confirmation";
import { storefrontOrigin } from "../order-access";
import { ORDER_STAGES, type OrderStage } from "../order-status";

export interface StageEmailInput {
  displayId: string | number;
  stage: OrderStage;
  /** True when no line of the order carries a lens config (frame only). */
  frameOnly: boolean;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
}

/** Copy per stage, on top of the stage names copy.ts already owns. */
const STAGE_BODY: Record<OrderStage, { es: string; en: string }> = {
  confirmed: {
    es: "Hemos recibido tu pedido y ya está confirmado. Te avisaremos en cada paso.",
    en: "We received your order and it is confirmed. We'll keep you posted at every step.",
  },
  in_lab: {
    es: "Tus lentes están en el laboratorio: estamos tallando y montando tus cristales con tu receta.",
    en: "Your lenses are in the lab: we are cutting and fitting your lenses to your prescription.",
  },
  shipped: {
    es: "Tu pedido salió de la óptica y está empaquetado, listo para el transportista.",
    en: "Your order left the optical shop and is packed, ready for the courier.",
  },
  in_transit: {
    es: "¡Tu pedido va en camino! El transportista ya lo tiene.",
    en: "Your order is on its way! The courier has it now.",
  },
  delivered: {
    es: "Tu pedido figura como entregado. Esperamos que disfrutes tus espejuelos.",
    en: "Your order is marked as delivered. We hope you love your glasses.",
  },
};

const SUBJECT: Record<OrderStage, { es: string; en: string }> = {
  confirmed: { es: "Pedido #{{id}} confirmado", en: "Order #{{id}} confirmed" },
  in_lab: { es: "Pedido #{{id}}: tus lentes están en el laboratorio", en: "Order #{{id}}: your lenses are in the lab" },
  shipped: { es: "Pedido #{{id}}: empaquetado y listo para salir", en: "Order #{{id}}: packed and ready to go" },
  in_transit: { es: "Pedido #{{id}} en camino 🚚", en: "Order #{{id}} on its way 🚚" },
  delivered: { es: "Pedido #{{id}} entregado", en: "Order #{{id}} delivered" },
};

function stageName(locale: EmailLocale, stage: OrderStage, frameOnly: boolean): string {
  if (stage === "in_lab" && frameOnly) return t(locale, "stage_in_lab_frame");
  const key = (`stage_${stage}`) as Parameters<typeof t>[1];
  return t(locale, key);
}

export function renderOrderStageUpdate(
  locale: EmailLocale,
  input: StageEmailInput
): { subject: string; html: string; text: string } {
  const id = String(input.displayId);
  const subject = SUBJECT[input.stage][locale].replace("{{id}}", id);
  const name = stageName(locale, input.stage, input.frameOnly);
  const body = STAGE_BODY[input.stage][locale];
  const track = storefrontOrigin() + "/my-orders";
  const trackLabel = locale === "es" ? "Seguir mi pedido" : "Track my order";
  const trackingLine = input.trackingNumber
    ? (locale === "es" ? "Nº de seguimiento: " : "Tracking number: ") + input.trackingNumber
    : "";
  const trackingHref = (input.trackingUrl || "").trim();

  // Línea de progreso con las cinco etapas: la actual en dorado, las pasadas
  // en azul marino, las que faltan en gris — como la página de seguimiento.
  const icons: Record<OrderStage, string> = {
    confirmed: "navy-card", in_lab: "navy-ruler", shipped: "navy-layers", in_transit: "navy-truck", delivered: "navy-heart",
  };
  const current = ORDER_STAGES.indexOf(input.stage);
  const steps = ORDER_STAGES.map((st, i) => {
    const done = i < current, now = i === current;
    const bg = now ? GOLD : done ? BRAND : "#e7eaf0";
    const color = now ? BRAND : done ? "#ffffff" : MUTED;
    const label = stageName(locale, st, input.frameOnly);
    return `<td width="20%" align="center" style="vertical-align:top;padding:0 2px">
        <div style="width:34px;height:34px;line-height:34px;margin:0 auto;border-radius:999px;background:${bg};color:${color};font-size:13px;font-weight:800;text-align:center">${done ? "✓" : i + 1}</div>
        <div style="margin-top:6px;font-size:10px;line-height:1.3;font-weight:${now ? 800 : 600};color:${now ? BRAND : done ? INK : MUTED}">${esc(label)}</div>
      </td>`;
  }).join("");

  const inner = `
    <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${MUTED}">${locale === "es" ? "Pedido" : "Order"} #${esc(id)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
      <td style="padding-right:10px;vertical-align:middle">${iconImg(icons[input.stage], 36)}</td>
      <td style="vertical-align:middle;font-size:22px;font-weight:800;color:${BRAND}">${esc(name)}</td>
    </tr></table>
    <p style="font-size:14px;line-height:1.7;color:${INK};margin:12px 0 0">${esc(body)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:22px;padding:14px 0;border-top:1px dashed ${GOLD};border-bottom:1px dashed ${GOLD}">
      <tr>${steps}</tr>
    </table>
    ${trackingLine ? `<div style="margin-top:18px;padding:12px 14px;background:${GOLD_LIGHT};border-radius:10px;font-size:14px;color:${BRAND}">${iconImg("navy-truck", 18)} <strong>${esc(trackingLine)}</strong></div>` : ""}
    <div style="margin-top:22px">
      ${trackingHref
        ? `<a href="${esc(trackingHref)}" style="display:inline-block;background:${GOLD};color:${BRAND};text-decoration:none;font-size:14px;font-weight:800;padding:13px 26px;border-radius:999px">${locale === "es" ? "Ver seguimiento del envío" : "View shipment tracking"} →</a>
           <div style="margin-top:12px"><a href="${esc(track)}" style="color:${BRAND};font-size:13px;font-weight:700">${esc(trackLabel)}</a></div>`
        : `<a href="${esc(track)}" style="display:inline-block;background:${GOLD};color:${BRAND};text-decoration:none;font-size:14px;font-weight:800;padding:13px 26px;border-radius:999px">${esc(trackLabel)} →</a>`}
    </div>`;
  const html = shell(subject, body, inner, locale);

  const text = [
    `${locale === "es" ? "Pedido" : "Order"} #${id} — ${name}`,
    "",
    body,
    trackingLine,
    trackingHref ? `${locale === "es" ? "Seguimiento" : "Tracking"}: ${trackingHref}` : "",
    `${trackLabel}: ${track}`,
  ].filter(Boolean).join("\n");

  return { subject, html, text };
}

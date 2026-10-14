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
import { esc, BRAND, MUTED, BORDER } from "./order-confirmation";
import { storefrontOrigin } from "../order-access";
import type { OrderStage } from "../order-status";

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

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f7fb">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7fb;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid ${BORDER};border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif">
        <tr><td style="background:${BRAND};color:#ffffff;padding:18px 24px;font-size:16px;font-weight:bold;letter-spacing:.04em">RUBI LENS</td></tr>
        <tr><td style="padding:26px 24px 8px;color:#111827">
          <div style="font-size:13px;color:${MUTED};margin-bottom:6px">${locale === "es" ? "Pedido" : "Order"} #${esc(id)}</div>
          <div style="font-size:20px;font-weight:bold;color:${BRAND}">${esc(name)}</div>
          <p style="font-size:14px;line-height:1.6;color:#374151;margin:12px 0 0">${esc(body)}</p>
          ${trackingLine ? `<p style="font-size:13px;color:${MUTED};margin:14px 0 0">${esc(trackingLine)}</p>` : ""}
        </td></tr>
        <tr><td style="padding:20px 24px 26px">
          ${trackingHref
            ? `<a href="${esc(trackingHref)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:12px 22px;border-radius:999px">${locale === "es" ? "Ver seguimiento del envío" : "View shipment tracking"}</a>
               <div style="margin-top:12px"><a href="${esc(track)}" style="color:${BRAND};font-size:13px">${esc(trackLabel)}</a></div>`
            : `<a href="${esc(track)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:12px 22px;border-radius:999px">${esc(trackLabel)}</a>`}
        </td></tr>
        <tr><td style="padding:14px 24px;border-top:1px solid ${BORDER};font-size:12px;color:${MUTED}">RUBI LENS · ${locale === "es" ? "Óptica y salud visual" : "Optics & visual health"}</td></tr>
      </table>
    </td></tr>
  </table></body></html>`;

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

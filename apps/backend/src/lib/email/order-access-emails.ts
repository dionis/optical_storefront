/**
 * Emails for the guest order-tracking flow: the magic link that grants access,
 * and the support thread raised from the tracking page.
 *
 * Shares the shell/escaping of the order confirmation so every message the store
 * sends looks like it came from the same place.
 */

import { t, type EmailLocale } from "./copy";
import { BORDER, BRAND, MUTED, esc, shell, type RenderedEmail } from "./order-confirmation";

function storeName(): string {
  return process.env.STORE_NAME?.trim() || "Óptica";
}

function button(href: string, label: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:24px 0">
    <tr>
      <td align="center" style="border-radius:8px;background:${BRAND}">
        <a href="${esc(href)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${esc(label)}</a>
      </td>
    </tr>
  </table>`;
}

/** The passwordless access link. */
export function renderMagicLinkEmail(link: string, locale: EmailLocale): RenderedEmail {
  const subject = t(locale, "magic_link_subject", { store: storeName() });
  const inner = `
    <div style="font-size:15px;line-height:1.7;color:#374151">${esc(t(locale, "magic_link_intro"))}</div>
    ${button(link, t(locale, "magic_link_button"))}
    <div style="font-size:13px;color:${MUTED};line-height:1.6">${esc(t(locale, "magic_link_expiry"))}</div>
    <div style="font-size:13px;color:${MUTED};line-height:1.6;margin-top:8px">${esc(t(locale, "magic_link_ignore"))}</div>`;

  const text = [
    t(locale, "magic_link_intro"),
    "",
    link,
    "",
    t(locale, "magic_link_expiry"),
    t(locale, "magic_link_ignore"),
  ].join("\n");

  return {
    subject,
    html: shell(t(locale, "magic_link_title"), t(locale, "magic_link_intro"), inner, locale),
    text,
  };
}

export interface SupportMessageData {
  displayId: string;
  orderId: string;
  customerEmail: string;
  /** Already-translated label for the reason the shopper picked. */
  reasonLabel: string;
  message: string;
}

function row(label: string, value: string): string {
  return `
  <tr>
    <td style="padding:8px 0;border-bottom:1px solid ${BORDER};font-size:13px;color:${MUTED};width:120px;vertical-align:top">${esc(label)}</td>
    <td style="padding:8px 0;border-bottom:1px solid ${BORDER};font-size:14px;color:#111827">${esc(value)}</td>
  </tr>`;
}

/** Internal copy for the support inbox. */
export function renderSupportEmail(
  data: SupportMessageData,
  locale: EmailLocale
): RenderedEmail {
  const subject = t(locale, "support_subject", {
    display_id: data.displayId,
    reason: data.reasonLabel,
  });

  const inner = `
    <div style="font-size:15px;line-height:1.7;color:#374151">${esc(t(locale, "support_intro"))}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:20px">
      ${row(t(locale, "order_number"), `#${data.displayId}`)}
      ${row(t(locale, "support_from"), data.customerEmail)}
      ${row(t(locale, "support_reason"), data.reasonLabel)}
    </table>
    <div style="margin-top:20px">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:${MUTED};margin-bottom:6px">${esc(t(locale, "support_message"))}</div>
      <div style="font-size:14px;line-height:1.7;color:#111827;white-space:pre-wrap">${esc(data.message)}</div>
    </div>`;

  const text = [
    t(locale, "support_intro"),
    "",
    `${t(locale, "order_number")}: #${data.displayId}`,
    `${t(locale, "support_from")}: ${data.customerEmail}`,
    `${t(locale, "support_reason")}: ${data.reasonLabel}`,
    "",
    `${t(locale, "support_message")}:`,
    data.message,
  ].join("\n");

  return {
    subject,
    html: shell(t(locale, "support_title"), t(locale, "support_intro"), inner, locale),
    text,
  };
}

/** Receipt sent back to the shopper so they know the message landed. */
export function renderSupportAckEmail(
  data: Pick<SupportMessageData, "displayId" | "reasonLabel" | "message">,
  locale: EmailLocale
): RenderedEmail {
  const subject = t(locale, "support_ack_subject", { display_id: data.displayId });
  const inner = `
    <div style="font-size:15px;line-height:1.7;color:#374151">${esc(t(locale, "support_ack_body"))}</div>
    <div style="margin-top:20px;padding:16px;background:#f9fafb;border-radius:8px">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:${MUTED};margin-bottom:6px">${esc(t(locale, "support_message"))}</div>
      <div style="font-size:14px;line-height:1.7;color:#374151;white-space:pre-wrap">${esc(data.message)}</div>
    </div>`;

  return {
    subject,
    html: shell(t(locale, "support_ack_title"), t(locale, "support_ack_body"), inner, locale),
    text: [t(locale, "support_ack_body"), "", data.message].join("\n"),
  };
}

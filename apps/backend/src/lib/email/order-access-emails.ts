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

/** What canceling did to the shopper's money — mirrors RefundOutcome. */
export type CancelMoneyOutcome = "refund" | "release_hold" | "nothing";

/**
 * How far the cancellation actually got.
 *
 * `canceled` — Medusa cancelled the order and moved the money.
 * `pending_return` — the store's policy allowed it, but the parcel had already
 * been dispatched and nothing in Medusa can cancel a shipped fulfillment, so a
 * human has to close it out. The two cases must not share copy: telling someone
 * their money is back when it is not is the worst version of this email.
 */
export type CancelStatus = "canceled" | "pending_return";

/** The enumerated reasons the cancel dialog offers. */
export const CANCEL_REASONS = {
  late_delivery: "cancel_reason_late_delivery",
  not_needed: "cancel_reason_not_needed",
  wrong_item: "cancel_reason_wrong_item",
  other: "cancel_reason_other",
} as const;

export type CancelReasonKey = keyof typeof CANCEL_REASONS;

export interface CancelNoticeData {
  displayId: string;
  orderId: string;
  customerEmail: string;
  outcome: CancelMoneyOutcome;
  /** Formatted with its currency, e.g. "$132.00" — only used for a refund. */
  refundAmount: string;
  status: CancelStatus;
  /** Why the shopper says they are cancelling. */
  reason: CancelReasonKey;
  /** Their own words, already trimmed and length-capped; may be empty. */
  note: string;
  /** Business days the lab was allowed — the first policy condition. */
  labDays: number;
  /** Dispatch date, already formatted for the reader's locale. */
  shippedOn: string;
  /** Whole hours the parcel had been out — the second policy condition. */
  hoursSinceShipment: number;
  /** When the shopper pressed the button, formatted for the reader's locale. */
  requestedAt: string;
}

function moneyLine(data: CancelNoticeData, locale: EmailLocale): string {
  if (data.status === "pending_return") {
    // Nothing has moved yet: the order is still open in Medusa.
    if (data.outcome === "nothing") return t(locale, "cancel_nothing_charged");
    return t(locale, "cancel_pending_money", { amount: data.refundAmount });
  }
  if (data.outcome === "refund") {
    return t(locale, "cancel_refund_issued", { amount: data.refundAmount });
  }
  if (data.outcome === "release_hold") return t(locale, "cancel_hold_released");
  return t(locale, "cancel_nothing_charged");
}

/** The store rule that let this cancellation through, spelled out. */
function policyLine(data: CancelNoticeData, locale: EmailLocale): string {
  return t(locale, "cancel_policy_line", {
    lab_days: data.labDays,
    shipped: data.shippedOn,
    hours: data.hoursSinceShipment,
  });
}

function reasonLabel(data: CancelNoticeData, locale: EmailLocale): string {
  return t(locale, CANCEL_REASONS[data.reason]);
}

/**
 * Confirmation to the shopper. The money sentence is the part people actually
 * open this for, so it is explicit about which of the three things happened
 * rather than a generic "we'll be in touch".
 */
export function renderCancelAckEmail(
  data: CancelNoticeData,
  locale: EmailLocale
): RenderedEmail {
  const pending = data.status === "pending_return";
  const subject = t(locale, pending ? "cancel_pending_subject" : "cancel_ack_subject", {
    display_id: data.displayId,
  });
  const title = t(locale, pending ? "cancel_pending_title" : "cancel_ack_title");
  const body = t(locale, pending ? "cancel_pending_body" : "cancel_ack_body");
  const money = moneyLine(data, locale);

  const inner = `
    <div style="font-size:15px;line-height:1.7;color:#374151">${esc(body)}</div>
    <div style="margin-top:20px;padding:16px;background:#f9fafb;border-radius:8px;font-size:14px;line-height:1.7;color:#374151">${esc(money)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:20px">
      ${row(t(locale, "order_number"), `#${data.displayId}`)}
      ${row(t(locale, "cancel_reason"), reasonLabel(data, locale))}
    </table>`;

  return {
    subject,
    html: shell(title, body, inner, locale),
    text: [
      body,
      "",
      money,
      "",
      `${t(locale, "order_number")}: #${data.displayId}`,
      `${t(locale, "cancel_reason")}: ${reasonLabel(data, locale)}`,
    ].join("\n"),
  };
}

/**
 * The same event, told to whoever runs the store.
 *
 * This one carries the two things the owner needs and the shopper's copy does
 * not: WHO cancelled (the address that proved control of the order) and WHY it
 * was allowed to happen — the policy sentence, so a cancellation on a shipped
 * parcel reads as a rule working rather than a bug. When Medusa could not close
 * it out, the mail says so in the subject: it is a task, not a receipt.
 */
export function renderCancelAdminEmail(
  data: CancelNoticeData,
  locale: EmailLocale
): RenderedEmail {
  const pending = data.status === "pending_return";
  const subject = t(locale, pending ? "cancel_admin_pending_subject" : "cancel_admin_subject", {
    display_id: data.displayId,
  });
  const title = t(locale, pending ? "cancel_admin_pending_title" : "cancel_admin_title");
  const intro = t(locale, pending ? "cancel_admin_pending_intro" : "cancel_admin_intro");
  const money = moneyLine(data, locale);
  const note = data.note || t(locale, "cancel_note_none");

  const inner = `
    <div style="font-size:15px;line-height:1.7;color:#374151">${esc(intro)}</div>
    ${
      pending
        ? `<div style="margin-top:16px;padding:14px;background:#fef2f2;border-left:3px solid #dc2626;border-radius:6px;font-size:14px;line-height:1.6;color:#991b1b">${esc(t(locale, "cancel_admin_action"))}</div>`
        : ""
    }
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:20px">
      ${row(t(locale, "order_number"), `#${data.displayId}`)}
      ${row(t(locale, "cancel_requested_by"), data.customerEmail)}
      ${row(t(locale, "cancel_requested_at"), data.requestedAt)}
      ${row(t(locale, "cancel_reason"), reasonLabel(data, locale))}
      ${row(t(locale, "cancel_note"), note)}
      ${row(t(locale, "cancel_policy"), policyLine(data, locale))}
      ${row(t(locale, "cancel_money"), money)}
    </table>`;

  return {
    subject,
    html: shell(title, intro, inner, locale),
    text: [
      intro,
      ...(pending ? ["", t(locale, "cancel_admin_action")] : []),
      "",
      `${t(locale, "order_number")}: #${data.displayId}`,
      `${t(locale, "cancel_requested_by")}: ${data.customerEmail}`,
      `${t(locale, "cancel_requested_at")}: ${data.requestedAt}`,
      `${t(locale, "cancel_reason")}: ${reasonLabel(data, locale)}`,
      `${t(locale, "cancel_note")}: ${note}`,
      `${t(locale, "cancel_policy")}: ${policyLine(data, locale)}`,
      `${t(locale, "cancel_money")}: ${money}`,
    ].join("\n"),
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

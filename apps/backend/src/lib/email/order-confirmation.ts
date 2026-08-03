/**
 * Renders the two emails triggered by a paid order: the customer's confirmation
 * and the store's internal copy.
 *
 * Both bodies are built as inline-styled HTML — email clients strip <style>
 * blocks and have no cascade worth relying on — plus a plain-text alternative so
 * the message survives text-only clients and scores better with spam filters.
 *
 * Amounts arrive already computed by Medusa. Nothing here recalculates a price;
 * these templates are a read-only view of what the order module settled on.
 */

import { t, type EmailLocale } from "./copy";
import { storefrontOrigin } from "../order-access";

export interface OrderEmailLineItem {
  title?: string | null;
  product_title?: string | null;
  variant_title?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  total?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface OrderEmailAddress {
  first_name?: string | null;
  last_name?: string | null;
  address_1?: string | null;
  address_2?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
  phone?: string | null;
}

export interface OrderEmailData {
  id: string;
  display_id?: number | string | null;
  email?: string | null;
  currency_code?: string | null;
  created_at?: string | Date | null;
  subtotal?: number | null;
  shipping_total?: number | null;
  tax_total?: number | null;
  discount_total?: number | null;
  total?: number | null;
  items?: OrderEmailLineItem[] | null;
  shipping_address?: OrderEmailAddress | null;
  customer?: { first_name?: string | null; last_name?: string | null } | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export const BRAND = "#1f3a5f";
export const MUTED = "#6b7280";
export const BORDER = "#e5e7eb";

/** Escapes text destined for an HTML body. Order data is customer-supplied. */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(
  amount: number | null | undefined,
  currency: string | null | undefined,
  locale: EmailLocale
): string {
  const value = Number(amount ?? 0);
  const code = (currency ?? "usd").toUpperCase();
  try {
    return new Intl.NumberFormat(locale === "en" ? "en-US" : "es-ES", {
      style: "currency",
      currency: code,
    }).format(value);
  } catch {
    // Unknown/!ISO currency code — fall back to a bare amount rather than throw.
    return `${value.toFixed(2)} ${code}`;
  }
}

function formatDate(value: string | Date | null | undefined, locale: EmailLocale): string {
  const date = value ? new Date(value) : new Date();
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-ES", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(date);
}

function customerName(order: OrderEmailData): string {
  const parts = [
    order.customer?.first_name ?? order.shipping_address?.first_name,
    order.customer?.last_name ?? order.shipping_address?.last_name,
  ].filter(Boolean);
  return parts.join(" ").trim();
}

function itemLabel(item: OrderEmailLineItem): string {
  const base = item.title ?? item.product_title ?? "";
  return item.variant_title ? `${base} — ${item.variant_title}` : base;
}

/**
 * Pulls the human-readable lens selection off the line-item metadata written by
 * the cart's configured-line route. Returns [] for plain (non-configured) items.
 */
function lensLines(item: OrderEmailLineItem, locale: EmailLocale): string[] {
  const config = item.metadata?.["lens_config"] as Record<string, unknown> | undefined;
  if (!config) {
    return [];
  }
  const rows: string[] = [];
  if (config.design_code) {
    rows.push(`${t(locale, "lens_design")}: ${String(config.design_code)}`);
  }
  if (config.material_code) {
    rows.push(`${t(locale, "lens_material")}: ${String(config.material_code)}`);
  }
  // El carrito guarda photo_code (fotocromático) y ar_code (antirreflejo).
  if (config.photo_code) {
    rows.push(`${t(locale, "lens_photochromic")}: ${String(config.photo_code)}`);
  }
  if (config.ar_code) {
    rows.push(`${t(locale, "lens_ar")}: ${String(config.ar_code)}`);
  }
  if (config.treatment_code) {
    rows.push(`${t(locale, "lens_treatment")}: ${String(config.treatment_code)}`);
  }
  return rows;
}

function formatAddress(address: OrderEmailAddress | null | undefined): string[] {
  if (!address) {
    return [];
  }
  const name = [address.first_name, address.last_name].filter(Boolean).join(" ");
  const cityLine = [address.postal_code, address.city, address.province]
    .filter(Boolean)
    .join(" ");
  return [
    name,
    address.address_1 ?? "",
    address.address_2 ?? "",
    cityLine,
    (address.country_code ?? "").toUpperCase(),
    address.phone ?? "",
  ].filter((line) => line.trim().length > 0);
}

interface TotalRow {
  label: string;
  amount: number;
  strong?: boolean;
}

function totalRows(order: OrderEmailData, locale: EmailLocale): TotalRow[] {
  const rows: TotalRow[] = [
    { label: t(locale, "subtotal"), amount: Number(order.subtotal ?? 0) },
  ];
  if (Number(order.discount_total ?? 0) > 0) {
    rows.push({ label: t(locale, "discount"), amount: -Number(order.discount_total) });
  }
  if (Number(order.shipping_total ?? 0) > 0) {
    rows.push({ label: t(locale, "shipping"), amount: Number(order.shipping_total) });
  }
  if (Number(order.tax_total ?? 0) > 0) {
    rows.push({ label: t(locale, "taxes"), amount: Number(order.tax_total) });
  }
  rows.push({ label: t(locale, "total"), amount: Number(order.total ?? 0), strong: true });
  return rows;
}

function renderItemsTable(order: OrderEmailData, locale: EmailLocale): string {
  const currency = order.currency_code;
  const rows = (order.items ?? [])
    .map((item) => {
      const extras = lensLines(item, locale);
      const extrasHtml = extras.length
        ? `<div style="margin-top:6px;font-size:12px;color:${MUTED};line-height:1.5">` +
          `<strong style="color:${MUTED}">${esc(t(locale, "lens_configuration"))}</strong><br/>` +
          extras.map(esc).join("<br/>") +
          "</div>"
        : "";
      return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid ${BORDER};vertical-align:top">
          <div style="font-weight:600;color:#111827">${esc(itemLabel(item))}</div>
          ${extrasHtml}
        </td>
        <td style="padding:12px 0;border-bottom:1px solid ${BORDER};text-align:center;vertical-align:top;color:${MUTED}">
          ${esc(item.quantity ?? 1)}
        </td>
        <td style="padding:12px 0;border-bottom:1px solid ${BORDER};text-align:right;vertical-align:top;white-space:nowrap">
          ${esc(formatMoney(item.total ?? item.unit_price, currency, locale))}
        </td>
      </tr>`;
    })
    .join("");

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:8px">
    <thead>
      <tr>
        <th align="left" style="padding-bottom:8px;border-bottom:2px solid ${BORDER};font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:${MUTED}">${esc(t(locale, "items"))}</th>
        <th align="center" style="padding-bottom:8px;border-bottom:2px solid ${BORDER};font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:${MUTED}">${esc(t(locale, "quantity"))}</th>
        <th align="right" style="padding-bottom:8px;border-bottom:2px solid ${BORDER};font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:${MUTED}">${esc(t(locale, "line_total"))}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderTotals(order: OrderEmailData, locale: EmailLocale): string {
  const rows = totalRows(order, locale)
    .map(
      (row) => `
      <tr>
        <td style="padding:4px 0;color:${row.strong ? "#111827" : MUTED};font-weight:${row.strong ? 700 : 400}">${esc(row.label)}</td>
        <td align="right" style="padding:4px 0;color:${row.strong ? "#111827" : MUTED};font-weight:${row.strong ? 700 : 400};white-space:nowrap">${esc(formatMoney(row.amount, order.currency_code, locale))}</td>
      </tr>`
    )
    .join("");

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:16px;font-size:14px">
    <tbody>${rows}</tbody>
  </table>`;
}

function renderAddress(order: OrderEmailData, locale: EmailLocale): string {
  const lines = formatAddress(order.shipping_address);
  const body = lines.length
    ? lines.map(esc).join("<br/>")
    : esc(t(locale, "no_shipping_address"));
  return `
  <div style="margin-top:24px">
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:${MUTED};margin-bottom:6px">${esc(t(locale, "shipping_address"))}</div>
    <div style="font-size:14px;line-height:1.6;color:#374151">${body}</div>
  </div>`;
}

export function shell(title: string, preheader: string, inner: string, locale: EmailLocale): string {
  return `<!doctype html>
<html lang="${locale}">
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827">
    <span style="display:none;font-size:0;line-height:0;max-height:0;opacity:0;overflow:hidden">${esc(preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f4f5f7">
      <tr>
        <td align="center" style="padding:32px 16px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">
            <tr>
              <td style="background:${BRAND};padding:24px 32px">
                <div style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:.02em">${esc(title)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px">${inner}</td>
            </tr>
            <tr>
              <td style="padding:16px 32px 28px;border-top:1px solid ${BORDER}">
                <div style="font-size:12px;color:${MUTED};line-height:1.6">${esc(t(locale, "footer_automatic"))}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function textLines(order: OrderEmailData, locale: EmailLocale): string[] {
  const currency = order.currency_code;
  const lines: string[] = [];
  lines.push(`${t(locale, "order_number")}: #${order.display_id ?? order.id}`);
  lines.push(`${t(locale, "order_date")}: ${formatDate(order.created_at, locale)}`);
  lines.push("");
  lines.push(`${t(locale, "items")}:`);
  for (const item of order.items ?? []) {
    lines.push(
      `- ${itemLabel(item)} x${item.quantity ?? 1} — ${formatMoney(item.total ?? item.unit_price, currency, locale)}`
    );
    for (const extra of lensLines(item, locale)) {
      lines.push(`    ${extra}`);
    }
  }
  lines.push("");
  for (const row of totalRows(order, locale)) {
    lines.push(`${row.label}: ${formatMoney(row.amount, currency, locale)}`);
  }
  const address = formatAddress(order.shipping_address);
  if (address.length) {
    lines.push("");
    lines.push(`${t(locale, "shipping_address")}:`);
    lines.push(...address);
  }
  return lines;
}

export interface RxEyeForEmail {
  sph: number | null;
  cyl: number | null;
  axis: number | null;
  add: number | null;
  prism: number | null;
  base: string | null;
}
export interface PrescriptionForEmail {
  od: RxEyeForEmail;
  os: RxEyeForEmail;
  pd: number | null;
  pd_od: number | null;
  pd_os: number | null;
  seg_height?: number | null;
}

/** Dioptric values carry an explicit sign; blanks render as an em dash. */
const dpt = (v: number | null | undefined): string =>
  v == null ? "—" : (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
const plain = (v: number | string | null | undefined): string =>
  v == null || v === "" ? "—" : String(v);

/** OD/OS table + measurements for a single prescription. */
function rxTable(rx: PrescriptionForEmail, locale: EmailLocale): string {
  const head = ["SPH", "CYL", "AXIS", "ADD", "PRISM", "BASE"];
  const row = (label: string, e: RxEyeForEmail) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid ${BORDER};font-weight:600;white-space:nowrap">${esc(label)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid ${BORDER};text-align:center">${esc(dpt(e.sph))}</td>
        <td style="padding:6px 8px;border-bottom:1px solid ${BORDER};text-align:center">${esc(dpt(e.cyl))}</td>
        <td style="padding:6px 8px;border-bottom:1px solid ${BORDER};text-align:center">${esc(plain(e.axis))}</td>
        <td style="padding:6px 8px;border-bottom:1px solid ${BORDER};text-align:center">${esc(dpt(e.add))}</td>
        <td style="padding:6px 8px;border-bottom:1px solid ${BORDER};text-align:center">${esc(dpt(e.prism))}</td>
        <td style="padding:6px 8px;border-bottom:1px solid ${BORDER};text-align:center">${esc(plain(e.base))}</td>
      </tr>`;
  const pdText = rx.pd != null
    ? `${plain(rx.pd)} mm`
    : [rx.pd_od, rx.pd_os].some((v) => v != null)
      ? `OD ${plain(rx.pd_od)} / OS ${plain(rx.pd_os)} mm`
      : "—";
  return `
  <div style="margin-top:20px">
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:${MUTED};margin-bottom:6px">${esc(t(locale, "prescription_values"))}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">
      <thead>
        <tr>
          <th style="padding:6px 8px;border-bottom:2px solid ${BORDER}"></th>
          ${head.map((h) => `<th style="padding:6px 8px;border-bottom:2px solid ${BORDER};font-size:11px;color:${MUTED};text-align:center">${esc(h)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${row(t(locale, "right_eye"), rx.od)}
        ${row(t(locale, "left_eye"), rx.os)}
      </tbody>
    </table>
    <div style="margin-top:8px;font-size:13px;color:#374151">
      ${esc(t(locale, "pupillary_distance"))}: <strong>${esc(pdText)}</strong>${
        rx.seg_height != null
          ? ` &nbsp;·&nbsp; ${esc(t(locale, "fitting_height"))}: <strong>${esc(plain(rx.seg_height))} mm</strong>`
          : ""
      }
    </div>
  </div>`;
}

/** Renders every distinct prescription referenced by the order's line items. */
function renderPrescriptions(
  order: OrderEmailData,
  prescriptions: Record<string, PrescriptionForEmail> | undefined,
  locale: EmailLocale
): string {
  if (!prescriptions) return "";
  const seen = new Set<string>();
  const blocks: string[] = [];
  for (const item of order.items ?? []) {
    const pid = item.metadata?.["prescription_id"];
    if (!pid) continue;
    const key = String(pid);
    if (seen.has(key)) continue;
    seen.add(key);
    const rx = prescriptions[key];
    if (rx) blocks.push(rxTable(rx, locale));
  }
  return blocks.join("");
}

/** Plain-text version of the prescriptions, for the email's text/plain part. */
function rxTextLines(
  order: OrderEmailData,
  prescriptions: Record<string, PrescriptionForEmail> | undefined,
  locale: EmailLocale
): string[] {
  if (!prescriptions) return [];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const item of order.items ?? []) {
    const pid = item.metadata?.["prescription_id"];
    if (!pid) continue;
    const key = String(pid);
    if (seen.has(key)) continue;
    seen.add(key);
    const rx = prescriptions[key];
    if (!rx) continue;
    lines.push("", t(locale, "prescription_values") + ":");
    lines.push(`  ${t(locale, "right_eye")}: SPH ${dpt(rx.od.sph)} CYL ${dpt(rx.od.cyl)} AXIS ${plain(rx.od.axis)} ADD ${dpt(rx.od.add)}`);
    lines.push(`  ${t(locale, "left_eye")}: SPH ${dpt(rx.os.sph)} CYL ${dpt(rx.os.cyl)} AXIS ${plain(rx.os.axis)} ADD ${dpt(rx.os.add)}`);
    const pd = rx.pd != null ? `${plain(rx.pd)} mm` : `OD ${plain(rx.pd_od)} / OS ${plain(rx.pd_os)} mm`;
    lines.push(`  ${t(locale, "pupillary_distance")}: ${pd}`);
  }
  return lines;
}

/** Customer-facing "we got your payment" email. */
/** Storefront tracking page. No token in the URL on purpose — see below. */
function trackingUrl(): string {
  return `${storefrontOrigin()}/my-orders`;
}

/**
 * Link to the tracking page, deliberately WITHOUT an access token.
 *
 * A confirmation email is kept, forwarded and searched for years; embedding a
 * credential in it would make every archived copy a standing key to the
 * shopper's order history. The page asks for an email and mails a short-lived
 * link instead — one extra step, once, and from then on the browser session
 * carries it.
 */
function renderTrackingCta(locale: EmailLocale): string {
  return `
    <div style="margin-top:24px;padding-top:20px;border-top:1px solid ${BORDER}">
      <div style="font-size:14px;line-height:1.6;color:#374151;margin-bottom:12px">${esc(t(locale, "track_link_intro"))}</div>
      <a href="${esc(trackingUrl())}" style="display:inline-block;padding:12px 24px;background:${BRAND};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">${esc(t(locale, "track_cta"))}</a>
    </div>`;
}

export function renderCustomerOrderConfirmation(
  order: OrderEmailData,
  locale: EmailLocale,
  prescriptions?: Record<string, PrescriptionForEmail>
): RenderedEmail {
  const displayId = String(order.display_id ?? order.id);
  const name = customerName(order);
  const greeting = t(locale, "order_confirmation_greeting", {
    name: name ? ` ${name}` : "",
  });

  const inner = `
    <p style="margin:0 0 12px;font-size:16px;font-weight:600">${esc(greeting)}</p>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151">${esc(t(locale, "order_confirmation_intro"))}</p>
    <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:#ecfdf5;color:#047857;font-size:12px;font-weight:600">${esc(t(locale, "payment_confirmed"))}</div>
    <div style="margin-top:20px;font-size:14px;color:${MUTED}">
      ${esc(t(locale, "order_number"))} <strong style="color:#111827">#${esc(displayId)}</strong>
      &nbsp;·&nbsp; ${esc(formatDate(order.created_at, locale))}
    </div>
    ${renderItemsTable(order, locale)}
    ${renderPrescriptions(order, prescriptions, locale)}
    ${renderTotals(order, locale)}
    ${renderAddress(order, locale)}
    <div style="margin-top:28px;padding:16px;background:#f9fafb;border-radius:8px">
      <div style="font-size:14px;font-weight:600;margin-bottom:6px">${esc(t(locale, "order_confirmation_next_steps_title"))}</div>
      <div style="font-size:14px;line-height:1.6;color:#374151">${esc(t(locale, "order_confirmation_next_steps_body"))}</div>
    </div>
    ${renderTrackingCta(locale)}
    <p style="margin:20px 0 0;font-size:13px;color:${MUTED}">${esc(t(locale, "questions"))}</p>`;

  const text = [
    greeting,
    "",
    t(locale, "order_confirmation_intro"),
    "",
    ...textLines(order, locale),
    ...rxTextLines(order, prescriptions, locale),
    "",
    t(locale, "order_confirmation_next_steps_title"),
    t(locale, "order_confirmation_next_steps_body"),
    "",
    t(locale, "track_link_intro"),
    trackingUrl(),
    "",
    t(locale, "questions"),
  ].join("\n");

  const subject = t(locale, "order_confirmation_subject", { display_id: displayId });

  return {
    subject,
    html: shell(subject, t(locale, "order_confirmation_preheader"), inner, locale),
    text,
  };
}

/** Internal copy for the store inbox. Always rendered in the store locale. */
export function renderAdminOrderNotification(
  order: OrderEmailData,
  locale: EmailLocale,
  prescriptions?: Record<string, PrescriptionForEmail>
): RenderedEmail {
  const displayId = String(order.display_id ?? order.id);
  const total = formatMoney(order.total, order.currency_code, locale);
  const name = customerName(order);

  const hasPrescription = (order.items ?? []).some(
    (item) => item.metadata?.["prescription_id"]
  );

  const inner = `
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151">${esc(t(locale, "admin_order_intro"))}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
      <tr>
        <td style="padding:2px 16px 2px 0;color:${MUTED}">${esc(t(locale, "order_number"))}</td>
        <td style="padding:2px 0;font-weight:600">#${esc(displayId)}</td>
      </tr>
      <tr>
        <td style="padding:2px 16px 2px 0;color:${MUTED}">${esc(t(locale, "order_date"))}</td>
        <td style="padding:2px 0">${esc(formatDate(order.created_at, locale))}</td>
      </tr>
      <tr>
        <td style="padding:2px 16px 2px 0;color:${MUTED}">${esc(t(locale, "customer"))}</td>
        <td style="padding:2px 0">${esc(name ? `${name} · ${order.email ?? ""}` : order.email ?? "")}</td>
      </tr>
      <tr>
        <td style="padding:2px 16px 2px 0;color:${MUTED}">${esc(t(locale, "total"))}</td>
        <td style="padding:2px 0;font-weight:700">${esc(total)}</td>
      </tr>
    </table>
    ${hasPrescription ? `<div style="margin-top:16px;padding:10px 12px;background:#fef3c7;border-radius:8px;font-size:13px;color:#92400e">${esc(t(locale, "prescription_attached"))}</div>` : ""}
    ${renderItemsTable(order, locale)}
    ${renderPrescriptions(order, prescriptions, locale)}
    ${renderTotals(order, locale)}
    ${renderAddress(order, locale)}`;

  const text = [
    t(locale, "admin_order_intro"),
    "",
    `${t(locale, "customer")}: ${name ? `${name} · ` : ""}${order.email ?? ""}`,
    ...(hasPrescription ? [t(locale, "prescription_attached")] : []),
    "",
    ...textLines(order, locale),
    ...rxTextLines(order, prescriptions, locale),
  ].join("\n");

  const subject = t(locale, "admin_order_subject", { display_id: displayId, total });

  return {
    subject,
    html: shell(t(locale, "admin_order_title"), subject, inner, locale),
    text,
  };
}

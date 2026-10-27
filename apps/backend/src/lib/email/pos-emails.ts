import type { EmailLocale } from "./copy";
import { esc, shell, type RenderedEmail } from "./order-confirmation";

/**
 * Emails of the point of sale. Copy is kept here, in both languages, like
 * copy.ts does for the web emails. None of them carries prescription values,
 * insurance member data or the customer's personal data.
 */

const COPY = {
  es: {
    approval_subject: "ACCIÓN: descuento por aprobar · {store} · {pct} %",
    approval_title: "Descuento por aprobar",
    approval_intro: "{seller} pide aplicar un descuento que necesita tu aprobación. Decide desde el panel; la venta espera tu respuesta.",
    approval_store: "Tienda",
    approval_seller: "Vendedor",
    approval_pct: "Descuento pedido",
    approval_limit: "Su límite",
    approval_no_limit: "sin límite",
    approval_below_min: "Deja algún producto por debajo de su precio mínimo",
    approval_list: "Precio de lista",
    approval_total: "Total con descuento",
    approval_lines: "Productos",
    approval_reason: "Motivo",
    approval_none: "—",
    approval_cta: "Aprobar o rechazar",
    approval_expires: "La solicitud caduca a las 24 horas.",
    own_frame: "Montura propia del cliente",
  },
  en: {
    approval_subject: "ACTION: discount to approve · {store} · {pct}%",
    approval_title: "Discount to approve",
    approval_intro: "{seller} asks to apply a discount that needs your approval. Decide from the panel; the sale is waiting for your answer.",
    approval_store: "Store",
    approval_seller: "Seller",
    approval_pct: "Discount asked",
    approval_limit: "Their limit",
    approval_no_limit: "no limit",
    approval_below_min: "Takes a product below its minimum price",
    approval_list: "List price",
    approval_total: "Total after discount",
    approval_lines: "Products",
    approval_reason: "Reason",
    approval_none: "—",
    approval_cta: "Approve or reject",
    approval_expires: "The request expires after 24 hours.",
    own_frame: "Patient's own frame",
  },
} as const;

type Key = keyof (typeof COPY)["es"];

export function posT(locale: EmailLocale, key: Key, vars: Record<string, string | number> = {}): string {
  let s: string = COPY[locale][key];
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

const money = (v: number, locale: EmailLocale) =>
  new Intl.NumberFormat(locale === "en" ? "en-US" : "es-US", { style: "currency", currency: "USD" }).format(v);

const row = (label: string, value: string) =>
  `<tr><td style="padding:8px 0;border-bottom:1px solid #e7eaf0;color:#5b6472;font-size:13px;width:42%">${esc(label)}</td><td style="padding:8px 0;border-bottom:1px solid #e7eaf0;font-size:14px;font-weight:600">${esc(value)}</td></tr>`;

export interface ApprovalEmailData {
  storeCode: string;
  storeName: string;
  seller: string;
  pct: number;
  limitPct: number | null;
  belowMinimum: boolean;
  list: number;
  total: number;
  lines: Array<{ title: string; list: number }>;
  reason: string | null;
  link: string;
}

export function renderApprovalRequestEmail(d: ApprovalEmailData, locale: EmailLocale): RenderedEmail {
  const subject = posT(locale, "approval_subject", { store: d.storeCode, pct: d.pct });
  const intro = posT(locale, "approval_intro", { seller: d.seller });
  const limit = d.limitPct === null ? posT(locale, "approval_no_limit") : `${d.limitPct} %`;
  const lines = d.lines.map((l) => `${l.title || posT(locale, "own_frame")} · ${money(l.list, locale)}`);
  const inner = `
    <div style="font-size:15px;line-height:1.7;color:#374151">${esc(intro)}</div>
    ${d.belowMinimum ? `<div style="margin-top:14px;padding:12px 14px;background:#fef2f2;border-left:3px solid #dc2626;border-radius:6px;font-size:14px;color:#991b1b">${esc(posT(locale, "approval_below_min"))}</div>` : ""}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:18px">
      ${row(posT(locale, "approval_store"), `${d.storeCode} · ${d.storeName}`)}
      ${row(posT(locale, "approval_seller"), d.seller)}
      ${row(posT(locale, "approval_pct"), `${d.pct} %`)}
      ${row(posT(locale, "approval_limit"), limit)}
      ${row(posT(locale, "approval_list"), money(d.list, locale))}
      ${row(posT(locale, "approval_total"), money(d.total, locale))}
      ${row(posT(locale, "approval_lines"), lines.join(" — "))}
      ${row(posT(locale, "approval_reason"), d.reason || posT(locale, "approval_none"))}
    </table>
    <div style="margin-top:24px;text-align:center">
      <a href="${esc(d.link)}" style="display:inline-block;background:#0b2f66;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px">${esc(posT(locale, "approval_cta"))}</a>
    </div>
    <div style="margin-top:14px;font-size:12px;color:#5b6472;text-align:center">${esc(posT(locale, "approval_expires"))}</div>`;
  return {
    subject,
    html: shell(posT(locale, "approval_title"), intro, inner, locale),
    text: [
      intro,
      "",
      `${posT(locale, "approval_store")}: ${d.storeCode} · ${d.storeName}`,
      `${posT(locale, "approval_seller")}: ${d.seller}`,
      `${posT(locale, "approval_pct")}: ${d.pct} %`,
      `${posT(locale, "approval_limit")}: ${limit}`,
      ...(d.belowMinimum ? [posT(locale, "approval_below_min")] : []),
      `${posT(locale, "approval_list")}: ${money(d.list, locale)}`,
      `${posT(locale, "approval_total")}: ${money(d.total, locale)}`,
      `${posT(locale, "approval_lines")}: ${lines.join(" — ")}`,
      `${posT(locale, "approval_reason")}: ${d.reason || posT(locale, "approval_none")}`,
      "",
      `${posT(locale, "approval_cta")}: ${d.link}`,
    ].join("\n"),
  };
}

import type { EmailLocale } from "./copy";
import type { SaleDocument } from "../pos-documents";
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
    receipt_subject: "Tu recibo {number} · {store}",
    receipt_title: "Recibo de tu compra",
    receipt_intro: "Gracias por tu compra en {store}. Este es tu recibo.",
    receipt_sale: "Venta",
    receipt_date: "Fecha",
    receipt_served: "Le atendió",
    receipt_customer: "Cliente",
    receipt_discount: "Descuento {pct} %",
    receipt_tax: "Impuesto de venta",
    receipt_total: "Total",
    receipt_paid_deposit: "Anticipo",
    receipt_paid_balance: "Pago del saldo",
    receipt_refund: "Devolución",
    receipt_insurance: "Cubre el seguro",
    receipt_balance: "Saldo al recoger",
    receipt_promised: "Fecha estimada",
    receipt_tray: "Bandeja",
    receipt_track: "Ver el estado de tu pedido",
    receipt_no_rx: "Por privacidad, este recibo no incluye los valores de tu receta. Si los necesitas, pídelos en la tienda.",
    receipt_voided: "VENTA ANULADA",
    method_debit: "Tarjeta de débito",
    method_credit: "Tarjeta de crédito",
    method_zelle: "Zelle",
    method_cash: "Efectivo",
    method_insurance: "Seguro médico",
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
    receipt_subject: "Your receipt {number} · {store}",
    receipt_title: "Your purchase receipt",
    receipt_intro: "Thank you for your purchase at {store}. Here is your receipt.",
    receipt_sale: "Sale",
    receipt_date: "Date",
    receipt_served: "Served by",
    receipt_customer: "Customer",
    receipt_discount: "Discount {pct}%",
    receipt_tax: "Sales tax",
    receipt_total: "Total",
    receipt_paid_deposit: "Deposit",
    receipt_paid_balance: "Balance payment",
    receipt_refund: "Refund",
    receipt_insurance: "Covered by insurance",
    receipt_balance: "Balance due at pickup",
    receipt_promised: "Estimated date",
    receipt_tray: "Tray",
    receipt_track: "Check your order status",
    receipt_no_rx: "For your privacy, this receipt does not include your prescription values. Ask at the store if you need them.",
    receipt_voided: "SALE VOIDED",
    method_debit: "Debit card",
    method_credit: "Credit card",
    method_zelle: "Zelle",
    method_cash: "Cash",
    method_insurance: "Medical insurance",
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

const METHOD_KEYS: Record<string, Key> = {
  debit: "method_debit",
  credit: "method_credit",
  zelle: "method_zelle",
  cash: "method_cash",
  insurance: "method_insurance",
};

/** The customer's receipt (HU-27, HU-102): no prescription, no insurance member data. */
export function renderReceiptEmail(doc: SaleDocument, locale: EmailLocale): RenderedEmail {
  const storeLabel = `${doc.business.name} · ${doc.store.name}`;
  const subject = posT(locale, "receipt_subject", { number: doc.sale.number, store: doc.store.name });
  const intro = posT(locale, "receipt_intro", { store: storeLabel });
  const when = new Date(doc.sale.created_at).toLocaleString(locale === "en" ? "en-US" : "es-US", { dateStyle: "medium", timeStyle: "short" });
  const lbl = (b: { es: string; en: string } | null) => (b ? b[locale] : "");
  const lines = (doc.lines ?? []).map((l) => {
    const name = l.kind === "own_frame" ? `${posT(locale, "own_frame")}${l.title ? ` (${l.title})` : ""}` : [l.title, l.variant_title].filter(Boolean).join(" · ");
    const lens = l.lens ? [lbl(l.lens.design), lbl(l.lens.material), lbl(l.lens.photo), lbl(l.lens.ar)].filter(Boolean).join(" · ") : "";
    return { name, lens, price: l.unit_price };
  });
  const tot = doc.totals!;
  const pays = (doc.payments ?? []).map((p) => {
    const method = p.method ? p.method[locale] : METHOD_KEYS[p.method_code] ? posT(locale, METHOD_KEYS[p.method_code]) : p.method_code;
    const kind: Key =
      p.kind === "refund" ? "receipt_refund" : p.method_code === "insurance" ? "receipt_insurance" : p.kind === "balance" ? "receipt_paid_balance" : "receipt_paid_deposit";
    return { label: `${posT(locale, kind)} (${method})`, amount: p.amount };
  });
  const itemRows = lines
    .map(
      (l) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #e7eaf0;font-size:14px"><b>${esc(l.name)}</b>${l.lens ? `<div style="color:#5b6472;font-size:12.5px">${esc(l.lens)}</div>` : ""}</td><td style="padding:8px 0;border-bottom:1px solid #e7eaf0;font-size:14px;text-align:right;white-space:nowrap">${esc(money(l.price, locale))}</td></tr>`
    )
    .join("");
  const sum = (label: string, value: string, strong = false) =>
    `<tr><td style="padding:5px 0;font-size:${strong ? 16 : 14}px;${strong ? "font-weight:800" : "color:#5b6472"}">${esc(label)}</td><td style="padding:5px 0;text-align:right;font-size:${strong ? 16 : 14}px;${strong ? "font-weight:800" : ""}">${esc(value)}</td></tr>`;
  const inner = `
    ${doc.sale.status === "voided" ? `<div style="padding:10px 14px;background:#fef2f2;color:#991b1b;font-weight:800;border-radius:6px;margin-bottom:12px">${esc(posT(locale, "receipt_voided"))}</div>` : ""}
    <div style="font-size:15px;line-height:1.7;color:#374151">${esc(intro)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:16px">
      ${row(posT(locale, "receipt_sale"), doc.sale.number)}
      ${row(posT(locale, "receipt_date"), when)}
      ${doc.sale.seller_code ? row(posT(locale, "receipt_served"), `${doc.sale.seller_code}${doc.terminal.code ? ` · ${doc.terminal.code}` : ""}`) : ""}
      ${doc.customer.name ? row(posT(locale, "receipt_customer"), doc.customer.name) : ""}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:16px">${itemRows}</table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:10px">
      ${tot.discount > 0 ? sum(posT(locale, "receipt_discount", { pct: tot.discount_pct }), `−${money(tot.discount, locale)}`) : ""}
      ${tot.tax > 0 ? sum(posT(locale, "receipt_tax"), money(tot.tax, locale)) : ""}
      ${sum(posT(locale, "receipt_total"), money(tot.total, locale), true)}
      ${pays.map((p) => sum(p.label, money(p.amount, locale))).join("")}
      ${sum(posT(locale, "receipt_balance"), money(tot.balance, locale), true)}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:16px">
      ${doc.sale.promised_on ? row(posT(locale, "receipt_promised"), doc.sale.promised_on) : ""}
      ${doc.sale.tray ? row(posT(locale, "receipt_tray"), doc.sale.tray) : ""}
    </table>
    <div style="margin-top:22px;text-align:center"><a href="${esc(doc.tracking_url)}" style="display:inline-block;background:#0b2f66;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:10px">${esc(posT(locale, "receipt_track"))}</a></div>
    ${doc.store.receipt_note ? `<div style="margin-top:20px;font-size:12px;color:#5b6472;line-height:1.6">${esc(doc.store.receipt_note)}</div>` : ""}
    <div style="margin-top:12px;font-size:12px;color:#5b6472">${esc(posT(locale, "receipt_no_rx"))}</div>`;
  return {
    subject,
    html: shell(posT(locale, "receipt_title"), intro, inner, locale),
    text: [
      intro,
      "",
      `${posT(locale, "receipt_sale")}: ${doc.sale.number}`,
      `${posT(locale, "receipt_date")}: ${when}`,
      ...lines.map((l) => `${l.name}${l.lens ? ` — ${l.lens}` : ""}: ${money(l.price, locale)}`),
      ...(tot.discount > 0 ? [`${posT(locale, "receipt_discount", { pct: tot.discount_pct })}: −${money(tot.discount, locale)}`] : []),
      `${posT(locale, "receipt_total")}: ${money(tot.total, locale)}`,
      ...pays.map((p) => `${p.label}: ${money(p.amount, locale)}`),
      `${posT(locale, "receipt_balance")}: ${money(tot.balance, locale)}`,
      ...(doc.sale.promised_on ? [`${posT(locale, "receipt_promised")}: ${doc.sale.promised_on}`] : []),
      "",
      `${posT(locale, "receipt_track")}: ${doc.tracking_url}`,
      ...(doc.store.receipt_note ? ["", doc.store.receipt_note] : []),
    ].join("\n"),
  };
}

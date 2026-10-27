import type { EmailLocale } from "./copy";
import { esc, shell, type RenderedEmail } from "./order-confirmation";

/**
 * Alert emails (functional document E7). Display data only: sale number,
 * store, amounts, seller code, reason — never prescription or insurance data,
 * never the customer's contact details.
 */
const COPY = {
  es: {
    "sale.created": "Nueva venta en {store}: {total}{seller}",
    "discount.applied": "Descuento de {pct} % en {store}: venta {number}{seller}",
    "discount.requested": "Descuento de {pct} % por aprobar en {store}{seller}",
    "sale.below_min": "Venta bajo el precio mínimo en {store}: {number} ({total}){seller}",
    "sale.voided": "Venta {number} anulada en {store}: {reason}{seller}",
    "cash.diff": "Diferencia de caja en {store}: {amount}",
    "store.idle": "{store} no tiene ventas hoy (desde las {after})",
    "web.store": "tienda online",
    by: " · {seller}",
    subject_many: "{name}: {n} avisos",
    title: "Aviso de ventas",
    intro_many: "Resumen de la regla «{name}»:",
    digest_subject: "{name} · {date}: {n} ventas, {total}",
    digest_title: "Resumen de ventas",
    digest_intro: "Ventas desde {since} hasta ahora.",
    digest_store: "Tienda",
    digest_seller: "Vendedor",
    digest_count: "Ventas",
    digest_total: "Total",
    digest_voided: "Anuladas",
    digest_none: "No hubo ventas en este periodo.",
    footer: "Recibes este aviso porque tu dirección está en la regla «{name}». Quien la creó o editó puede quitarla.",
    panel: "Abrir el panel",
  },
  en: {
    "sale.created": "New sale at {store}: {total}{seller}",
    "discount.applied": "{pct}% discount at {store}: sale {number}{seller}",
    "discount.requested": "{pct}% discount to approve at {store}{seller}",
    "sale.below_min": "Sale below the minimum price at {store}: {number} ({total}){seller}",
    "sale.voided": "Sale {number} voided at {store}: {reason}{seller}",
    "cash.diff": "Cash difference at {store}: {amount}",
    "store.idle": "{store} has no sales today (since {after})",
    "web.store": "online store",
    by: " · {seller}",
    subject_many: "{name}: {n} alerts",
    title: "Sales alert",
    intro_many: "Summary of the rule “{name}”:",
    digest_subject: "{name} · {date}: {n} sales, {total}",
    digest_title: "Sales summary",
    digest_intro: "Sales from {since} until now.",
    digest_store: "Store",
    digest_seller: "Seller",
    digest_count: "Sales",
    digest_total: "Total",
    digest_voided: "Voided",
    digest_none: "There were no sales in this period.",
    footer: "You get this alert because your address is on the rule “{name}”. Whoever created or edited it can remove it.",
    panel: "Open the panel",
  },
} as const;

type Key = keyof (typeof COPY)["es"];
const tt = (l: EmailLocale, k: Key, v: Record<string, string | number> = {}) => {
  let s: string = COPY[l][k];
  for (const [a, b] of Object.entries(v)) s = s.split(`{${a}}`).join(String(b));
  return s;
};
const money = (v: unknown, l: EmailLocale) =>
  new Intl.NumberFormat(l === "en" ? "en-US" : "es-US", { style: "currency", currency: "USD" }).format(Number(v ?? 0));

const VOID_REASONS: Record<string, { es: string; en: string }> = {
  customer_changed_mind: { es: "el cliente cambió de opinión", en: "customer changed their mind" },
  wrong_entry: { es: "error al registrar", en: "entry error" },
  price_error: { es: "error de precio", en: "price error" },
  duplicate: { es: "venta duplicada", en: "duplicate sale" },
  lab_cannot_make: { es: "el laboratorio no puede hacerla", en: "the lab cannot make it" },
  other: { es: "otro", en: "other" },
};

/** One line describing an event. */
export function alertLine(event: string, data: Record<string, unknown>, locale: EmailLocale): string {
  const store = data.is_web ? tt(locale, "web.store") : [data.store_code, data.store_name].filter(Boolean).join(" · ");
  const seller = data.seller_code ? tt(locale, "by", { seller: String(data.seller_code) }) : "";
  const reason = data.reason ? VOID_REASONS[String(data.reason)]?.[locale] ?? String(data.reason) : "";
  const key = (event in COPY.es ? event : "sale.created") as Key;
  return tt(locale, key, {
    store,
    seller,
    total: money(data.total, locale),
    amount: money(data.amount, locale),
    pct: Number(data.discount_pct ?? 0),
    number: String(data.number ?? ""),
    reason,
    after: String(data.after ?? ""),
  });
}

export function renderAlertEmail(
  rule: { name: string },
  events: Array<{ event: string; data: Record<string, unknown> }>,
  locale: EmailLocale,
  panelUrl: string
): RenderedEmail {
  const lines = events.map((e) => alertLine(e.event, e.data, locale));
  const subject = lines.length === 1 ? lines[0] : tt(locale, "subject_many", { name: rule.name, n: lines.length });
  const intro = lines.length === 1 ? lines[0] : tt(locale, "intro_many", { name: rule.name });
  const inner = `
    ${lines.length > 1 ? `<div style="font-size:15px;color:#374151">${esc(intro)}</div>` : ""}
    <ul style="margin:12px 0 0;padding-left:18px;font-size:15px;line-height:1.7;color:#1e2733">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    <div style="margin-top:20px"><a href="${esc(panelUrl)}" style="color:#0b2f66;font-weight:700">${esc(tt(locale, "panel"))}</a></div>
    <div style="margin-top:18px;font-size:12px;color:#5b6472">${esc(tt(locale, "footer", { name: rule.name }))}</div>`;
  return {
    subject,
    html: shell(tt(locale, "title"), intro, inner, locale),
    text: [...lines, "", panelUrl, "", tt(locale, "footer", { name: rule.name })].join("\n"),
  };
}

export interface DigestData {
  since: string;
  date: string;
  stores: Array<{ label: string; count: number; total: number; voided: number }>;
  sellers: Array<{ label: string; count: number; total: number }>;
  count: number;
  total: number;
}

/** Periodic summary by store and seller (HU-43). */
export function renderDigestEmail(rule: { name: string }, d: DigestData, locale: EmailLocale, panelUrl: string): RenderedEmail {
  const subject = tt(locale, "digest_subject", { name: rule.name, date: d.date, n: d.count, total: money(d.total, locale) });
  const intro = tt(locale, "digest_intro", { since: d.since });
  const table = (head: string[], rows: string[][]) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:14px;font-size:14px">
      <tr>${head.map((h, i) => `<th style="text-align:${i ? "right" : "left"};border-bottom:2px solid #e7eaf0;padding:6px 0;color:#5b6472">${esc(h)}</th>`).join("")}</tr>
      ${rows.map((r) => `<tr>${r.map((c, i) => `<td style="text-align:${i ? "right" : "left"};border-bottom:1px solid #e7eaf0;padding:6px 0">${esc(c)}</td>`).join("")}</tr>`).join("")}
    </table>`;
  const body =
    d.count === 0
      ? `<p style="font-size:15px">${esc(tt(locale, "digest_none"))}</p>`
      : `${table([tt(locale, "digest_store"), tt(locale, "digest_count"), tt(locale, "digest_total"), tt(locale, "digest_voided")], [
          ...d.stores.map((s) => [s.label, String(s.count), money(s.total, locale), String(s.voided)]),
          ["", String(d.count), money(d.total, locale), ""],
        ])}
        ${d.sellers.length ? table([tt(locale, "digest_seller"), tt(locale, "digest_count"), tt(locale, "digest_total")], d.sellers.map((s) => [s.label, String(s.count), money(s.total, locale)])) : ""}`;
  const inner = `<div style="font-size:15px;color:#374151">${esc(intro)}</div>${body}
    <div style="margin-top:20px"><a href="${esc(panelUrl)}" style="color:#0b2f66;font-weight:700">${esc(tt(locale, "panel"))}</a></div>
    <div style="margin-top:18px;font-size:12px;color:#5b6472">${esc(tt(locale, "footer", { name: rule.name }))}</div>`;
  return {
    subject,
    html: shell(tt(locale, "digest_title"), intro, inner, locale),
    text: [
      intro,
      ...d.stores.map((s) => `${s.label}: ${s.count} · ${money(s.total, locale)}`),
      ...d.sellers.map((s) => `${s.label}: ${s.count} · ${money(s.total, locale)}`),
      "",
      panelUrl,
    ].join("\n"),
  };
}

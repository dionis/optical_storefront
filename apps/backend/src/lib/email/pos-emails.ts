import type { EmailLocale } from "./copy";
import type { SaleDocument } from "../pos-documents";
import type { ImageRef } from "./order-images";
import { esc, renderPrescriptions, renderRxGlossary, rxTextLines, shell, type OrderEmailData, type PrescriptionForEmail, type RenderedEmail } from "./order-confirmation";
import { colorCircle, storeBanner } from "../store-color";

/**
 * Emails of the point of sale. Copy is kept here, in both languages, like
 * copy.ts does for the web emails. The discount request carries no customer data.
 * The receipt is simple unless someone asks for the details: only then does it
 * carry photos and the prescription (HIPAA, owner's decision). Never insurance
 * member data, the worn prescription or the optical change.
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
    receipt_store: "Tienda",
    receipt_phone: "Teléfono",
    receipt_delivery: "Entrega",
    receipt_pickup: "Recoger en la tienda",
    receipt_ship: "Envío a tu dirección",
    receipt_code: "Código",
    receipt_frame: "Montura",
    receipt_lenses: "Lentes",
    receipt_brand: "Marca",
    receipt_size: "Medida",
    receipt_frame_only: "Solo montura",
    receipt_list: "Subtotal (precio de lista)",
    receipt_items: "Tu compra",
    receipt_keep_rx: "Este correo incluye los datos de tu receta: guárdalo y compártelo solo con quien tú decidas.",
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
    receipt_store: "Store",
    receipt_phone: "Phone",
    receipt_delivery: "Delivery",
    receipt_pickup: "Pick up at the store",
    receipt_ship: "Shipping to your address",
    receipt_code: "Code",
    receipt_frame: "Frame",
    receipt_lenses: "Lenses",
    receipt_brand: "Brand",
    receipt_size: "Size",
    receipt_frame_only: "Frame only",
    receipt_list: "Subtotal (list price)",
    receipt_items: "Your purchase",
    receipt_keep_rx: "This email includes your prescription: keep it, and share it only with whom you choose.",
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
  storeColor?: string | null;
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
  const subject = `${d.storeColor ? `${colorCircle(d.storeColor)} ` : ""}${posT(locale, "approval_subject", { store: d.storeCode, pct: d.pct })}`;
  const intro = posT(locale, "approval_intro", { seller: d.seller });
  const limit = d.limitPct === null ? posT(locale, "approval_no_limit") : `${d.limitPct} %`;
  const lines = d.lines.map((l) => `${l.title || posT(locale, "own_frame")} · ${money(l.list, locale)}`);
  const inner = `
    ${d.storeColor ? storeBanner({ code: d.storeCode, name: d.storeName, color: d.storeColor }) : ""}
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
    html: shell(posT(locale, "approval_title"), intro, inner, locale, { accent: d.storeColor }),
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

export interface ReceiptExtras {
  prescriptions?: Record<string, PrescriptionForEmail>;
  /** Attached photos of the frames the customer brought, by line position. */
  itemImages?: Record<number, ImageRef>;
  /** Photos, prescription and every purchase detail. Off unless explicitly true. */
  detailed?: boolean;
}

/**
 * The customer's receipt (HU-27, HU-102). Simple by default: what was bought and
 * paid. Detailed only when asked for. No insurance member data in either.
 */
export function renderReceiptEmail(doc: SaleDocument, locale: EmailLocale, extras: ReceiptExtras = {}): RenderedEmail {
  const storeLabel = `${doc.business.name} · ${doc.store.name}`;
  const subject = posT(locale, "receipt_subject", { number: doc.sale.number, store: doc.store.name });
  const intro = posT(locale, "receipt_intro", { store: storeLabel });
  // In the store's timezone: the server clock is UTC and a 6 pm sale in Texas
  // would otherwise read as midnight of the next day.
  const when = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-US", { timeZone: doc.business.timezone || "UTC", dateStyle: "medium", timeStyle: "short" }).format(new Date(doc.sale.created_at));
  const lbl = (b: { es: string; en: string } | null) => (b ? b[locale] : "");
  const detailed = extras.detailed === true;
  const lines = (doc.lines ?? []).map((l, i) => {
    const name = l.kind === "own_frame" ? `${posT(locale, "own_frame")}${l.title ? ` (${l.title})` : ""}` : [l.title, l.variant_title].filter(Boolean).join(" · ");
    const lens = l.lens ? [lbl(l.lens.design), lbl(l.lens.material), lbl(l.lens.photo), lbl(l.lens.ar)].filter(Boolean).join(" · ") : "";
    const size = l.frame?.eye_size ? [l.frame.eye_size, l.frame.bridge].filter(Boolean).join("-") : "";
    const specs = [l.sku && `${posT(locale, "receipt_code")}: ${l.sku}`, l.frame?.brand && `${posT(locale, "receipt_brand")}: ${l.frame.brand}`, size && `${posT(locale, "receipt_size")}: ${size}`].filter(Boolean).join(" · ");
    const parts = [l.kind === "frame" && l.frame_price > 0 && `${posT(locale, "receipt_frame")}: ${money(l.frame_price, locale)}`, l.lens_price > 0 && `${posT(locale, "receipt_lenses")}: ${money(l.lens_price, locale)}`, l.tax_amount > 0 && `${posT(locale, "receipt_tax")}: ${money(l.tax_amount, locale)}`].filter(Boolean).join(" · ");
    // Each line shows its LIST price: the lines add up to the subtotal, then the
    // discount and the tax are taken once, visibly. (Showing the already
    // discounted price and then "−discount" again read as a double discount.)
    if (!detailed) return { name, lens, specs: "", parts: "", price: l.list, image: null, cid: null };
    return { name, lens: lens || (l.design_code === "frame-only" ? posT(locale, "receipt_frame_only") : ""), specs, parts, price: l.list, image: l.image_url ?? null, cid: extras.itemImages?.[i]?.cid ?? null };
  });
  // The shared prescription block, fed with this sale's lines.
  const orderLike = {
    id: doc.sale.id,
    items: (doc.lines ?? []).map((l) => ({ title: l.kind === "own_frame" ? posT(locale, "own_frame") : l.title, variant_title: l.variant_title, metadata: { prescription_id: l.prescription_id } })),
  } as unknown as OrderEmailData;
  const showRx = detailed && (doc.lines ?? []).some((l) => l.prescription_id);
  const rxList = Object.values(extras.prescriptions ?? {});
  const hasHeight = rxList.some((rx) => rx.seg_height != null);
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
        `<tr>${detailed ? `<td width="112" style="padding:10px 12px 10px 0;border-bottom:1px solid #e7eaf0;vertical-align:top">${l.image || l.cid ? `<img src="${esc(l.cid ? `cid:${l.cid}` : String(l.image))}" width="100" alt="${esc(l.name)}" style="display:block;width:100px;max-width:100%;height:auto;border:0;border-radius:6px">` : ""}</td>` : ""}<td style="padding:10px 0;border-bottom:1px solid #e7eaf0;font-size:14px;vertical-align:top"><b>${esc(l.name)}</b>${l.specs ? `<div style="color:#5b6472;font-size:12.5px">${esc(l.specs)}</div>` : ""}${l.lens ? `<div style="color:#374151;font-size:12.5px;margin-top:2px">${esc(l.lens)}</div>` : ""}${l.parts ? `<div style="color:#5b6472;font-size:12.5px;margin-top:2px">${esc(l.parts)}</div>` : ""}</td><td style="padding:10px 0 10px 10px;border-bottom:1px solid #e7eaf0;font-size:14px;font-weight:700;text-align:right;white-space:nowrap;vertical-align:top">${esc(money(l.price, locale))}</td></tr>`
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
      ${detailed ? row(posT(locale, "receipt_store"), [doc.store.name, doc.store.address].filter(Boolean).join(" · ")) : ""}
      ${detailed && doc.store.phone ? row(posT(locale, "receipt_phone"), doc.store.phone) : ""}
    </table>
    ${detailed ? `<div style="margin-top:18px;font-size:15px;font-weight:800;color:#0b2f66">${esc(posT(locale, "receipt_items"))}</div>` : ""}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:${detailed ? 6 : 16}px">${itemRows}</table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:10px">
      ${tot.discount > 0 || tot.tax > 0 ? sum(posT(locale, "receipt_list"), money(tot.list, locale)) : ""}
      ${tot.discount > 0 ? sum(posT(locale, "receipt_discount", { pct: tot.discount_pct }), `−${money(tot.discount, locale)}`) : ""}
      ${tot.tax > 0 ? sum(posT(locale, "receipt_tax"), money(tot.tax, locale)) : ""}
      ${sum(posT(locale, "receipt_total"), money(tot.total, locale), true)}
      ${pays.map((p) => sum(p.label, money(p.amount, locale))).join("")}
      ${sum(posT(locale, "receipt_balance"), money(tot.balance, locale), true)}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:16px">
      ${detailed ? row(posT(locale, "receipt_delivery"), posT(locale, doc.sale.delivery === "ship" ? "receipt_ship" : "receipt_pickup")) : ""}
      ${doc.sale.promised_on ? row(posT(locale, "receipt_promised"), doc.sale.promised_on) : ""}
      ${doc.sale.tray ? row(posT(locale, "receipt_tray"), doc.sale.tray) : ""}
    </table>
    <div style="margin-top:22px;text-align:center"><a href="${esc(doc.tracking_url)}" style="display:inline-block;background:#0b2f66;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:10px">${esc(posT(locale, "receipt_track"))}</a></div>
    ${showRx ? renderPrescriptions(orderLike, extras.prescriptions ?? {}, locale) : ""}
    ${showRx ? renderRxGlossary(rxList.length > 0, hasHeight, locale) : ""}
    ${doc.store.receipt_note ? `<div style="margin-top:20px;font-size:12px;color:#5b6472;line-height:1.6">${esc(doc.store.receipt_note)}</div>` : ""}
    ${detailed ? "" : `<div style="margin-top:12px;font-size:12px;color:#5b6472">${esc(posT(locale, "receipt_no_rx"))}</div>`}
    ${showRx ? `<div style="margin-top:12px;font-size:12px;color:#5b6472">${esc(posT(locale, "receipt_keep_rx"))}</div>` : ""}`;
  return {
    subject,
    html: shell(posT(locale, "receipt_title"), intro, inner, locale),
    text: [
      intro,
      "",
      `${posT(locale, "receipt_sale")}: ${doc.sale.number}`,
      `${posT(locale, "receipt_date")}: ${when}`,
      ...(detailed ? [`${posT(locale, "receipt_store")}: ${[doc.store.name, doc.store.address, doc.store.phone].filter(Boolean).join(" · ")}`] : []),
      "",
      ...lines.flatMap((l) => [`${l.name}: ${money(l.price, locale)}`, ...[l.specs, l.lens, l.parts].filter(Boolean).map((x) => `  ${x}`)]),
      "",
      ...(tot.discount > 0 || tot.tax > 0 ? [`${posT(locale, "receipt_list")}: ${money(tot.list, locale)}`] : []),
      ...(tot.discount > 0 ? [`${posT(locale, "receipt_discount", { pct: tot.discount_pct })}: −${money(tot.discount, locale)}`] : []),
      ...(tot.tax > 0 ? [`${posT(locale, "receipt_tax")}: ${money(tot.tax, locale)}`] : []),
      `${posT(locale, "receipt_total")}: ${money(tot.total, locale)}`,
      ...pays.map((p) => `${p.label}: ${money(p.amount, locale)}`),
      `${posT(locale, "receipt_balance")}: ${money(tot.balance, locale)}`,
      ...(detailed ? [`${posT(locale, "receipt_delivery")}: ${posT(locale, doc.sale.delivery === "ship" ? "receipt_ship" : "receipt_pickup")}`] : []),
      ...(doc.sale.promised_on ? [`${posT(locale, "receipt_promised")}: ${doc.sale.promised_on}`] : []),
      "",
      `${posT(locale, "receipt_track")}: ${doc.tracking_url}`,
      ...(showRx ? rxTextLines(orderLike, extras.prescriptions ?? {}, locale) : []),
      ...(doc.store.receipt_note ? ["", doc.store.receipt_note] : []),
      ...(detailed ? [] : ["", posT(locale, "receipt_no_rx")]),
      ...(showRx ? ["", posT(locale, "receipt_keep_rx")] : []),
    ].join("\n"),
  };
}

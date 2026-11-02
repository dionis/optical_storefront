import type { INotificationModuleService, Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { buildCashDocument, type CashDocument, type CashDocumentKind } from "../cash-documents";
import { recordAudit } from "../audit";
import { resolveStoreSettings } from "../store-settings";
import { colorCircle, storeBanner } from "../store-color";
import { tenant } from "../tenant";
import type { EmailLocale } from "./copy";
import { BORDER, esc, MUTED, shell, type RenderedEmail } from "./order-confirmation";

/**
 * The opening and closing of a store's cash register, mailed to the owner and
 * the admin notification list (owner: "a double report emailed to the owner,
 * for both the close and the opening"). The HTML wears the store's colour
 * band like every internal store email. Failures are logged, never thrown to
 * the till (lib/cash.ts notify()).
 */

const COPY = {
  es: {
    open_subject: "Apertura de caja · {store} · {date}",
    close_subject: "Cierre de caja · {store} · {date} · diferencia {diff}",
    open_title: "Apertura de caja",
    close_title: "Cierre de caja",
    open_intro: "{who} abrió la caja de {store} el {when} con un fondo de {opening}.",
    close_intro: "{who} cerró la caja de {store} el {when}: debía haber {expected}, contó {counted}.",
    auto: "apertura automática con el primer cobro en efectivo",
    store: "Tienda",
    opened: "Apertura",
    closed: "Cierre",
    by: "Firma",
    opening: "Fondo inicial",
    cash_payments: "Cobros en efectivo",
    refunds: "Devoluciones en efectivo",
    manual_in: "Entradas manuales",
    manual_out: "Salidas manuales",
    expected: "Debe haber",
    counted: "Contado",
    diff: "Diferencia",
    balanced: "La caja cuadra.",
    pending: "Hay una diferencia: el cierre queda pendiente de la autorización del dueño.",
    approved: "Diferencia autorizada por {who} ({signature}) el {when}.",
    by_terminal: "Efectivo por punto de venta",
    by_seller: "Efectivo por persona",
    manual: "Movimientos manuales",
    movements: "Detalle de movimientos",
    col_when: "Hora",
    col_till: "Caja",
    col_type: "Tipo",
    col_reason: "Motivo",
    col_sale: "Venta",
    col_who: "Quién",
    col_amount: "Monto",
    col_count: "Nº",
    in: "Entrada",
    out: "Salida",
    none: "Sin movimientos.",
    note: "Nota",
    copies: "Este documento se imprime por duplicado en la tienda (copia de la tienda y copia de quien cierra).",
    footer: "Recibes este correo porque tu dirección está en la lista de avisos a administradores.",
    cat: {
      sale_payment: "Cobro en efectivo",
      sale_refund: "Devolución en efectivo",
      opening_float: "Fondo inicial",
      supplier_payment: "Pago a proveedor",
      expense: "Gasto",
      owner_withdrawal: "Retiro del dueño",
      bank_deposit: "Depósito al banco",
      change_fund: "Fondo de cambio",
      refund: "Devolución",
      correction: "Corrección",
      other: "Otro",
    } as Record<string, string>,
  },
  en: {
    open_subject: "Register opening · {store} · {date}",
    close_subject: "Register closing · {store} · {date} · difference {diff}",
    open_title: "Register opening",
    close_title: "Register closing",
    open_intro: "{who} opened the register of {store} on {when} with a float of {opening}.",
    close_intro: "{who} closed the register of {store} on {when}: expected {expected}, counted {counted}.",
    auto: "opened automatically by the first cash payment",
    store: "Store",
    opened: "Opened",
    closed: "Closed",
    by: "Signature",
    opening: "Opening float",
    cash_payments: "Cash payments",
    refunds: "Cash refunds",
    manual_in: "Manual cash in",
    manual_out: "Manual cash out",
    expected: "Expected",
    counted: "Counted",
    diff: "Difference",
    balanced: "The register balances.",
    pending: "There is a difference: the closing awaits the owner's approval.",
    approved: "Difference approved by {who} ({signature}) on {when}.",
    by_terminal: "Cash by till",
    by_seller: "Cash by person",
    manual: "Manual movements",
    movements: "Movement detail",
    col_when: "Time",
    col_till: "Till",
    col_type: "Type",
    col_reason: "Reason",
    col_sale: "Sale",
    col_who: "Who",
    col_amount: "Amount",
    col_count: "#",
    in: "In",
    out: "Out",
    none: "No movements.",
    note: "Note",
    copies: "The store prints this document twice (store copy and closer's copy).",
    footer: "You get this email because your address is on the admin notification list.",
    cat: {
      sale_payment: "Cash payment",
      sale_refund: "Cash refund",
      opening_float: "Opening float",
      supplier_payment: "Supplier payment",
      expense: "Expense",
      owner_withdrawal: "Owner withdrawal",
      bank_deposit: "Bank deposit",
      change_fund: "Change fund",
      refund: "Refund",
      correction: "Correction",
      other: "Other",
    } as Record<string, string>,
  },
} as const;

type Key = Exclude<keyof (typeof COPY)["es"], "cat">;
const tt = (l: EmailLocale, k: Key, v: Record<string, string | number> = {}): string => {
  let s: string = COPY[l][k];
  for (const [a, b] of Object.entries(v)) s = s.split(`{${a}}`).join(String(b));
  return s;
};
const cat = (l: EmailLocale, c: string | null): string => (c ? COPY[l].cat[c] ?? c : "—");
const money = (cents: number, l: EmailLocale) => new Intl.NumberFormat(l === "en" ? "en-US" : "es-US", { style: "currency", currency: "USD" }).format(cents / 100);
const signed = (cents: number, l: EmailLocale) => `${cents < 0 ? "−" : "+"}${money(Math.abs(cents), l)}`;
const when = (iso: string | null, l: EmailLocale, tz: string) =>
  iso ? new Intl.DateTimeFormat(l === "en" ? "en-US" : "es-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "—";
const time = (iso: string, l: EmailLocale, tz: string) => new Intl.DateTimeFormat(l === "en" ? "en-US" : "es-US", { timeZone: tz, timeStyle: "short" }).format(new Date(iso));
const localDate = (iso: string, tz: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};
const who = (p: { name: string; code: string | null } | null, signature: string | null): string =>
  `${p ? p.name : "—"}${p?.code ? ` (${p.code})` : ""}${signature ? ` · ${signature}` : ""}`;

const row = (label: string, value: string, strong = false) =>
  `<tr><td style="padding:7px 0;border-bottom:1px solid ${BORDER};color:${MUTED};font-size:13px;width:46%">${esc(label)}</td><td style="padding:7px 0;border-bottom:1px solid ${BORDER};font-size:${strong ? 16 : 14}px;font-weight:${strong ? 800 : 600};text-align:right">${esc(value)}</td></tr>`;
const h = (text: string) => `<div style="margin:18px 0 6px;font-size:14px;font-weight:800;color:#0b2f66;text-transform:uppercase;letter-spacing:.04em">${esc(text)}</div>`;
const th = (text: string, right = false) => `<th style="text-align:${right ? "right" : "left"};font-size:11px;color:${MUTED};padding:4px 6px;border-bottom:1px solid #cfd5df;text-transform:uppercase;letter-spacing:.03em">${esc(text)}</th>`;
const td = (text: string, right = false, extra = "") => `<td style="text-align:${right ? "right" : "left"};font-size:12.5px;padding:4px 6px;border-bottom:1px solid ${BORDER};${extra}">${esc(text)}</td>`;

/** Pure: subject, HTML and text of the opening / closing email. */
export function renderCashEmail(doc: CashDocument, locale: EmailLocale): RenderedEmail {
  const l = locale;
  const tz = doc.business.timezone || "UTC";
  const s = doc.session;
  const t = doc.totals;
  const storeLabel = `${doc.store.code} · ${doc.store.name}`;
  const isClose = doc.kind === "close";
  const date = localDate(isClose && s.closed_at ? s.closed_at : s.opened_at, tz);
  const subjectCore = isClose
    ? tt(l, "close_subject", { store: doc.store.code, date, diff: money(s.diff_cents ?? 0, l) })
    : tt(l, "open_subject", { store: doc.store.code, date });
  const subject = `${doc.store.color ? `${colorCircle(doc.store.color)} ` : ""}${subjectCore}`;
  const title = tt(l, isClose ? "close_title" : "open_title");
  const openedBy = who(doc.opened_by, s.opened_signature);
  const closedBy = who(doc.closed_by, s.closed_signature);
  const intro = isClose
    ? tt(l, "close_intro", { who: closedBy, store: storeLabel, when: when(s.closed_at, l, tz), expected: money(s.expected_cents, l), counted: money(s.counted_cents ?? 0, l) })
    : tt(l, "open_intro", { who: openedBy, store: storeLabel, when: when(s.opened_at, l, tz), opening: money(s.opening_cents, l) });
  const auto = s.opening_note === "auto";

  const diffTone = (s.diff_cents ?? 0) === 0 ? "#1e6b3a" : (s.diff_cents ?? 0) < 0 ? "#b91c1c" : "#b45309";
  const status = !isClose
    ? ""
    : (s.diff_cents ?? 0) === 0
      ? `<div style="margin-top:12px;padding:10px 14px;background:#e3f5e9;color:#1e6b3a;font-weight:700;border-radius:6px">${esc(tt(l, "balanced"))}</div>`
      : s.status === "pending_approval"
        ? `<div style="margin-top:12px;padding:10px 14px;background:#fef2f2;color:#991b1b;font-weight:700;border-radius:6px">${esc(tt(l, "pending"))}</div>`
        : `<div style="margin-top:12px;padding:10px 14px;background:#fff7ed;color:#9a3412;font-weight:700;border-radius:6px">${esc(tt(l, "approved", { who: who(doc.approved_by, null), signature: s.approval_signature ?? "", when: when(s.approved_at, l, tz) }))}</div>`;

  const summary = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:14px">
    ${row(tt(l, "store"), storeLabel)}
    ${row(tt(l, "opened"), `${when(s.opened_at, l, tz)} · ${openedBy}${auto ? ` · ${tt(l, "auto")}` : ""}`)}
    ${isClose ? row(tt(l, "closed"), `${when(s.closed_at, l, tz)} · ${closedBy}`) : ""}
    ${row(tt(l, "opening"), money(t.opening_cents, l))}
    ${isClose ? row(`${tt(l, "cash_payments")} (${t.cash_payments_count})`, money(t.cash_payments_cents, l)) : ""}
    ${isClose && t.refunds_cents ? row(`${tt(l, "refunds")} (${t.refunds_count})`, `−${money(t.refunds_cents, l)}`) : ""}
    ${isClose && t.manual_in_cents ? row(tt(l, "manual_in"), `+${money(t.manual_in_cents, l)}`) : ""}
    ${isClose && t.manual_out_cents ? row(tt(l, "manual_out"), `−${money(t.manual_out_cents, l)}`) : ""}
    ${row(tt(l, "expected"), money(t.expected_cents, l), isClose)}
    ${isClose ? row(tt(l, "counted"), money(t.counted_cents ?? 0, l), true) : ""}
    ${isClose ? `<tr><td style="padding:7px 0;color:${MUTED};font-size:13px">${esc(tt(l, "diff"))}</td><td style="padding:7px 0;font-size:17px;font-weight:900;text-align:right;color:${diffTone}">${esc(signed(s.diff_cents ?? 0, l))}</td></tr>` : ""}
    ${s.note ? row(tt(l, "note"), s.note) : ""}
  </table>`;

  const terminals = isClose && doc.by_terminal.length
    ? `${h(tt(l, "by_terminal"))}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${th(tt(l, "col_till"))}${th(tt(l, "col_count"), true)}${th(tt(l, "col_amount"), true)}</tr>${doc.by_terminal
        .map((r) => `<tr>${td(r.code ?? "—")}${td(String(r.count), true)}${td(money(r.cents, l), true, "font-weight:700")}</tr>`)
        .join("")}</table>`
    : "";
  const sellers = isClose && doc.by_seller.length
    ? `${h(tt(l, "by_seller"))}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${th(tt(l, "col_who"))}${th(tt(l, "col_count"), true)}${th(tt(l, "col_amount"), true)}</tr>${doc.by_seller
        .map((r) => `<tr>${td(who(r.person, null))}${td(String(r.count), true)}${td(money(r.cents, l), true, "font-weight:700")}</tr>`)
        .join("")}</table>`
    : "";
  const manual = isClose && doc.manual.length
    ? `${h(tt(l, "manual"))}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${th(tt(l, "col_type"))}${th(tt(l, "col_reason"))}${th(tt(l, "note"))}${th(tt(l, "col_amount"), true)}</tr>${doc.manual
        .map((r) => `<tr>${td(tt(l, r.kind === "in" ? "in" : "out"))}${td(`${cat(l, r.category)} (${r.count})`)}${td(r.notes.join("; "))}${td(`${r.kind === "in" ? "+" : "−"}${money(r.cents, l)}`, true, "font-weight:700")}</tr>`)
        .join("")}</table>`
    : "";
  const lines = doc.movements.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${th(tt(l, "col_when"))}${th(tt(l, "col_till"))}${th(tt(l, "col_reason"))}${th(tt(l, "col_sale"))}${th(tt(l, "col_who"))}${th(tt(l, "col_amount"), true)}</tr>${doc.movements
        .map((m) => `<tr>${td(time(m.created_at, l, tz))}${td(m.terminal_code ?? "—")}${td(`${cat(l, m.category)}${m.note && !m.sale_id ? ` · ${m.note}` : ""}`)}${td(m.sale_id ? m.note ?? "" : "")}${td(who(m.by, null))}${td(`${m.kind === "in" ? "+" : "−"}${money(m.amount_cents, l)}`, true, `font-weight:700;color:${m.kind === "in" ? "#1e6b3a" : "#b91c1c"}`)}</tr>`)
        .join("")}</table>`
    : `<div style="font-size:13px;color:${MUTED}">${esc(tt(l, "none"))}</div>`;

  const inner = `
    ${storeBanner({ code: doc.store.code, name: doc.store.name, color: doc.store.color })}
    <div style="font-size:15px;line-height:1.7;color:#374151">${esc(intro)}</div>
    ${status}
    ${summary}
    ${terminals}${sellers}${manual}
    ${h(tt(l, "movements"))}${lines}
    <div style="margin-top:16px;font-size:12px;color:${MUTED}">${esc(tt(l, "copies"))}</div>
    <div style="margin-top:6px;font-size:11px;color:${MUTED}">${esc(tt(l, "footer"))}</div>`;

  const textLines = [
    title,
    intro,
    `${tt(l, "opening")}: ${money(t.opening_cents, l)}`,
    ...(isClose
      ? [
          `${tt(l, "cash_payments")} (${t.cash_payments_count}): ${money(t.cash_payments_cents, l)}`,
          `${tt(l, "refunds")} (${t.refunds_count}): ${money(t.refunds_cents, l)}`,
          `${tt(l, "manual_in")}: ${money(t.manual_in_cents, l)}`,
          `${tt(l, "manual_out")}: ${money(t.manual_out_cents, l)}`,
          `${tt(l, "expected")}: ${money(t.expected_cents, l)}`,
          `${tt(l, "counted")}: ${money(t.counted_cents ?? 0, l)}`,
          `${tt(l, "diff")}: ${signed(s.diff_cents ?? 0, l)}`,
          s.status === "pending_approval" ? tt(l, "pending") : (s.diff_cents ?? 0) === 0 ? tt(l, "balanced") : tt(l, "approved", { who: who(doc.approved_by, null), signature: s.approval_signature ?? "", when: when(s.approved_at, l, tz) }),
        ]
      : [`${tt(l, "expected")}: ${money(t.expected_cents, l)}`]),
    "",
    tt(l, "movements"),
    ...doc.movements.map((m) => `${time(m.created_at, l, tz)}  ${m.terminal_code ?? "—"}  ${cat(l, m.category)}${m.note ? ` · ${m.note}` : ""}  ${who(m.by, null)}  ${m.kind === "in" ? "+" : "−"}${money(m.amount_cents, l)}`),
  ];
  return { subject, html: shell(title, intro, inner, l, { accent: doc.store.color }), text: textLines.join("\n") };
}

/**
 * Sends the document to every admin notification address (owner included,
 * de-duplicated by resolveStoreSettings), one mail per recipient. Returns how
 * many were sent; a provider failure is logged per recipient. Audited as
 * `document.email` when `actorId` is given (a manual re-send).
 */
export async function sendCashEmail(container: MedusaContainer, sessionId: string, kind: CashDocumentKind, opts: { actorId?: string | null } = {}): Promise<number> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const [doc, settings] = await Promise.all([buildCashDocument(container, sessionId, kind), resolveStoreSettings(container)]);
  const recipients = settings.admin_notification_emails;
  if (!recipients.length) {
    logger.warn(`[cash] ${kind} of ${sessionId}: no admin notification email configured`);
    return 0;
  }
  const locale: EmailLocale = tenant().locale === "en" ? "en" : "es";
  const content = renderCashEmail(doc, locale);
  const notifications = container.resolve<INotificationModuleService>(Modules.NOTIFICATION);
  let sent = 0;
  for (const to of recipients) {
    try {
      await notifications.createNotifications({
        to,
        channel: "email",
        template: `cash-${kind}`,
        trigger_type: `pos.cash.${kind}`,
        resource_id: sessionId,
        resource_type: "cash_session",
        content,
      });
      sent += 1;
    } catch (e) {
      logger.warn(`[cash] ${kind} of ${sessionId}: email not sent: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  if (opts.actorId !== undefined) {
    await recordAudit(container, { actorId: opts.actorId ?? null, action: "document.email", entity: "cash_session", entityId: sessionId, establishmentId: doc.store.id, after: { kind, recipients: sent } });
  }
  return sent;
}

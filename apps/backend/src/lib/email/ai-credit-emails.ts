import type { EmailLocale } from "./copy";
import { esc, shell, type RenderedEmail } from "./order-confirmation";
import { storefrontOrigin } from "../order-access";

/**
 * AI credit emails: "the balance is getting low" (an owner's alert rule) and
 * "the provider refused a call for lack of credit" (immediate). Amounts are
 * the panel's ESTIMATE and say so — the owner's console is the real figure.
 */
const COPY = {
  es: {
    provider: { anthropic: "Anthropic (Claude)", gemini: "Google Gemini", openai: "OpenAI", openrouter: "OpenRouter", mistral: "Mistral", xai: "xAI (Grok)", qwen: "Qwen" } as Record<string, string>,
    low_subject: "Saldo de IA bajo: {provider} — quedan {remaining}",
    low_title: "El saldo de {provider} se está acabando",
    low_rule: { usd: "Tu alerta: avisar cuando queden {threshold} o menos.", percent: "Tu alerta: avisar cuando quede el {threshold} % o menos de lo cargado.", days: "Tu alerta: avisar cuando queden {threshold} días o menos al ritmo actual." } as Record<string, string>,
    remaining: "Saldo estimado",
    funded: "Cargado en este ciclo",
    spent: "Consumido desde la carga",
    pace: "Ritmo (últimos 7 días)",
    pace_value: "{amount} por día",
    days_left: "Se acaba en",
    days_value: "~{days} días",
    days_unknown: "sin consumo reciente",
    estimate: "Es una estimación: el panel resta a lo que anotaste el costo de cada llamada medida con tarifas publicadas. Revisa el saldo real en la consola del proveedor y anótalo en el panel para corregirla.",
    nocredit_subject: "URGENTE: {provider} rechazó llamadas por falta de saldo",
    nocredit_title: "{provider} se quedó sin saldo",
    nocredit_body: "Desde {since}, {provider} rechazó {n} llamada(s) por falta de crédito. Las funciones afectadas no están respondiendo: {activities}.",
    nocredit_action: "Recarga la cuenta en la consola del proveedor y anota la recarga en el panel.",
    activity: { ocr: "lectura de recetas (OCR)", vision_measure: "medición con IA", tryon_render: "imagen del probador", translation: "traducción del catálogo", media_views: "vistas de producto", media_video: "video de producto", other: "otras" } as Record<string, string>,
    panel: "Abrir Consumo IA",
    footer: "Recibes este aviso porque tu dirección está en una alerta de saldo de IA o en la lista de administradores de la tienda.",
  },
  en: {
    provider: { anthropic: "Anthropic (Claude)", gemini: "Google Gemini", openai: "OpenAI", openrouter: "OpenRouter", mistral: "Mistral", xai: "xAI (Grok)", qwen: "Qwen" } as Record<string, string>,
    low_subject: "Low AI balance: {provider} — {remaining} left",
    low_title: "The {provider} balance is running low",
    low_rule: { usd: "Your alert: warn when {threshold} or less is left.", percent: "Your alert: warn when {threshold}% or less of what was loaded is left.", days: "Your alert: warn when {threshold} days or less are left at the current pace." } as Record<string, string>,
    remaining: "Estimated balance",
    funded: "Loaded this cycle",
    spent: "Spent since loading",
    pace: "Pace (last 7 days)",
    pace_value: "{amount} per day",
    days_left: "Runs out in",
    days_value: "~{days} days",
    days_unknown: "no recent spending",
    estimate: "This is an estimate: the panel subtracts the cost of every measured call, at published rates, from what you entered. Check the real balance in the provider's console and enter it in the panel to correct it.",
    nocredit_subject: "URGENT: {provider} refused calls for lack of credit",
    nocredit_title: "{provider} ran out of credit",
    nocredit_body: "Since {since}, {provider} refused {n} call(s) for lack of credit. These features are not responding: {activities}.",
    nocredit_action: "Top up the account in the provider's console and enter the deposit in the panel.",
    activity: { ocr: "prescription reading (OCR)", vision_measure: "AI measurement", tryon_render: "try-on image", translation: "catalog translation", media_views: "product views", media_video: "product video", other: "other" } as Record<string, string>,
    panel: "Open AI usage",
    footer: "You get this alert because your address is on an AI balance alert or on the store's admin list.",
  },
};

const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
const usd = (v: number | null, locale: EmailLocale) =>
  v === null ? "—" : new Intl.NumberFormat(locale === "en" ? "en-US" : "es-US", { style: "currency", currency: "USD" }).format(v);
const providerName = (p: string, locale: EmailLocale) => COPY[locale].provider[p] ?? p;
const panelUrl = () => `${storefrontOrigin()}/admin?tab=aiusage`;

function rows(items: Array<[string, string]>): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:12px 0">${items
    .map(([k, v]) => `<tr><td style="padding:6px 0;color:#5b6472;font-size:13px">${esc(k)}</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:14px">${esc(v)}</td></tr>`)
    .join("")}</table>`;
}

export interface LowBalanceInput {
  provider: string;
  unit: string;
  threshold: number;
  remaining: number | null;
  funded: number;
  spent: number;
  burn_per_day: number;
  days_left: number | null;
}

export function renderLowBalanceEmail(d: LowBalanceInput, locale: EmailLocale): RenderedEmail {
  const c = COPY[locale];
  const name = providerName(d.provider, locale);
  const thresholdText = d.unit === "usd" ? usd(d.threshold, locale) : String(d.threshold);
  const subject = fill(c.low_subject, { provider: name, remaining: usd(d.remaining, locale) });
  const title = fill(c.low_title, { provider: name });
  const table: Array<[string, string]> = [
    [c.remaining, usd(d.remaining, locale)],
    [c.funded, usd(d.funded, locale)],
    [c.spent, usd(d.spent, locale)],
    [c.pace, fill(c.pace_value, { amount: usd(d.burn_per_day, locale) })],
    [c.days_left, d.days_left === null ? c.days_unknown : fill(c.days_value, { days: d.days_left })],
  ];
  const inner = `
    <h1 style="margin:0 0 8px;font-size:20px">${esc(title)}</h1>
    <p style="margin:0 0 4px;font-size:14px">${esc(fill(c.low_rule[d.unit] ?? "", { threshold: thresholdText }))}</p>
    ${rows(table)}
    <p style="margin:12px 0 0;font-size:12px;color:#5b6472">${esc(c.estimate)}</p>
    <div style="margin-top:20px"><a href="${esc(panelUrl())}" style="color:#0b2f66;font-weight:700">${esc(c.panel)}</a></div>
    <p style="margin:20px 0 0;font-size:11px;color:#5b6472">${esc(c.footer)}</p>`;
  const text = [title, fill(c.low_rule[d.unit] ?? "", { threshold: thresholdText }), ...table.map(([k, v]) => `${k}: ${v}`), "", c.estimate, panelUrl()].join("\n");
  return { subject, html: shell(title, subject, inner, locale), text };
}

export interface NoCreditInput {
  provider: string;
  since: Date;
  count: number;
  activities: string[];
}

export function renderNoCreditEmail(d: NoCreditInput, locale: EmailLocale): RenderedEmail {
  const c = COPY[locale];
  const name = providerName(d.provider, locale);
  const subject = fill(c.nocredit_subject, { provider: name });
  const title = fill(c.nocredit_title, { provider: name });
  const since = d.since.toLocaleString(locale === "en" ? "en-US" : "es-US", { dateStyle: "medium", timeStyle: "short" });
  const body = fill(c.nocredit_body, {
    provider: name,
    since,
    n: d.count,
    activities: d.activities.map((a) => c.activity[a] ?? a).join(", "),
  });
  const inner = `
    <h1 style="margin:0 0 8px;font-size:20px;color:#b42318">${esc(title)}</h1>
    <p style="margin:0 0 8px;font-size:14px">${esc(body)}</p>
    <p style="margin:0 0 8px;font-size:14px;font-weight:700">${esc(c.nocredit_action)}</p>
    <div style="margin-top:20px"><a href="${esc(panelUrl())}" style="color:#0b2f66;font-weight:700">${esc(c.panel)}</a></div>
    <p style="margin:20px 0 0;font-size:11px;color:#5b6472">${esc(c.footer)}</p>`;
  return { subject, html: shell(title, subject, inner, locale), text: [title, body, c.nocredit_action, panelUrl()].join("\n") };
}

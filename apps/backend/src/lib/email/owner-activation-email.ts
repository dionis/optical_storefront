import type { EmailLocale } from "./copy";
import { tenantName } from "../tenant";
import { BRAND, MUTED, esc, shell, type RenderedEmail } from "./order-confirmation";

/**
 * "Your panel is ready" — the mail the new owner gets when the store is set up
 * for them (src/scripts/tenant-bootstrap.ts).
 *
 * It carries NO password and NO token: the link opens /admin?activate=<email>,
 * where the owner asks for the usual 15-minute link to create their password
 * (the same flow as "I forgot my password"). An activation mail that sits in an
 * inbox for a week is therefore worthless to whoever finds it later.
 */
const COPY = {
  es: {
    subject: "{store}: tu panel está listo",
    title: "Tu panel está listo",
    intro: "Hemos preparado el panel de {store} y tú eres su dueño.",
    steps: "Para entrar por primera vez, abre el enlace, pulsa «Enviarme el enlace» y crea tu contraseña con el correo que te llegará (vale 15 minutos).",
    cta: "Activar mi cuenta",
    after: "Dentro verás «Primeros pasos»: lo que falta para que la tienda funcione sola.",
    support: "¿Dudas? Escribe a {support}.",
  },
  en: {
    subject: "{store}: your panel is ready",
    title: "Your panel is ready",
    intro: "We have set up the {store} panel and you are its owner.",
    steps: "To sign in for the first time, open the link, press “Send me the link” and create your password from the email you will receive (valid for 15 minutes).",
    cta: "Activate my account",
    after: "Inside you will find “First steps”: what is still missing for the store to run on its own.",
    support: "Questions? Write to {support}.",
  },
};

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

/** /admin?activate=<email> on the store's own origin. */
export function buildActivationLink(origin: string, email: string): string {
  return `${origin.trim().replace(/\/+$/, "")}/admin?activate=${encodeURIComponent(email)}`;
}

export interface OwnerActivationEmailData {
  link: string;
  support: string | null;
}

export function renderOwnerActivationEmail(data: OwnerActivationEmailData, locale: EmailLocale): RenderedEmail {
  const c = COPY[locale];
  const vars = { store: tenantName(), support: data.support ?? "" };
  const intro = fill(c.intro, vars);
  const support = data.support ? fill(c.support, vars) : "";
  const inner = `
    <div style="font-size:15px;line-height:1.7;color:#374151">${esc(c.steps)}</div>
    <div style="margin:22px 0"><a href="${esc(data.link)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">${esc(c.cta)}</a></div>
    <div style="font-size:13px;color:${MUTED};line-height:1.6">${esc(c.after)}</div>
    ${support ? `<div style="font-size:13px;color:${MUTED};line-height:1.6;margin-top:8px">${esc(support)}</div>` : ""}`;
  return {
    subject: fill(c.subject, vars),
    html: shell(c.title, intro, inner, locale),
    text: [intro, "", c.steps, `${c.cta}: ${data.link}`, "", c.after, support].filter((l, i, a) => l || a[i - 1]).join("\n"),
  };
}

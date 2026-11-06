import type { EmailLocale } from "./copy";
import { tenantName } from "../tenant";
import { MUTED, esc, shell, type RenderedEmail } from "./order-confirmation";

/**
 * "Ownership of the store changed hands" — one mail to the previous owner and
 * one to the new one, each in their language. It names both addresses and the
 * time, and tells the reader what to do if it was not expected: ownership is
 * the one right nobody else in the panel can take back.
 */
const COPY = {
  es: {
    subject: "{store}: cambio de dueño del panel",
    title: "Cambio de dueño",
    toNew: "{from} te ha transferido la propiedad del panel de {store}. Desde ahora eres el dueño: puedes nombrar y retirar superadministradores y transferir de nuevo la propiedad.",
    toOld: "Transferiste la propiedad del panel de {store} a {to}. Sigues teniendo acceso como superadministrador; el nuevo dueño puede cambiarlo.",
    when: "Fecha: {when} (UTC).",
    unexpected: "Si no esperabas este cambio, escribe a {support} cuanto antes.",
    unexpectedNoSupport: "Si no esperabas este cambio, avisa cuanto antes a quien administra la tienda.",
  },
  en: {
    subject: "{store}: the panel has a new owner",
    title: "New owner",
    toNew: "{from} transferred ownership of the {store} panel to you. You are now the owner: you can name and remove superadmins and transfer ownership again.",
    toOld: "You transferred ownership of the {store} panel to {to}. You keep access as a superadmin; the new owner can change that.",
    when: "Date: {when} (UTC).",
    unexpected: "If you did not expect this change, write to {support} as soon as possible.",
    unexpectedNoSupport: "If you did not expect this change, tell whoever runs the store as soon as possible.",
  },
};

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

export interface OwnerTransferEmailData {
  role: "previous" | "new";
  from: string;
  to: string;
  at: Date;
  support: string | null;
}

export function renderOwnerTransferEmail(data: OwnerTransferEmailData, locale: EmailLocale): RenderedEmail {
  const c = COPY[locale];
  const vars = {
    store: tenantName(),
    from: data.from,
    to: data.to,
    when: data.at.toISOString().slice(0, 16).replace("T", " "),
    support: data.support ?? "",
  };
  const body = fill(data.role === "new" ? c.toNew : c.toOld, vars);
  const when = fill(c.when, vars);
  const warn = data.support ? fill(c.unexpected, vars) : c.unexpectedNoSupport;
  const inner = `
    <div style="font-size:15px;line-height:1.7;color:#374151">${esc(body)}</div>
    <div style="font-size:13px;color:${MUTED};line-height:1.6;margin-top:16px">${esc(when)}</div>
    <div style="font-size:13px;color:${MUTED};line-height:1.6;margin-top:8px">${esc(warn)}</div>`;
  return {
    subject: fill(c.subject, vars),
    html: shell(c.title, body, inner, locale),
    text: [body, "", when, warn].join("\n"),
  };
}

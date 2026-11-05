import type { EmailLocale } from "./copy";
import { tenantName } from "../tenant";
import { BRAND, MUTED, esc, shell, type RenderedEmail } from "./order-confirmation";

/**
 * The "reset your panel password" email (HU-03). Sent by the
 * `auth.password_reset` subscriber to the address that asked; the link carries
 * Medusa's single-use token. Nothing else about the account goes in here — no
 * role, no store, no name — so a mail that lands in the wrong inbox says only
 * that somebody typed this address.
 */
const COPY = {
  es: {
    subject: "Restablecer tu contraseña de {store}",
    title: "Restablecer contraseña",
    intro: "Alguien pidió cambiar la contraseña de {email} en el panel de {store}. Si fuiste tú, pulsa el botón y elige una nueva.",
    button: "Elegir nueva contraseña",
    expiry: "El enlace vale {minutes} minutos y solo se puede usar una vez.",
    ignore: "Si no fuiste tú, ignora este correo: tu contraseña sigue igual y nadie puede entrar sin este enlace.",
    fallback: "Si el botón no funciona, copia este enlace en el navegador:",
  },
  en: {
    subject: "Reset your {store} password",
    title: "Reset your password",
    intro: "Someone asked to change the password for {email} on the {store} panel. If that was you, press the button and choose a new one.",
    button: "Choose a new password",
    expiry: "The link is valid for {minutes} minutes and can be used only once.",
    ignore: "If it was not you, ignore this email: your password is unchanged and nobody can sign in without this link.",
    fallback: "If the button does not work, copy this link into your browser:",
  },
};

const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));

export interface PasswordResetEmailData {
  /** Address that asked (and that receives the mail). */
  email: string;
  /** Full URL to the panel's "new password" form, token included. */
  link: string;
  /** Token lifetime, for the copy. */
  minutes: number;
}

export function renderPasswordResetEmail(data: PasswordResetEmailData, locale: EmailLocale): RenderedEmail {
  const c = COPY[locale];
  const vars = { store: tenantName(), email: data.email, minutes: data.minutes };
  const intro = fill(c.intro, vars);
  const expiry = fill(c.expiry, vars);
  const inner = `
    <div style="font-size:15px;line-height:1.7;color:#374151">${esc(intro)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:24px 0">
      <tr>
        <td align="center" style="border-radius:8px;background:${BRAND}">
          <a href="${esc(data.link)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${esc(c.button)}</a>
        </td>
      </tr>
    </table>
    <div style="font-size:13px;color:${MUTED};line-height:1.6">${esc(expiry)}</div>
    <div style="font-size:13px;color:${MUTED};line-height:1.6;margin-top:8px">${esc(c.ignore)}</div>
    <div style="font-size:12px;color:${MUTED};line-height:1.6;margin-top:16px">${esc(c.fallback)}<br><a href="${esc(data.link)}" style="color:${BRAND};word-break:break-all">${esc(data.link)}</a></div>`;

  return {
    subject: fill(c.subject, vars),
    html: shell(c.title, intro, inner, locale),
    text: [intro, "", data.link, "", expiry, c.ignore].join("\n"),
  };
}

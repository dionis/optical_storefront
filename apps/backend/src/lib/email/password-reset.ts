/**
 * Password recovery e-mail for panel users (M3: «recuperación de contraseña»).
 *
 * Medusa does the cryptography: `POST /auth/user/emailpass/reset-password`
 * emits `auth.password_reset` with a short-lived token, and
 * `POST /auth/user/emailpass/update` (bearer = that token) sets the new
 * password. What Medusa does NOT do is deliver the token — that is the
 * subscriber in src/subscribers/auth-password-reset.ts, which renders this.
 *
 * Pure: builds the link and the two bodies; no I/O, so it is unit-tested.
 */
import { esc, shell, type RenderedEmail } from "./order-confirmation";
import type { EmailLocale } from "./copy";
import { storefrontOrigin } from "../order-access";

const COPY = {
  es: {
    subject: "Restablecer tu contraseña del panel",
    title: "Restablecer contraseña",
    intro: "Recibimos una solicitud para cambiar la contraseña de tu acceso al panel corporativo.",
    cta: "Elegir una contraseña nueva",
    expires: "El enlace sirve una sola vez y caduca pronto. Si no fuiste tú, ignora este correo: tu contraseña no cambia.",
    paste: "Si el botón no abre, copia este enlace en el navegador:",
  },
  en: {
    subject: "Reset your panel password",
    title: "Reset password",
    intro: "We received a request to change the password of your corporate panel account.",
    cta: "Choose a new password",
    expires: "The link works once and expires soon. If this was not you, ignore this e-mail: your password stays as it is.",
    paste: "If the button does not open, paste this link in your browser:",
  },
} as const;

/**
 * Where the panel lives. `ADMIN_PANEL_URL` wins (e.g. https://opticaelrancho.com/admin
 * when the panel is served under the optician's own domain); otherwise the
 * storefront's `/admin`.
 */
export function adminPanelUrl(): string {
  const explicit = (process.env.ADMIN_PANEL_URL ?? "").trim().replace(/\/+$/, "");
  return explicit || `${storefrontOrigin()}/admin`;
}

/** The link the person opens: the panel's login with the token and the address pre-filled. */
export function passwordResetLink(email: string, token: string, base = adminPanelUrl()): string {
  const u = new URL(base);
  u.searchParams.set("reset_token", token);
  u.searchParams.set("email", email);
  return u.toString();
}

export function renderPasswordResetEmail(args: { email: string; token: string; locale: EmailLocale; base?: string }): RenderedEmail {
  const c = COPY[args.locale] ?? COPY.es;
  const link = passwordResetLink(args.email, args.token, args.base);
  const inner = `
    <div style="font-size:15px;line-height:1.7;color:#374151">${esc(c.intro)}</div>
    <div style="margin-top:22px;text-align:center"><a href="${esc(link)}" style="display:inline-block;background:#0b2f66;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:10px">${esc(c.cta)}</a></div>
    <div style="margin-top:18px;font-size:13px;color:#5b6472;line-height:1.6">${esc(c.expires)}</div>
    <div style="margin-top:12px;font-size:12px;color:#5b6472;word-break:break-all">${esc(c.paste)}<br>${esc(link)}</div>`;
  return {
    subject: c.subject,
    html: shell(c.title, c.intro, inner, args.locale),
    text: [c.intro, "", `${c.cta}: ${link}`, "", c.expires].join("\n"),
  };
}

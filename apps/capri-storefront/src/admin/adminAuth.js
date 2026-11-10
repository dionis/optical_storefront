// Admin authentication for the corporate panel.
//
// This used to be a CLIENT-SIDE gate: it accepted any email with any password,
// and the "2FA" step accepted any 4–8 digits. That was defensible while the
// panel only ever showed seeded demo data — there was nothing behind it to
// protect. The Orders tab now reads and MUTATES real orders through the Medusa
// Admin API, so the gate had to become real.
//
// It is now a thin adapter over adminApi.js, which authenticates against
// Medusa's own `/auth/user/emailpass`. The credentials are the ones that open
// the Medusa dashboard; there is no second, storefront-specific password to keep
// in sync, and no hash shipped in the bundle. The token is a Medusa JWT and
// every admin request carries it — so a forged session in sessionStorage buys
// nothing, because the server checks.
//
// The exported surface is unchanged (`authenticate`, `verifyOtp`, `getSession`,
// `logout`) so AdminPage.jsx did not need rewriting: the login form already had
// a password step and a code step, they just never talked to anything.
//
// VITE_ADMIN_DEMO_LOGIN=true restores the old open gate, for deploying the panel
// as a disconnected showcase with no backend behind it. It is off by default and
// must stay off anywhere real orders exist.

import { ADMIN_API_URL, getSession as getApiSession, login, logout as apiLogout, verifyMfa } from "./adminApi.js";
import { TENANT } from "../config/tenant.js";

const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
const DEMO_LOGIN = String(env.VITE_ADMIN_DEMO_LOGIN || "") === "true";

const DEMO_KEY = "oer_admin_session";
const DEMO_HOURS = 8;

/** True when the panel is running without a backend, on seeded data only. */
export const isDemoLogin = () => DEMO_LOGIN;

function saveDemoSession(user) {
  const session = { user, token: "demo", exp: Date.now() + DEMO_HOURS * 3600 * 1000, demo: true };
  try {
    sessionStorage.setItem(DEMO_KEY, JSON.stringify(session));
  } catch {
    /* private browsing */
  }
}

/** First factor. `{ ok, twofa? , error? }` — the shape the login form expects. */
export async function authenticate(user, pass) {
  if (DEMO_LOGIN) {
    const email = String(user || "").trim();
    if (!/\S+@\S+\.\S+/.test(email) || !String(pass || "")) {
      return { ok: false, error: "adm.err.needBoth" };
    }
    saveDemoSession(email);
    return { ok: true };
  }

  const result = await login(user, pass);
  // adminApi says `mfa`; the form says `twofa`. Translate here rather than
  // renaming the form's state machine.
  return result.mfa ? { ok: true, twofa: true } : result;
}

/** Second factor, when Medusa asked for one. */
export async function verifyOtp(code) {
  if (DEMO_LOGIN) return { ok: false, error: "adm.err.relogin" };
  return verifyMfa(code);
}

/* ─────────────────────  password recovery (HU-03)  ───────────────────── */
// Both routes are Medusa's own, reached through the same same-origin proxy the
// login uses. Neither carries a session: the first is anonymous, the second is
// authenticated by the single-use token from the email. As everywhere in this
// module, results carry dictionary KEYS, never prose.

async function postAuth(path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${ADMIN_API_URL}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    return { ok: false, error: "adm.err.offline" };
  }
  if (res.ok) return { ok: true };
  if (res.status === 429) return { ok: false, error: "adm.auth.tooMany", status: 429 };
  return { ok: false, status: res.status };
}

/**
 * Asks the backend to email a reset link. Medusa answers 201 whether or not
 * the address exists (and so do we): the caller shows the same "if the email
 * exists we sent a link" either way. Only "offline" and "too many" surface.
 */
export async function requestPasswordReset(email) {
  const identifier = String(email || "").trim();
  if (!identifier) return { ok: false, error: "adm.auth.needEmail" };
  if (DEMO_LOGIN) return { ok: true };
  const r = await postAuth("/auth/user/emailpass/reset-password", { identifier });
  if (r.ok || r.error) return r;
  // Any other failure reads as "sent" too — the response must not depend on
  // whether the account exists.
  return { ok: true };
}

/**
 * Sets the new password with the token from the link. A 401 means the token
 * expired, was already used, or a newer link superseded it.
 */
export async function completePasswordReset({ token, email, password }) {
  if (!token || !email) return { ok: false, error: "adm.auth.badLink" };
  if (DEMO_LOGIN) return { ok: false, error: "adm.auth.linkExpired" };
  const r = await postAuth("/auth/user/emailpass/update", { email, password }, token);
  if (r.ok || r.error) return r;
  if (r.status === 401) return { ok: false, error: "adm.auth.linkExpired" };
  return { ok: false, error: "adm.err.generic" };
}

export function getSession() {
  if (!DEMO_LOGIN) return getApiSession();
  try {
    const session = JSON.parse(sessionStorage.getItem(DEMO_KEY) || "null");
    if (!session || !session.exp || Date.now() > session.exp) {
      logout();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function isAuthed() {
  return !!getSession();
}

export function logout() {
  apiLogout();
  try {
    sessionStorage.removeItem(DEMO_KEY);
  } catch {
    /* noop */
  }
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1|.+\.localhost|.+\.test)$/i;

/**
 * Where «Salir» lands: the store's panel address (TENANT.adminUrl, e.g.
 * https://opticaelrancho.com/admin) — also from the Vercel host the domain
 * proxies to. On a local host (QA, development) it stays on this origin's
 * /admin, so a test never jumps to the real site.
 */
export function adminLoginUrl(loc = typeof window !== "undefined" ? window.location : null) {
  const here = loc ? `${loc.origin}/admin` : "/admin";
  if (!loc || LOCAL_HOST.test(loc.hostname || "")) return here;
  const target = String(TENANT.adminUrl || "").trim();
  if (!/^https:\/\//i.test(target)) return here;
  return target;
}

/**
 * «Salir»: the token, the panel cache and the demo session go, and the page is
 * reloaded at the login address — no state of the closed session stays in
 * memory (the next person on a shared tablet starts from a clean login), and
 * «atrás» does not return to the panel. Returns false when there is no window
 * (tests): the caller then just paints the login.
 */
export function signOutToLogin() {
  logout();
  if (typeof window === "undefined" || !window.location) return false;
  try {
    window.location.replace(adminLoginUrl());
    return true;
  } catch {
    return false;
  }
}

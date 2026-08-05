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

import { getSession as getApiSession, login, logout as apiLogout, verifyMfa } from "./adminApi.js";

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
}

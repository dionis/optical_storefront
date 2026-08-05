// Talking to the Medusa Admin API from the corporate panel.
//
// The panel used to be a client-side gate over localStorage demo data: any
// email and password got you in, and the numbers on screen were seeded fiction.
// This module replaces that with Medusa's own admin authentication — the same
// credentials that open the Medusa dashboard, verified server-side — so the
// panel shows the real store and the login is an actual security boundary.
//
// Why the base URL ignores VITE_MEDUSA_URL
// ----------------------------------------
// The Store API client (data/medusa.js) honours an absolute VITE_MEDUSA_URL and
// talks to the backend directly, which works because `storeCors` lists the
// storefront's origin. The admin and auth routes sit behind *different* CORS
// allowlists (`adminCors`, `authCors`), so pointing the browser straight at the
// backend would fail preflight on every deployment whose origin nobody
// remembered to add — including every Vercel preview URL, which are generated.
//
// So admin traffic always goes through the same-origin proxy: `/medusa/...` is
// rewritten to the backend by vercel.json in production and by the Vite dev
// proxy locally. The browser only ever calls its own origin, and there is no
// CORS to keep in sync. VITE_ADMIN_MEDUSA_URL overrides this for the unusual
// deployment that has no proxy in front of it.

const env = (typeof import.meta !== "undefined" && import.meta.env) || {};

const ORIGIN =
  typeof window !== "undefined" && window.location ? window.location.origin : "";

export const ADMIN_API_URL =
  (env.VITE_ADMIN_MEDUSA_URL && String(env.VITE_ADMIN_MEDUSA_URL).replace(/\/$/, "")) ||
  `${ORIGIN}/medusa`;

// Same key and shape the panel has always used, so AdminPage.jsx keeps reading
// `session.user` without knowing the token behind it changed meaning.
const SESSION_KEY = "oer_admin_session";

/** Thrown by adminFetch so callers can branch on the status instead of the copy. */
export class AdminApiError extends Error {
  constructor(message, { status, reason } = {}) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.reason = reason;
  }
}

/* ─────────────────────────────  session  ───────────────────────────── */

/**
 * Read the expiry out of the JWT itself.
 *
 * Inventing our own "8 hours from login" would drift from whatever
 * `jwtExpiresIn` the backend is configured with: too long and the panel keeps
 * showing a logged-in shell that 401s on every click; too short and it logs the
 * owner out while the token was still perfectly good. The token knows.
 */
function jwtExpiry(token) {
  try {
    const [, payload] = String(token).split(".");
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return claims.exp ? claims.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function saveSession(user, token) {
  const session = { user, token, exp: jwtExpiry(token) };
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* private browsing — the session just won't survive a reload */
  }
  return session;
}

export function getSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    if (!session || !session.token) return null;
    if (session.exp && Date.now() > session.exp) {
      clearSession();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* noop */
  }
}

/* ─────────────────────────────  requests  ───────────────────────────── */

async function call(path, { method = "GET", body, token, query } = {}) {
  const url = new URL(`${ADMIN_API_URL}${path}`, ORIGIN || undefined);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // Distinguishable from a 4xx so the UI can say "no connection" rather than
    // "wrong password" when the backend is simply down.
    throw new AdminApiError("No se pudo conectar con el servidor.", { reason: "offline" });
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    throw new AdminApiError(payload?.message || `HTTP ${res.status}`, {
      status: res.status,
      reason: payload?.reason,
    });
  }
  return payload;
}

/**
 * Authenticated call against `/admin/*`.
 *
 * A 401 means the token is spent, so the session is dropped here rather than
 * left for every caller to remember — otherwise the panel loops on failing
 * requests behind a shell that still looks logged in.
 */
export async function adminFetch(path, options = {}) {
  const session = getSession();
  if (!session) throw new AdminApiError("Sesión caducada.", { status: 401 });
  try {
    return await call(path, { ...options, token: session.token });
  } catch (error) {
    if (error.status === 401) clearSession();
    throw error;
  }
}

/* ─────────────────────────────  login  ───────────────────────────── */

// Held between the password step and the code step. Never persisted: it is a
// half-authenticated token that must not survive a reload.
let pendingMfa = null;

/**
 * Step one: email + password against Medusa.
 *
 * Returns `{ ok: true }` on a complete login, or `{ ok: true, mfa: true }` when
 * the backend wants a second factor — which the login form already renders a
 * step for, it was just never real before.
 */
export async function login(email, password) {
  const user = String(email || "").trim();
  if (!user || !password) {
    return { ok: false, error: "Introduce tu correo y contraseña." };
  }

  let data;
  try {
    data = await call("/auth/user/emailpass", {
      method: "POST",
      body: { email: user, password },
    });
  } catch (error) {
    if (error.reason === "offline") {
      return { ok: false, error: "No se pudo conectar con el servidor." };
    }
    // Medusa answers 401 for both "no such user" and "wrong password", and so
    // do we — telling them apart is how you enumerate accounts.
    if (error.status === 401 || error.status === 400) {
      return { ok: false, error: "Credenciales incorrectas." };
    }
    return { ok: false, error: error.message || "Error de autenticación." };
  }

  if (data?.mfa_required) {
    pendingMfa = {
      user,
      token: data.token,
      challengeId: data.mfa_challenge?.id,
      method: data.mfa_challenge?.methods?.[0] || "totp",
    };
    return { ok: true, mfa: true };
  }

  if (!data?.token) {
    return { ok: false, error: "El servidor no devolvió una sesión." };
  }

  saveSession(user, data.token);
  return { ok: true };
}

/** Step two: the one-time code, when the backend asked for one. */
export async function verifyMfa(code) {
  if (!pendingMfa) return { ok: false, error: "Vuelve a iniciar sesión." };
  const value = String(code || "").trim();
  if (!value) return { ok: false, error: "Introduce el código." };

  try {
    const data = await call(
      `/auth/mfa/challenges/${encodeURIComponent(pendingMfa.challengeId)}/verify`,
      {
        method: "POST",
        token: pendingMfa.token,
        body: { method: pendingMfa.method, code: value },
      }
    );
    if (!data?.token) return { ok: false, error: "Código inválido." };
    saveSession(pendingMfa.user, data.token);
    pendingMfa = null;
    return { ok: true };
  } catch (error) {
    if (error.reason === "offline") {
      return { ok: false, error: "No se pudo conectar con el servidor." };
    }
    return { ok: false, error: "Código inválido." };
  }
}

export function logout() {
  pendingMfa = null;
  clearSession();
}

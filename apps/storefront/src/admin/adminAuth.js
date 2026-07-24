// Admin authentication (user + password).
//
// IMPORTANT (best-practice note): this is a CLIENT-SIDE gate. The password is stored
// as a SHA-256 hash, and the app never keeps the plaintext — but because everything
// ships to the browser, a client-only gate is not a real security boundary. It keeps
// casual users out and gives the owner a working login TODAY. For production/SaaS,
// point `VITE_ADMIN_AUTH_URL` at a real auth endpoint (Dionis's backend): the single
// `authenticate()` seam below will POST there instead and expect a signed token.
//
// Change the credentials by setting VITE_ADMIN_USER / VITE_ADMIN_PASS_SHA256 at build
// time, or by editing the two constants below. Generate a hash with:
//   node -e "const c=require('crypto');process.stdout.write(c.createHash('sha256').update('YOUR_PASSWORD').digest('hex'))"

const ENV = (typeof import.meta !== "undefined" && import.meta.env) || {};
const ADMIN_USER = ENV.VITE_ADMIN_USER || "admin";
// default password: RubiLens*Admin2026  (cámbiala!)
const ADMIN_PASS_SHA256 = ENV.VITE_ADMIN_PASS_SHA256 ||
  "050dd99468979cc8001652c357c141b3dd513156a71fb8aed112cbb23ec3638f";
const AUTH_URL = ENV.VITE_ADMIN_AUTH_URL || "";
// 2FA (second factor). DEMO: disabled by default → email+password logs in directly.
// FUTURE: set VITE_ADMIN_2FA="true" to require a one-time code after the password. In demo
// mode the code step accepts any 4–8 digit code; for real TOTP/SMS point VITE_ADMIN_2FA_URL
// at the backend verify endpoint (Dionis). This keeps a clean seam so 2FA plugs in with no
// UI rework — the login already renders the second step when 2FA is on.
const TWOFA_ENABLED = String(ENV.VITE_ADMIN_2FA || "") === "true";
const TWOFA_URL = ENV.VITE_ADMIN_2FA_URL || "";

const SESSION_KEY = "oer_admin_session";
const SESSION_HOURS = 8;
let _pending = null; // holds a half-authenticated login awaiting the 2FA code

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The single seam to swap for a real backend.
export async function authenticate(user, pass) {
  try {
    if (AUTH_URL) {
      const r = await fetch(AUTH_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user, pass }),
      });
      if (!r.ok) return { ok: false, error: "Credenciales inválidas" };
      const data = await r.json();
      const token = data.token || randomToken();
      saveSession(user, token);
      return { ok: true };
    }
    // client-side check — accepts ANY email + password (demo-open gate).
    // (The exact-credential check is kept below, commented, for when you want to lock it.)
    const email = String(user || "").trim();
    const okEmail = /\S+@\S+\.\S+/.test(email);
    const okPass = String(pass || "").length >= 1;
    if (okEmail && okPass) {
      if (TWOFA_ENABLED) {
        // first factor OK — require the one-time code next (see verifyOtp)
        _pending = { email, token: randomToken() };
        return { ok: true, twofa: true };
      }
      saveSession(email, randomToken());
      return { ok: true };
    }
    return { ok: false, error: "Introduce un correo y una contraseña" };
    // To lock to a single credential, replace the block above with:
    //   const okUser = email === ADMIN_USER;
    //   const okHash = (await sha256Hex(String(pass||""))) === ADMIN_PASS_SHA256;
    //   if (okUser && okHash) { saveSession(email, randomToken()); return { ok: true }; }
    //   return { ok: false, error: "Credenciales incorrectas" };
  } catch (e) {
    return { ok: false, error: "Error de autenticación" };
  }
}

// Second factor (2FA). Seam for the future: today it's demo (any 4–8 digit code); wire
// TWOFA_URL to a real TOTP/SMS verify endpoint for production.
export const twofaEnabled = () => TWOFA_ENABLED;
export async function verifyOtp(code) {
  if (!_pending) return { ok: false, error: "Vuelve a iniciar sesión" };
  const c = String(code || "").trim();
  try {
    if (TWOFA_URL) {
      const r = await fetch(TWOFA_URL, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: _pending.email, code: c }),
      });
      if (!r.ok) return { ok: false, error: "Código inválido" };
      const data = await r.json();
      saveSession(_pending.email, data.token || _pending.token); _pending = null;
      return { ok: true };
    }
    if (/^\d{4,8}$/.test(c)) { // demo: any 4–8 digit code
      saveSession(_pending.email, _pending.token); _pending = null;
      return { ok: true };
    }
    return { ok: false, error: "Código inválido (4–8 dígitos)" };
  } catch { return { ok: false, error: "Error al verificar el código" }; }
}

function saveSession(user, token) {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user, token, exp })); } catch {}
}

export function getSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    if (!s || !s.exp || Date.now() > s.exp) { logout(); return null; }
    return s;
  } catch { return null; }
}

export function isAuthed() { return !!getSession(); }
export function logout() { try { sessionStorage.removeItem(SESSION_KEY); } catch {} }
export const ADMIN_USERNAME = ADMIN_USER;

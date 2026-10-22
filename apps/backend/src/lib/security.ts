import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { clientIp } from "./client-ip";
import { createRateLimit } from "./rate-limit";

/**
 * Security hardening shared by `src/api/middlewares.ts` and the admin
 * security report (`GET /admin/security-status`).
 *
 * Everything here is deliberately conservative: nothing changes behaviour for
 * a legitimate storefront or panel session, and every switch has an env
 * override so an operator can relax it without a deploy.
 */

// ── Admin login brute force ─────────────────────────────────────────────────
// Medusa's `/auth/user/emailpass` has no throttle of its own: an attacker can
// try passwords as fast as the server answers. 10 attempts per 15 minutes per
// IP, and per email, is far above what a person needs and far below a crack.
export const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const ADMIN_LOGIN_MAX = 10;

export const adminLoginRateLimit = createRateLimit({
  name: "admin-login",
  windowMs: ADMIN_LOGIN_WINDOW_MS,
  max: ADMIN_LOGIN_MAX,
  maxEnv: "ADMIN_LOGIN_RATE_LIMIT",
  keys: (req) => {
    const keys = [`ip:${clientIp(req)}`];
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body["email"] === "string" ? body["email"].trim().toLowerCase() : "";
    if (email) keys.push(`email:${email}`);
    return keys;
  },
  message: "Too many sign-in attempts. Wait a few minutes and try again.",
});

// ── Self-registration of admin identities ───────────────────────────────────
// `POST /auth/user/emailpass/register` lets anyone create an auth identity for
// the `user` actor. Alone it cannot open the panel (a `user` row is still
// needed), but it is an unauthenticated write that seeds the auth table and a
// stepping stone for the invite flow. This store creates administrators with
// the CLI (`npx medusa user`), never through invites, so the route is closed.
// ADMIN_SELF_REGISTER=1 reopens it for a deployment that does use invites.
export function selfRegisterAllowed(): boolean {
  return process.env.ADMIN_SELF_REGISTER === "1";
}

export function blockAdminSelfRegister(
  _req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void {
  if (selfRegisterAllowed()) return next();
  res.status(404).json({ type: "not_found", message: "Not found." });
}

// ── Response headers ────────────────────────────────────────────────────────
// Applied to every response the API serves (JSON routes and the built-in admin
// dashboard under /app). None of them affects the storefront, which lives on
// another origin and gets its own headers from vercel.json.
export const SECURITY_HEADERS: Record<string, string> = {
  // Browsers that reached us over HTTPS keep using HTTPS for a year.
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  // Never sniff JSON/uploads into something executable.
  "X-Content-Type-Options": "nosniff",
  // The API and the Medusa dashboard are never meant to be framed.
  "X-Frame-Options": "DENY",
  // Only the origin travels in Referer to third parties.
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Nothing served here needs device access.
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "X-DNS-Prefetch-Control": "off",
};

export function securityHeaders(
  _req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!res.getHeader(k)) res.setHeader(k, v);
  }
  next();
}

// ── Audit (what the owner sees in the panel) ────────────────────────────────
export interface SecurityCheck {
  key: string;
  ok: boolean;
  /** Short machine detail the panel can show verbatim (never a secret). */
  detail?: string;
}

export interface SecurityAudit {
  checked_at: string;
  node_env: string;
  strict_mode: boolean;
  checks: SecurityCheck[];
  /** Count of failing checks. */
  failing: number;
}

const WEAK_DEFAULT = "change-me-in-production";

function secretStrong(name: string, env: NodeJS.ProcessEnv): boolean {
  const v = (env[name] || "").trim();
  return Boolean(v) && v !== WEAK_DEFAULT && v.length >= 16;
}

function isHttps(url: string | undefined): boolean {
  return /^https:\/\//i.test((url || "").trim());
}

function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).host : "";
  } catch {
    return "";
  }
}

/**
 * Pure function over the environment so it is unit-testable; the route just
 * serialises it. It reports presence/strength only — never a value.
 */
export function securityAudit(env: NodeJS.ProcessEnv = process.env, now: () => Date = () => new Date()): SecurityAudit {
  const checks: SecurityCheck[] = [];
  const production = env.NODE_ENV === "production";

  for (const name of ["JWT_SECRET", "COOKIE_SECRET", "ORDER_ACCESS_SECRET"]) {
    checks.push({ key: `secret.${name}`, ok: secretStrong(name, env) });
  }
  checks.push({ key: "secret.VISION_INTERNAL_SECRET", ok: Boolean((env.VISION_INTERNAL_SECRET || "").trim()) });
  checks.push({ key: "storage.prescription_bucket", ok: Boolean(env.R2_PRESCRIPTION_BUCKET) });
  checks.push({ key: "node_env.production", ok: production, detail: env.NODE_ENV || "" });
  checks.push({ key: "security.strict_mode", ok: env.SECURITY_STRICT === "1" });
  checks.push({ key: "auth.self_register_blocked", ok: env.ADMIN_SELF_REGISTER !== "1" });
  checks.push({
    key: "auth.login_rate_limit",
    ok: true,
    detail: `${Number(env.ADMIN_LOGIN_RATE_LIMIT) > 0 ? env.ADMIN_LOGIN_RATE_LIMIT : ADMIN_LOGIN_MAX}/15min`,
  });

  const cors = (env.STORE_CORS || "").split(",").map((s) => s.trim()).filter(Boolean);
  // In production every trusted storefront origin must be https (a stray
  // http://localhost entry would let a plain-http page call the API).
  checks.push({
    key: "cors.store_https_only",
    ok: cors.length > 0 && cors.every((o) => isHttps(o)),
    detail: `${cors.length} origin(s)`,
  });
  checks.push({ key: "urls.storefront_https", ok: isHttps(env.STOREFRONT_URL), detail: hostOf(env.STOREFRONT_URL) });
  checks.push({ key: "urls.backend_https", ok: isHttps(env.BACKEND_URL), detail: hostOf(env.BACKEND_URL) });

  const stripe = (env.STRIPE_SECRET_KEY || "").trim();
  checks.push({
    key: "payments.stripe_mode",
    ok: stripe.startsWith("sk_live_"),
    detail: stripe.startsWith("sk_live_") ? "live" : stripe.startsWith("sk_test_") ? "test" : "unset",
  });
  checks.push({ key: "payments.stripe_webhook_secret", ok: (env.STRIPE_WEBHOOK_SECRET || "").startsWith("whsec_") });
  checks.push({ key: "payments.stripe_key_is_secret", ok: !stripe || stripe.startsWith("sk_") || stripe.startsWith("rk_") });

  checks.push({ key: "notifications.email_provider", ok: Boolean(env.RESEND_API_KEY) });
  checks.push({ key: "notifications.sms_provider", ok: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER) });
  checks.push({ key: "sheet.configured", ok: Boolean(env.GSHEET_FILE_URL && env.GSHEET_SERVICE_ACCOUNT_EMAIL && env.GSHEET_SERVICE_ACCOUNT_KEY) });
  checks.push({ key: "ocr.api_key", ok: Boolean(env.ANTHROPIC_API_KEY) });

  const failing = checks.filter((c) => !c.ok).length;
  return { checked_at: now().toISOString(), node_env: env.NODE_ENV || "", strict_mode: env.SECURITY_STRICT === "1", checks, failing };
}

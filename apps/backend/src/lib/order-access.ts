import crypto from "crypto";

/**
 * Signed, stateless tokens that let a guest see their own orders.
 *
 * Checkout is guest-only, so there is no Medusa customer session to lean on.
 * Rather than bolt on passwords, identity here is "proved control of an email
 * address": we mail a short-lived link, and redeeming it yields a long-lived
 * token the storefront keeps so the shopper never has to dig through their inbox
 * again. That is the whole point of the feature — one page listing every order.
 *
 * Two token kinds, deliberately not interchangeable (`purpose` is signed):
 *   magic   — minted by /store/order-access/request, minutes long, single hop.
 *             It travels through email, which is replayable and often archived
 *             forever, so it must expire fast.
 *   session — minted by /store/order-access/verify, months long, lives in the
 *             browser. Never sent by email.
 *
 * Stateless on purpose: no table, no migration. The trade-off is that an issued
 * token cannot be individually revoked — rotating ORDER_ACCESS_SECRET
 * invalidates every outstanding token at once, which is the escape hatch.
 */

export type TokenPurpose = "magic" | "session";

/** Magic links are mailed, so they expire fast. */
const MAGIC_TTL_MS = 30 * 60 * 1000; // 30 minutes
/** Session tokens live in the shopper's browser. */
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export const ORDER_ACCESS_TTL_MS: Record<TokenPurpose, number> = {
  magic: MAGIC_TTL_MS,
  session: SESSION_TTL_MS,
};

/**
 * Signing key. Falls back to the secrets Medusa already requires so a deployment
 * that has not set the dedicated var still works; throws only if nothing at all
 * is configured, because signing with a constant would make tokens forgeable.
 */
function secret(): string {
  const value =
    process.env.ORDER_ACCESS_SECRET ||
    process.env.JWT_SECRET ||
    process.env.COOKIE_SECRET ||
    "";
  if (!value) {
    throw new Error(
      "ORDER_ACCESS_SECRET (or JWT_SECRET) must be set to issue order-access tokens."
    );
  }
  return value;
}

/** URL-safe base64 without padding, so tokens survive query strings intact. */
function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

interface TokenPayload {
  /** Normalized email the token grants access to. */
  email: string;
  purpose: TokenPurpose;
  /** Expiry, epoch ms. */
  exp: number;
}

function sign(payloadB64: string): string {
  return b64url(crypto.createHmac("sha256", secret()).update(payloadB64).digest());
}

/** Emails are compared as identifiers, so normalize before signing. */
export function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function issueToken(email: string, purpose: TokenPurpose): string {
  const payload: TokenPayload = {
    email: normalizeEmail(email),
    purpose,
    exp: Date.now() + ORDER_ACCESS_TTL_MS[purpose],
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export interface VerifiedToken {
  email: string;
  purpose: TokenPurpose;
  exp: number;
}

/**
 * Returns the payload when the token is intact, unexpired and of the expected
 * kind; `null` otherwise. Callers must treat null as "no access" without saying
 * which check failed — distinguishing "expired" from "forged" in a response
 * gives an attacker a signal for free.
 */
export function verifyToken(
  token: unknown,
  expected: TokenPurpose
): VerifiedToken | null {
  if (typeof token !== "string" || !token.includes(".")) return null;

  const idx = token.lastIndexOf(".");
  const body = token.slice(0, idx);
  const signature = token.slice(idx + 1);
  if (!body || !signature) return null;

  let expectedSig: string;
  try {
    expectedSig = sign(body);
  } catch {
    return null; // no secret configured — fail closed
  }

  // Constant-time compare: a byte-by-byte early exit leaks the signature.
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(fromB64url(body).toString("utf8")) as TokenPayload;
  } catch {
    return null;
  }

  if (!payload || typeof payload.email !== "string" || !payload.email) return null;
  if (payload.purpose !== expected) return null;
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;

  return { email: payload.email, purpose: payload.purpose, exp: payload.exp };
}

/** Reads a session token from `Authorization: Bearer …` or the `token` query. */
export function readSessionToken(req: {
  headers: Record<string, unknown>;
  query?: Record<string, unknown>;
}): string | null {
  const auth = req.headers["authorization"];
  const header = Array.isArray(auth) ? auth[0] : auth;
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() || null;
  }
  const q = req.query?.["token"];
  if (typeof q === "string" && q) return q;
  return null;
}

/** Absolute URL of the storefront page that redeems a magic link. */
export function buildMagicLink(token: string): string {
  const base = (
    process.env.STOREFRONT_URL ||
    process.env.STORE_CORS?.split(",")[0] ||
    "http://localhost:5173"
  ).trim().replace(/\/+$/, "");
  return `${base}/mis-pedidos?token=${encodeURIComponent(token)}`;
}

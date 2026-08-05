import crypto from "crypto";

/**
 * Signed, stateless proof that the bearer wrote a particular review.
 *
 * Reviews are open to anyone and publish immediately, so there is no account to
 * hang authorship on. Editing and deleting still have to be limited to the
 * author, and `author_email` cannot do that job: it is client-supplied, so
 * trusting it would let anyone delete anyone's review just by typing their
 * address.
 *
 * Instead, POST returns a token bound to the new review's id, and the browser
 * keeps it. Holding the token IS the proof of authorship — the same trade the
 * order-access tokens make (see lib/order-access.ts), and deliberately the same
 * shape so there is one idiom in this codebase rather than two.
 *
 * Stateless: no table, no migration, and no way to revoke one token on its own.
 * Rotating the secret invalidates every outstanding edit token at once, which
 * is the escape hatch. Losing the token means losing the ability to edit, which
 * is an acceptable outcome for an anonymous review.
 */

/** Long-lived: the browser is the only place this is kept. */
const REVIEW_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

function secret(): string {
  const value =
    process.env.ORDER_ACCESS_SECRET ||
    process.env.JWT_SECRET ||
    process.env.COOKIE_SECRET ||
    "";
  if (!value) {
    throw new Error(
      "ORDER_ACCESS_SECRET (or JWT_SECRET) must be set to issue review edit tokens."
    );
  }
  return value;
}

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

interface ReviewTokenPayload {
  /** Review this token authorises. */
  rid: string;
  /** Expiry, epoch milliseconds. */
  exp: number;
}

/** Mints the token handed back to whoever just created `reviewId`. */
export function issueReviewToken(reviewId: string): string {
  const payload: ReviewTokenPayload = {
    rid: reviewId,
    exp: Date.now() + REVIEW_TOKEN_TTL_MS,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}

/**
 * True when `token` is a valid, unexpired token for `reviewId`.
 *
 * The signature is compared with `timingSafeEqual`: a plain `===` leaks how much
 * of a forged signature was correct, which is enough to reconstruct one byte at
 * a time.
 */
export function verifyReviewToken(token: unknown, reviewId: string): boolean {
  if (typeof token !== "string" || !token.includes(".")) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;

  let expected: Buffer;
  try {
    expected = crypto.createHmac("sha256", secret()).update(body).digest();
  } catch {
    return false;
  }
  const given = fromB64url(sig);
  if (given.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(given, expected)) return false;

  try {
    const payload = JSON.parse(fromB64url(body).toString("utf8")) as ReviewTokenPayload;
    if (payload.rid !== reviewId) return false;
    return typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

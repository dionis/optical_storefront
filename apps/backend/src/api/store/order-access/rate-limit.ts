import { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

/**
 * Rate limit for the unauthenticated order-access endpoints (magic-link request
 * and the support message form).
 *
 * Both send mail on behalf of an anonymous caller, so the ceiling protects two
 * different victims: the store's sending reputation, and whoever owns the email
 * address being targeted. Limiting by IP alone would let one host walk a list of
 * addresses; limiting by address alone would let one host hammer many. We count
 * both keys and reject when either is exhausted.
 *
 * State is per-process and in memory — same trade-off (and same caveat about
 * horizontal scaling) as `ocrRateLimit`, which this mirrors deliberately.
 */
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function limitPerWindow(): number {
  const raw = Number(process.env.ORDER_ACCESS_RATE_LIMIT_PER_HOUR);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 10;
}

const hits = new Map<string, number[]>();

function sweep(now: number): void {
  for (const [key, times] of hits) {
    const live = times.filter((t) => now - t < WINDOW_MS);
    if (live.length === 0) hits.delete(key);
    else hits.set(key, live);
  }
}

let lastSweep = 0;

function clientIp(req: MedusaRequest): string {
  // Behind Coolify's proxy the socket address is the proxy, so prefer the
  // forwarded chain's first entry (the original client).
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw) return raw.split(",")[0].trim();
  return req.ip || req.socket.remoteAddress || "unknown";
}

/** Keys this request is metered against: the caller, and the address targeted. */
function keysFor(req: MedusaRequest): string[] {
  const keys = [`ip:${clientIp(req)}`];
  const body = (req.body ?? {}) as Record<string, unknown>;
  const email = typeof body["email"] === "string" ? body["email"].trim().toLowerCase() : "";
  if (email) keys.push(`email:${email}`);
  return keys;
}

export function orderAccessRateLimit(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void {
  const now = Date.now();
  const max = limitPerWindow();

  if (now - lastSweep > WINDOW_MS) {
    sweep(now);
    lastSweep = now;
  }

  const keys = keysFor(req);
  const windows = keys.map((k) => (hits.get(k) ?? []).filter((t) => now - t < WINDOW_MS));

  const exhausted = windows.findIndex((times) => times.length >= max);
  if (exhausted !== -1) {
    const retryAfterMs = WINDOW_MS - (now - windows[exhausted][0]);
    res.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
    res.status(429).json({
      error:
        "Demasiadas solicitudes. Espera un momento antes de volver a intentarlo.",
    });
    return;
  }

  keys.forEach((k, i) => {
    windows[i].push(now);
    hits.set(k, windows[i]);
  });
  next();
}

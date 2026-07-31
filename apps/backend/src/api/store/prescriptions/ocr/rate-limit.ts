import { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

/**
 * Rate limit for the public OCR endpoint.
 *
 * This endpoint is unauthenticated, accepts 10 MB uploads, and every call spends
 * money at a third-party API. Without a ceiling, a single script can turn an
 * unbounded bill into the cheapest denial-of-service there is. The limit is a
 * cost control first and an abuse control second.
 *
 * State is per-process and in memory. That is sufficient for the current
 * single-instance deployment; if the backend is ever scaled horizontally this
 * must move to the Redis the project already runs, or each replica will grant
 * its own quota.
 */
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function limitPerWindow(): number {
  const raw = Number(process.env.OCR_RATE_LIMIT_PER_HOUR);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 20;
}

const hits = new Map<string, number[]>();

/** Drop windows that have fully expired so the map cannot grow without bound. */
function sweep(now: number): void {
  for (const [key, times] of hits) {
    const live = times.filter((t) => now - t < WINDOW_MS);
    if (live.length === 0) hits.delete(key);
    else hits.set(key, live);
  }
}

let lastSweep = 0;

function clientKey(req: MedusaRequest): string {
  // Behind Coolify's proxy the socket address is the proxy, so prefer the
  // forwarded chain's first entry (the original client).
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw) return raw.split(",")[0].trim();
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function ocrRateLimit(
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

  const key = clientKey(req);
  const times = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);

  if (times.length >= max) {
    const retryAfterMs = WINDOW_MS - (now - times[0]);
    res.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
    res.status(429).json({
      error:
        "Has superado el límite de lecturas automáticas. Inténtalo más tarde o ingresa tu receta manualmente.",
      fallback: true,
    });
    return;
  }

  times.push(now);
  hits.set(key, times);
  next();
}

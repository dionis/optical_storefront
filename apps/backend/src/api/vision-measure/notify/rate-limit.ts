import { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

/**
 * Rate limit for POST /vision-measure/notify.
 *
 * The shared secret (VISION_INTERNAL_SECRET, checked in route.ts) is the real gate: this
 * route is meant to be called only by the vision-measure process. But that secret is
 * optional — a deployment can run without it, same as the OCR endpoint's rate limit is a
 * cost control first and an abuse control second — and every call here can send a real
 * email/SMS/WhatsApp. Same in-memory, per-process pattern as
 * ../../store/prescriptions/ocr/rate-limit.ts; move it to Redis if this ever scales
 * horizontally.
 */
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function limitPerWindow(): number {
  const raw = Number(process.env.VISION_NOTIFY_RATE_LIMIT_PER_HOUR);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 30;
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

function clientKey(req: MedusaRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw) return raw.split(",")[0].trim();
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function visionNotifyRateLimit(
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
    const retryAfterSeconds = Math.ceil((WINDOW_MS - (now - times[0])) / 1000);
    res.setHeader("Retry-After", String(retryAfterSeconds));
    res.status(429).json({ ok: false, error: "Too many notification requests." });
    return;
  }

  times.push(now);
  hits.set(key, times);
  next();
}

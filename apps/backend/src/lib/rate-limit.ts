import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { clientIp } from "./client-ip";

/**
 * Generic fixed-window rate limiter for unauthenticated or sensitive routes.
 *
 * The three limiters that predate this (OCR, order-access, vision notify) each
 * carry their own copy of the same sliding window; they are left untouched —
 * they work and have tests — and this factory exists so every NEW limit (admin
 * login, auth registration…) is one line instead of another 80-line copy.
 *
 * State is per process and in memory. With one backend container (the current
 * deployment) that is exact; behind a horizontal scale-out each replica meters
 * on its own, which only loosens the ceiling by the replica count — acceptable
 * for a brute-force backstop, and documented so nobody mistakes it for a quota.
 */
export interface RateLimitOptions {
  /** Short label for logs and tests. */
  name: string;
  windowMs: number;
  /** Max hits per key per window. */
  max: number;
  /** Keys a request is metered against; default: the client IP. */
  keys?: (req: MedusaRequest) => string[];
  /** Env var that overrides `max` at runtime (0 or unset = keep `max`). */
  maxEnv?: string;
  /** JSON body for the 429. */
  message?: string;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface RateLimiter {
  (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void;
  /** Drops all counters (tests). */
  reset(): void;
  /** Current hit count for a key within the window. */
  count(key: string): number;
}

export function createRateLimit(options: RateLimitOptions): RateLimiter {
  const hits = new Map<string, number[]>();
  const now = options.now ?? Date.now;
  let lastSweep = 0;

  const limit = (): number => {
    const raw = options.maxEnv ? Number(process.env[options.maxEnv]) : NaN;
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : options.max;
  };

  const sweep = (t: number): void => {
    for (const [key, times] of hits) {
      const live = times.filter((x) => t - x < options.windowMs);
      if (live.length === 0) hits.delete(key);
      else hits.set(key, live);
    }
  };

  const middleware = ((req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void => {
    const t = now();
    const max = limit();
    if (t - lastSweep > options.windowMs) {
      sweep(t);
      lastSweep = t;
    }
    const keys = options.keys ? options.keys(req) : [`ip:${clientIp(req)}`];
    const windows = keys.map((k) => (hits.get(k) ?? []).filter((x) => t - x < options.windowMs));
    const exhausted = windows.findIndex((times) => times.length >= max);
    if (exhausted !== -1) {
      const retryAfterMs = options.windowMs - (t - windows[exhausted][0]);
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      res.status(429).json({
        type: "rate_limit",
        reason: "too_many_requests",
        message: options.message ?? "Too many requests. Try again later.",
      });
      return;
    }
    keys.forEach((k, i) => {
      windows[i].push(t);
      hits.set(k, windows[i]);
    });
    next();
  }) as RateLimiter;

  middleware.reset = () => {
    hits.clear();
    lastSweep = 0;
  };
  middleware.count = (key: string) => (hits.get(key) ?? []).filter((x) => now() - x < options.windowMs).length;
  // A named function helps the arity/registration test name offenders.
  Object.defineProperty(middleware, "name", { value: `rateLimit:${options.name}` });
  return middleware;
}

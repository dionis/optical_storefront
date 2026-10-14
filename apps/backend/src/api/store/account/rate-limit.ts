import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { clientIp } from "../../../lib/client-ip";

/**
 * Límite anti fuerza-bruta de las rutas de cuenta (register/login): 10 intentos
 * por IP real cada 15 minutos. En memoria por proceso — suficiente para un
 * despliegue de un contenedor; el barrido acota el Map.
 */
const WINDOW_MS = 15 * 60_000;
const LIMIT = 10;
const hits = new Map<string, { n: number; reset: number }>();

export function accountRateLimit(req: MedusaRequest, res: MedusaResponse): boolean {
  const now = Date.now();
  const key = clientIp(req);
  const cur = hits.get(key);
  if (!cur || cur.reset <= now) {
    hits.set(key, { n: 1, reset: now + WINDOW_MS });
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    return true;
  }
  cur.n += 1;
  if (cur.n > LIMIT) {
    res.status(429).json({ type: "rate_limit", reason: "too_many_attempts", message: "Too many attempts. Try again in a few minutes." });
    return false;
  }
  return true;
}

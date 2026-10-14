import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * vision-measure (apps/vision-measure) runs as a second process inside this
 * same container — see apps/backend/Dockerfile — reachable only on
 * localhost. It is never exposed on its own domain: every route in this
 * folder is a thin passthrough so the storefront keeps talking to one origin
 * (the existing `/medusa` proxy) instead of needing a second Coolify app, a
 * second domain, and a second CORS allowlist to manage.
 */
const VISION_MEASURE_URL =
  process.env.VISION_MEASURE_INTERNAL_URL || "http://127.0.0.1:8008"

// ── Guardia anti-abuso ───────────────────────────────────────────────────────
// Estas rutas disparan llamadas de PAGO a proveedores de IA con las claves del
// SERVIDOR y estaban abiertas a Internet sin auth ni límite: cualquiera podía
// quemar el crédito de OpenAI/Anthropic/Gemini. Ahora toda llamada que no sea
// GET exige la clave publicable del storefront (pública, pero corta el abuso
// anónimo por script) y pasa por una cuota por IP real: ráfaga por hora y tope
// diario. Los GET baratos (health, providers, estado de un job) quedan libres.
import { clientIp } from "../../lib/client-ip"

const HOUR_LIMIT = Math.max(1, parseInt(process.env.VISION_PROXY_HOURLY_LIMIT || "10", 10) || 10)
const DAY_LIMIT = Math.max(1, parseInt(process.env.VISION_PROXY_DAILY_LIMIT || "30", 10) || 30)
const hourHits = new Map<string, { n: number; reset: number }>()
const dayHits = new Map<string, { n: number; reset: number }>()

function bump(map: Map<string, { n: number; reset: number }>, key: string, windowMs: number): number {
  const now = Date.now()
  const cur = map.get(key)
  if (!cur || cur.reset <= now) {
    map.set(key, { n: 1, reset: now + windowMs })
    if (map.size > 10_000) {
      for (const [k, v] of map) if (v.reset <= now) map.delete(k)
    }
    return 1
  }
  cur.n += 1
  return cur.n
}

/** true → puede seguir; false → la respuesta ya se escribió (429).
 *  La cuota por IP real es la protección efectiva contra quemar el crédito de
 *  IA; no se exige la clave publicable porque los clientes desplegados
 *  (storefront y vto-web) no la mandan todavía — queda anotado en el plan. */
export function guardVisionProxy(req: MedusaRequest, res: MedusaResponse): boolean {
  const ip = clientIp(req)
  if (bump(hourHits, ip, 3600_000) > HOUR_LIMIT || bump(dayHits, ip, 86_400_000) > DAY_LIMIT) {
    res.status(429).json({ ok: false, error: "Too many measurement requests. Try again later." })
    return false
  }
  return true
}

/** Forwards the request to vision-measure's `targetPath` and relays the response as-is. */
export async function proxyToVisionMeasure(
  req: MedusaRequest,
  res: MedusaResponse,
  targetPath: string
): Promise<void> {
  // Las llamadas con cuerpo (medición, job, modelos) son las caras: guardia.
  if (req.method !== "GET" && !guardVisionProxy(req, res)) return
  const queryIndex = req.url.indexOf("?")
  const search = queryIndex === -1 ? "" : req.url.slice(queryIndex)
  const url = `${VISION_MEASURE_URL}${targetPath}${search}`

  let upstream: Response
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers: { "Content-Type": "application/json" },
      // GET carries no body; every other method here is JSON (vision-measure
      // has no multipart routes — photos travel as base64 data URLs).
      body: req.method === "GET" ? undefined : JSON.stringify(req.body ?? {}),
    })
  } catch {
    // The process is down or still starting — distinguish this from a
    // vision-measure-reported failure, which arrives as HTTP 200 with
    // {ok:false} per that service's own convention.
    res.status(502).json({
      ok: false,
      error: "El servicio de medición no está disponible en este momento.",
    })
    return
  }

  const text = await upstream.text()
  res
    .status(upstream.status)
    .setHeader("Content-Type", upstream.headers.get("content-type") || "application/json")
  res.send(text)
}

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

/** Forwards the request to vision-measure's `targetPath` and relays the response as-is. */
export async function proxyToVisionMeasure(
  req: MedusaRequest,
  res: MedusaResponse,
  targetPath: string
): Promise<void> {
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

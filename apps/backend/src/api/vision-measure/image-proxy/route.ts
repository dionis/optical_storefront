import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { proxyToVisionMeasure } from "../proxy"

/** Downloads a product photo server-side (see vision_api.py for the allowlist/why). */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await proxyToVisionMeasure(req, res, "/api/vision-measure/image-proxy")
}

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { proxyToVisionMeasure } from "../proxy"

/**
 * Starts an ASYNC measurement + AI try-on render job and returns its id at once.
 * The render (patient wearing the frame) can run past the edge proxy's ~120s cut,
 * so the browser polls GET /vision-measure/job/:id instead of holding one long
 * request open. The generation flow is never cut.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await proxyToVisionMeasure(req, res, "/api/vision-measure/job")
}

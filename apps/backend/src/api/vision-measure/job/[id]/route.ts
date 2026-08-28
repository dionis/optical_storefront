import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { proxyToVisionMeasure } from "../../proxy"

/**
 * Polls the status/result of an async measurement + render job. Cheap (<1s) so it
 * never approaches the edge proxy's request-time limit, however long the render runs.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String((req.params as { id?: string })?.id || "")
  await proxyToVisionMeasure(
    req,
    res,
    `/api/vision-measure/job/${encodeURIComponent(id)}`
  )
}

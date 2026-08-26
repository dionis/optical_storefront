import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { proxyToVisionMeasure } from "../proxy"

/** Provider/strategy/image-engine catalogue, used to populate the AI panel. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await proxyToVisionMeasure(req, res, "/api/vision-measure/providers")
}

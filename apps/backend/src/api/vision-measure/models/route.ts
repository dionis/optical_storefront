import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { proxyToVisionMeasure } from "../proxy"

/** Live model catalogue for one provider, given an API key. */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await proxyToVisionMeasure(req, res, "/api/vision-measure/models")
}

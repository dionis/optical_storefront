import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { proxyToVisionMeasure } from "./proxy"

/** Runs the measurement (and optionally the composed try-on image). */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await proxyToVisionMeasure(req, res, "/api/vision-measure")
}

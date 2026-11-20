import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { searchPosProducts, type PosProduct } from "../../../../lib/pos-data";
import { posHandler, posScope, sellableStore } from "../../../../lib/pos-route";

export interface PosProductsResponse {
  /**
   * Exposed models matching `q`, best first. Each carries the store price (frame
   * only, before sales tax), its colours (`variants`, with `color`, `sku`,
   * `barcode`, `image`) and the frame card's sheet: `brand`, `model`, `images`
   * (up to four, main first) and `specs` (shape, material, rim, gender,
   * age_group, eye/bridge/temple/lens_width/lens_height in mm).
   */
  products: PosProduct[];
}

/**
 * GET /admin/pos/products?store=est_…&q=… — catalog search with each model's
 * price in that store (frame only, before sales tax) and the specs the POS
 * frame card shows (PosFrameCard.jsx).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const q = req.query as Record<string, string | undefined>;
    const store = await sellableStore(req, await posScope(req), q.store);
    const body: PosProductsResponse = { products: await searchPosProducts(req.scope, store.id, String(q.q ?? "")) };
    res.json(body);
  });
}

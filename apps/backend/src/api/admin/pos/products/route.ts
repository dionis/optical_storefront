import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { searchPosProducts } from "../../../../lib/pos-data";
import { posHandler, posScope, sellableStore } from "../../../../lib/pos-route";

/**
 * GET /admin/pos/products?store=est_…&q=… — catalog search with each model's
 * price in that store (frame only, before sales tax).
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  await posHandler(req, res, async () => {
    const q = req.query as Record<string, string | undefined>;
    const store = await sellableStore(req, await posScope(req), q.store);
    res.json({ products: await searchPosProducts(req.scope, store.id, String(q.q ?? "")) });
  });
}

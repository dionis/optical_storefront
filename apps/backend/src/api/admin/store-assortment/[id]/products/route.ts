import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listEstablishments } from "../../../../../lib/establishments";
import { searchStoreCatalog } from "../../../../../lib/store-assortment-data";

/**
 * GET /admin/store-assortment/:id/products?q=…&brand=…&limit=… — modelos del
 * catálogo (publicados) con su exposición en la tienda. Lo usan el panel de
 * surtido y el buscador de precios exactos: leen el catálogo del servidor, no
 * el que haya cargado el navegador.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "");
  if (!(await listEstablishments(req.scope)).some((e) => e.id === id)) {
    res.status(404).json({ type: "not_found", reason: "store_not_found", message: "Store not found." });
    return;
  }
  const q = req.query as Record<string, string | undefined>;
  res.json({
    products: await searchStoreCatalog(req.scope, id, { q: String(q.q ?? ""), brand: q.brand, limit: Number(q.limit) || undefined }),
  });
}

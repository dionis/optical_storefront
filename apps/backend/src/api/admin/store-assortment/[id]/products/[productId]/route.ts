import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listEstablishments } from "../../../../../../lib/establishments";
import { storeCatalogProduct } from "../../../../../../lib/store-assortment-data";

/**
 * GET /admin/store-assortment/:id/products/:productId — ficha de un modelo en
 * la tienda: fotos y colores, medidas, precio base y precio en la tienda, y si
 * está a la venta (y por qué regla). La pinta el panel de surtido al hacer clic.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "");
  if (!(await listEstablishments(req.scope)).some((e) => e.id === id)) {
    res.status(404).json({ type: "not_found", reason: "store_not_found", message: "Store not found." });
    return;
  }
  const product = await storeCatalogProduct(req.scope, id, String(req.params.productId ?? ""));
  if (!product) {
    res.status(404).json({ type: "not_found", reason: "unknown_product", message: "Product not found." });
    return;
  }
  res.json({ product });
}

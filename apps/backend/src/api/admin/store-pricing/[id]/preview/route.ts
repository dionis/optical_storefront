import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listEstablishments } from "../../../../../lib/establishments";
import { globalPrice, storeLinePrice } from "../../../../../lib/store-pricing";
import { openRules, productPrices } from "../../../../../lib/store-pricing-data";

/**
 * GET /admin/store-pricing/:id/preview?products=prod_A,prod_B&lenses=120
 *
 * Cómo queda el precio de unas monturas en la tienda: precio de Medusa, precio
 * base (con el precio global del dueño si lo hay) y precio en la tienda, solo
 * montura y con unos lentes de ejemplo. Es el mismo cálculo que usará el punto
 * de venta (lib/store-pricing.ts): lo que el dueño ve aquí es lo que se cobrará.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "");
  const q = req.query as Record<string, string | undefined>;
  const ids = String(q.products ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
  const lenses = Math.max(0, Number(q.lenses ?? 0) || 0);

  if (!(await listEstablishments(req.scope)).some((e) => e.id === id)) {
    res.status(404).json({ type: "not_found", reason: "store_not_found", message: "Store not found." });
    return;
  }

  const [rules, products] = await Promise.all([openRules(req.scope, [id]), productPrices(req.scope, ids)]);
  res.json({
    lenses,
    items: products.map((p) => {
      const medusa = p.price ?? 0;
      const input = { establishmentId: id, scope: "frame" as const, target: p.product_id, base: medusa };
      return {
        product_id: p.product_id,
        title: p.title,
        medusa_price: p.price,
        base_price: globalPrice(rules, "frame", p.product_id, medusa),
        frame_only: storeLinePrice(rules, { ...input, lenses: 0 }),
        with_lenses: lenses > 0 ? storeLinePrice(rules, { ...input, lenses }) : null,
      };
    }),
  });
}

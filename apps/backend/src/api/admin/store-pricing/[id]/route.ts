import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { listEstablishments } from "../../../../lib/establishments";
import { openRules, productPrices, storeRuleHistoryView } from "../../../../lib/store-pricing-data";
import { brandOfTarget, isActiveAt } from "../../../../lib/store-pricing";

/**
 * GET /admin/store-pricing/:id — precios de una tienda: su ajuste general
 * vigente, sus precios exactos (con el producto al que pertenecen) y el
 * historial de cambios.
 *
 * `history` (HU-15) trae cada regla de la tienda Y las de la cadena que hereda
 * (`chain: true`), la más reciente primero, con quién la puso
 * (`created_by_name`), quién la cerró (`closed_by_name`), el modelo al que
 * pertenece (`product_title`, `product_sku`) y el valor anterior
 * (`previous_value`, `previous_mode`: la regla que cerró al abrirse esta;
 * `replaced_by` null en una cerrada = se quitó, no se sustituyó). Todo resuelto
 * en lotes en lib/store-pricing-data.ts, nunca una consulta por fila.
 *
 * Fijar precios es solo del dueño y los superadmin (decisión del dueño); la
 * guardia de /admin ya deja fuera al resto de roles. Errores con `reason`; el
 * panel traduce con adm.err.pricing.<reason>.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "");
  const store = (await listEstablishments(req.scope)).find((e) => e.id === id);
  if (!store) {
    res.status(404).json({ type: "not_found", reason: "store_not_found", message: "Store not found." });
    return;
  }

  const now = new Date();
  const rules = (await openRules(req.scope, [id])).filter((r) => r.establishment_id === id && isActiveAt(r, now));
  const general = rules.find((r) => r.scope === "all" && (r.mode === "percent" || r.mode === "delta")) ?? null;
  // A brand price (`brand:<slug>`, v2) is listed apart: it is not a model's exact price.
  const exact = rules.filter((r) => r.scope !== "all" && r.mode === "override" && !brandOfTarget(r.target));
  const brandPrices = rules.filter((r) => r.scope !== "all" && r.mode === "override" && brandOfTarget(r.target));
  const minimums = rules.filter((r) => r.mode === "min");
  const products = new Map(
    (await productPrices(req.scope, [...exact, ...minimums].filter((r) => r.target).map((r) => r.target as string))).map((p) => [p.product_id, p])
  );

  res.json({
    establishment: store,
    adjustment: general ? { mode: general.mode, value: general.value, since: general.valid_from } : null,
    exact: exact.map((r) => ({
      scope: r.scope,
      target: r.target,
      price: r.value,
      since: r.valid_from,
      product_title: products.get(r.target as string)?.title ?? null,
      base_price: products.get(r.target as string)?.price ?? null,
    })),
    // v2: the store's price for every model of a brand (scope frame|case, target brand:<slug>).
    brand_prices: brandPrices.map((r) => ({ scope: r.scope, brand: brandOfTarget(r.target), price: r.value, since: r.valid_from })),
    // Minimum price (HU-16): the store's floor as % of list (scope "all") and per model.
    minimum_floor_pct: minimums.find((r) => r.scope === "all")?.value ?? null,
    minimums: minimums
      .filter((r) => r.scope !== "all")
      .map((r) => ({ scope: r.scope, target: r.target, price: r.value, since: r.valid_from, product_title: products.get(r.target as string)?.title ?? null })),
    history: await storeRuleHistoryView(req.scope, id),
  });
}

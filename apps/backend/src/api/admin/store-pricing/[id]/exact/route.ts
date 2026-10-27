import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { listEstablishments } from "../../../../../lib/establishments";
import { exactPriceDenied } from "../../../../../lib/store-pricing";
import { productPrices, replaceRule } from "../../../../../lib/store-pricing-data";

/**
 * POST /admin/store-pricing/:id/exact { scope: "frame"|"case", target: product_id, price | null }
 *
 * Precio exacto de un modelo en la tienda (todos sus colores: los precios son
 * por modelo): es el precio final de esa montura (o estuche) y el ajuste
 * general no lo toca. `price: null` lo quita y el producto vuelve al precio
 * base ajustado. El producto tiene que existir (reason `unknown_product`).
 */
interface Body {
  scope?: string;
  target?: unknown;
  price?: unknown;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "");
  const body = (req.body ?? {}) as Body;
  const scope = String(body.scope ?? "");

  if (!(await listEstablishments(req.scope)).some((e) => e.id === id)) {
    res.status(404).json({ type: "not_found", reason: "store_not_found", message: "Store not found." });
    return;
  }
  const price = body.price === null || body.price === undefined || body.price === "" ? null : body.price;
  const denied = exactPriceDenied(scope, body.target, price);
  if (denied) {
    res.status(422).json({ type: "invalid_data", reason: denied, message: "Invalid exact price." });
    return;
  }
  const target = String(body.target).trim();
  if (price !== null && !(await productPrices(req.scope, [target])).length) {
    res.status(422).json({ type: "invalid_data", reason: "unknown_product", message: `No catalog product ${target}.` });
    return;
  }

  const actorId = req.auth_context?.actor_id ?? null;
  await replaceRule(
    req.scope,
    { establishmentId: id, scope: scope as "frame" | "case", target, family: "price" },
    price === null ? null : { mode: "override", value: Math.round(Number(price) * 100) / 100, source: "panel" },
    actorId
  );
  req.scope
    .resolve<Logger>(ContainerRegistrationKeys.LOGGER)
    .info(`[store-pricing] ${id}: exact ${scope} ${target} -> ${price ?? "removed"} by ${actorId ?? "?"}`);
  res.json({ ok: true });
}

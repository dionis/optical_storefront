/**
 * The Medusa side of lib/web-pricing.ts: the catalogue the web shop reads
 * (Medusa's own GET /store/products and /store/products/:id) answers with the
 * online store's prices.
 *
 * The storefront reads `variants[].calculated_price.calculated_amount`; Medusa
 * computes it from the variant's price set, which holds ONE price — the
 * master's. The online store's price is a rule on top of it, so it is applied
 * to the body on its way out. Nothing is written: the variant keeps its
 * master price, which is what every other store starts from.
 *
 * A failure never costs the shopper the catalogue: the body goes out as
 * Medusa built it (master prices) and the cart, which prices on its own,
 * still charges the store's price.
 */
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { rewriteProductPrices } from "./web-pricing";

export function webStorePrices(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void {
  const send = res.json.bind(res);
  res.json = ((body?: unknown) => {
    if (res.statusCode >= 400) return send(body);
    rewriteProductPrices(req.scope, body)
      .catch((e: unknown) => {
        try {
          req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER).warn(`[web-pricing] catalogue sent with master prices: ${(e as Error)?.message ?? e}`);
        } catch {
          /* no logger: nothing to add */
        }
      })
      .finally(() => send(body));
    return res;
  }) as typeof res.json;
  next();
}

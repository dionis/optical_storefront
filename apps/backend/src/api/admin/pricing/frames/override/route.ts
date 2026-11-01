import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { mirrorPricesToSheet } from "../../../../../lib/gsheet-sync";
import { loadPricingOverview, productOfVariant, resolvePricingStore } from "../../../../../lib/pricing-overview";
import { exactPriceDenied } from "../../../../../lib/store-pricing";
import { productPrices, replaceRule } from "../../../../../lib/store-pricing-data";

/**
 * POST /admin/pricing/frames/override
 *   { variant_id | product_id, price | null, kind?: "frame" | "case", store? }
 *
 * "If I want to change ONE frame's price despite the rule, I search it and set
 * the price I want." `price: null` removes the exception and the model goes
 * back to the rule. No `store` = the owner's own price (the master, which
 * price-sync keeps on the variants); a `store` = that store's exception.
 *
 * Prices in this shop are per MODEL, not per colour (price-sync writes the same
 * amount on every variant), so a `variant_id` is resolved to its product and
 * the rule is stored against the product. The response carries both ids.
 */
interface Body {
  variant_id?: unknown;
  product_id?: unknown;
  price?: unknown;
  kind?: unknown;
  store?: unknown;
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const body = (req.body ?? {}) as Body;
  const variantId = body.variant_id == null ? "" : String(body.variant_id).trim();
  let productId = body.product_id == null ? "" : String(body.product_id).trim();
  const price = body.price === null || body.price === undefined || body.price === "" ? null : body.price;
  const kind = body.kind === "case" ? "case" : "frame";

  const store = await resolvePricingStore(req.scope, body.store);
  if ("reason" in store) {
    res.status(404).json({ type: "not_found", reason: store.reason, message: "Store not found." });
    return;
  }

  try {
    if (!productId && variantId) {
      productId = (await productOfVariant(req.scope, variantId)) ?? "";
      if (!productId) {
        res.status(422).json({ type: "invalid_data", reason: "unknown_variant", message: `No variant ${variantId}.` });
        return;
      }
    }
    const denied = exactPriceDenied(kind, productId, price);
    if (denied) {
      res.status(422).json({ type: "invalid_data", reason: denied, message: "Invalid price." });
      return;
    }
    if (price !== null && !(await productPrices(req.scope, [productId])).length) {
      res.status(422).json({ type: "invalid_data", reason: "unknown_product", message: `No catalog product ${productId}.` });
      return;
    }

    const actorId = req.auth_context?.actor_id ?? null;
    await replaceRule(
      req.scope,
      { establishmentId: store.storeId, scope: kind, target: productId, family: "price" },
      price === null ? null : { mode: "override", value: Math.round(Number(price) * 100) / 100, source: "pricing-panel" },
      actorId
    );
    const overview = await loadPricingOverview(req.scope, store.storeId);
    logger.info(
      `[pricing] override ${kind} ${productId} -> ${price ?? "removed"} on ${store.storeId ?? "master"} by ${actorId ?? "?"}`
    );
    void mirrorPricesToSheet(req.scope);
    res.json({ frames: overview.frames, product_id: productId, variant_id: variantId || null });
  } catch (error) {
    logger.error(`[pricing] override save failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "save_failed", message: "Could not save the price." });
  }
}

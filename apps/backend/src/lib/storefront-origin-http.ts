/**
 * The Medusa side of lib/storefront-origin.ts: the middleware that scopes a
 * `/store/*` request to the storefront it comes from, the one that records that
 * storefront on the cart (the order inherits `cart.metadata` on completion),
 * and reading it back from an order.
 */
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { ICartModuleService, Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { STOREFRONT_ORIGIN_KEY, orderStorefrontOrigin, requestStorefrontOrigin, withStorefrontOrigin } from "./storefront-origin";

type Req = MedusaRequest & { validatedBody?: unknown; headers: Record<string, string | string[] | undefined> };

/** `/store/*`: links built while answering (magic link, support, PayPal return…) point at the caller's storefront. */
export function storefrontOriginScope(req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction): void {
  withStorefrontOrigin(requestStorefrontOrigin((req as Req).headers), () => next());
}

/**
 * Cart requests whose storefront is recorded on the cart. Create and update
 * may carry `metadata` (Medusa REPLACES it on update), so the key is added to
 * that body; the rest write it straight to the cart before the route runs.
 */
const CART_PATH = /^\/store\/carts(?:\/([^/?#]+)(?:\/(complete|line-items|configured-line))?)?\/?$/;

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

function stampBody(body: unknown, origin: string, create: boolean): boolean {
  if (!isRecord(body)) return false;
  if (isRecord(body.metadata)) {
    body.metadata[STOREFRONT_ORIGIN_KEY] = origin;
    return true;
  }
  if (create) {
    body.metadata = { [STOREFRONT_ORIGIN_KEY]: origin };
    return true;
  }
  return false;
}

export async function captureCartOrigin(req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction): Promise<void> {
  try {
    const origin = requestStorefrontOrigin((req as Req).headers);
    const match = origin ? CART_PATH.exec(String(req.originalUrl ?? req.url ?? "").split("?")[0]) : null;
    if (origin && match) {
      const [, cartId, action] = match;
      const r = req as Req;
      // Create / update: into the body (whichever copy the route reads — validation may
      // already have run). Line-item bodies are left alone: their `metadata` is the line's.
      const stamped = !action && [stampBody(r.body, origin, !cartId), stampBody(r.validatedBody, origin, !cartId)].some(Boolean);
      if (cartId && !stamped) {
        const carts = req.scope.resolve<ICartModuleService>(Modules.CART);
        const cart = await carts.retrieveCart(cartId, { select: ["id", "metadata", "completed_at"] });
        const md = (cart.metadata ?? {}) as Record<string, unknown>;
        if (!cart.completed_at && md[STOREFRONT_ORIGIN_KEY] !== origin) {
          await carts.updateCarts(cartId, { metadata: { ...md, [STOREFRONT_ORIGIN_KEY]: origin } });
        }
      }
    }
  } catch (e) {
    // Never blocks a purchase: without it the order's links use STOREFRONT_URL.
    req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER).warn(`[storefront-origin] could not record the cart's storefront: ${(e as Error).message}`);
  }
  next();
}

/** The storefront an order was bought on, or null (then links use STOREFRONT_URL). */
export async function orderOriginById(container: MedusaContainer, orderId: string): Promise<string | null> {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data } = await query.graph({ entity: "order", fields: ["id", "metadata"], filters: { id: orderId } });
    return orderStorefrontOrigin((data?.[0] as { metadata?: Record<string, unknown> | null } | undefined)?.metadata);
  } catch {
    return null;
  }
}

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { ICartModuleService, Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  addShippingMethodToCartWorkflow,
  listShippingOptionsForCartWorkflow,
} from "@medusajs/medusa/core-flows";
import { isShippableCountry, quoteCarrier } from "../../../../../lib/shipping-rates";

/**
 * POST /store/carts/:id/shipping-select — el cliente ELIGE transportista
 * (fedex | dhl) y el servidor fija el método de envío del carrito con la
 * tarifa RE-COTIZADA aquí (nunca la que diga el cliente):
 *
 *   1. valida USA-solo y re-cotiza con la tabla del servidor;
 *   2. asegura un método de envío Medusa en el carrito (la opción base de la
 *      tienda) para que los totales/impuestos del pedido lo integren;
 *   3. sobreescribe ese método con el NOMBRE del transportista elegido y su
 *      importe — ese nombre viaja al pedido y es lo que el panel admin muestra
 *      en "Envío" (el dueño ve exactamente qué opción escogió el cliente);
 *   4. guarda carrier y cotización en metadata del carrito (auditoría).
 */
interface Body {
  carrier?: string;
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { id: cart_id } = req.params as { id: string };
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const carrier = String(((req.body ?? {}) as Body).carrier ?? "").toLowerCase();

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id", "item_total", "completed_at", "metadata",
      "shipping_address.country_code",
      "shipping_methods.id", "shipping_methods.amount", "shipping_methods.name",
    ],
    filters: { id: cart_id },
  });
  const cart = carts?.[0] as
    | {
        item_total?: number;
        completed_at?: Date | null;
        metadata?: Record<string, unknown> | null;
        shipping_address?: { country_code?: string | null } | null;
        shipping_methods?: Array<{ id: string }> | null;
      }
    | undefined;

  if (!cart) {
    res.status(404).json({ type: "not_found", reason: "cart_not_found", message: "Cart not found." });
    return;
  }
  if (cart.completed_at) {
    res.status(409).json({ type: "not_allowed", reason: "cart_completed", message: "Cart is already completed." });
    return;
  }
  if (!isShippableCountry(cart.shipping_address?.country_code)) {
    res.status(422).json({ type: "invalid_data", reason: "us_only", message: "We only ship to United States addresses for now." });
    return;
  }

  const quote = quoteCarrier(Number(cart.item_total ?? 0), carrier);
  if (!quote) {
    res.status(422).json({ type: "invalid_data", reason: "unknown_carrier", message: `Unknown carrier '${carrier}'. Allowed: fedex, dhl.` });
    return;
  }

  try {
    // Método base de Medusa en el carrito (si aún no hay ninguno): la primera
    // opción de envío a domicilio configurada en la tienda.
    if (!cart.shipping_methods?.length) {
      const { result: options } = await listShippingOptionsForCartWorkflow(req.scope).run({
        input: { cart_id, is_return: false },
      });
      const base = (options ?? []).find((o: { id?: string }) => o?.id);
      if (!base?.id) {
        res.status(409).json({ type: "not_allowed", reason: "no_shipping_option", message: "The store has no shipping option configured." });
        return;
      }
      await addShippingMethodToCartWorkflow(req.scope).run({
        input: { cart_id, options: [{ id: base.id }] },
      });
    }

    // Releer los métodos y fijar nombre + importe del transportista ELEGIDO.
    const { data: after } = await query.graph({
      entity: "cart",
      fields: ["id", "shipping_methods.id"],
      filters: { id: cart_id },
    });
    const methods = ((after?.[0] as { shipping_methods?: Array<{ id: string }> })?.shipping_methods ?? []);
    if (!methods.length) {
      res.status(500).json({ type: "error", reason: "method_missing", message: "Shipping method could not be attached." });
      return;
    }

    const cartModule = req.scope.resolve<ICartModuleService>(Modules.CART);
    await cartModule.updateShippingMethods(
      methods.map((m) => ({ id: m.id, name: quote.label, amount: quote.amount }))
    );
    await cartModule.updateCarts(cart_id, {
      metadata: {
        ...((cart.metadata as Record<string, unknown>) ?? {}),
        shipping_carrier: quote.carrier,
        shipping_carrier_label: quote.label,
        shipping_quote: quote.amount,
        shipping_free: quote.free,
      },
    });
  } catch (error) {
    logger.error(`[shipping-select] cart ${cart_id} ${carrier}: ${(error as Error).message}`);
    res.status(500).json({ type: "error", reason: "select_failed", message: "Could not set the shipping method." });
    return;
  }

  res.json({ ok: true, quote });
}

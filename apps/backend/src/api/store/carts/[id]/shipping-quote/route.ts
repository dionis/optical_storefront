import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  FREE_SHIPPING_THRESHOLD,
  isShippableCountry,
  quoteCarriers,
} from "../../../../../lib/shipping-rates";

/**
 * POST /store/carts/:id/shipping-quote — cotiza FedEx y DHL para este carrito.
 *
 * El precio lo decide el SERVIDOR (tabla de tarifas + gratis desde $100 de
 * subtotal); el cliente solo recibe las dos opciones y elige. Solo USA: una
 * dirección de otro país recibe 422 `us_only` y el checkout lo explica en el
 * idioma del cliente.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { id: cart_id } = req.params as { id: string };
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: ["id", "item_total", "completed_at", "shipping_address.country_code"],
    filters: { id: cart_id },
  });
  const cart = carts?.[0] as
    | { item_total?: number; completed_at?: Date | null; shipping_address?: { country_code?: string | null } | null }
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
    res.status(422).json({
      type: "invalid_data",
      reason: "us_only",
      message: "We only ship to United States addresses for now.",
    });
    return;
  }

  res.json({
    quotes: quoteCarriers(Number(cart.item_total ?? 0)),
    free_threshold: FREE_SHIPPING_THRESHOLD,
    item_total: Number(cart.item_total ?? 0),
  });
}

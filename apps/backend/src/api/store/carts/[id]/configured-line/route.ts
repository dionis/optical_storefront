import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import {
  ContainerRegistrationKeys,
  QueryContext,
} from "@medusajs/framework/utils";
import { addToCartWorkflow } from "@medusajs/medusa/core-flows";
import type { Knex } from "@mikro-orm/knex";
import { computeLensAddonCents, type LensSelection } from "../../../../../lib/lens-quote";

/**
 * POST /store/carts/:id/configured-line
 * Body: { variant_id: string, selection: LensSelection }
 *
 * Adds ONE line item for a frame configured with lenses. The price is computed
 * ENTIRELY server-side (frame's own price + lens add-on from the 2026 matrix); the
 * client never sends a total. The lens selection is stored in the line item
 * metadata so the order/admin can see the configuration.
 *
 * Prices are decimal dollars (Medusa v2), so cents are converted at the boundary.
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const { id: cart_id } = req.params as { id: string };
  const body = req.body as {
    variant_id?: string;
    selection?: LensSelection;
    prescription_id?: string | null;
  };

  if (!body.variant_id || !body.selection || typeof body.selection.design_code !== "string") {
    res.status(400).json({ error: "Se requieren 'variant_id' y 'selection.design_code'." });
    return;
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const pg = req.scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

  // Cart context (region + currency) for the frame price.
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: ["id", "region_id", "currency_code"],
    filters: { id: cart_id },
  });
  const cart = carts?.[0] as { region_id?: string; currency_code?: string } | undefined;
  if (!cart) {
    res.status(404).json({ error: "Carrito no encontrado." });
    return;
  }

  // Frame price — the variant's own server-computed price for the cart's region.
  const { data: variants } = await query.graph({
    entity: "variant",
    fields: ["id", "calculated_price.calculated_amount"],
    filters: { id: body.variant_id },
    context: {
      calculated_price: QueryContext({
        region_id: cart.region_id,
        currency_code: cart.currency_code,
      }),
    },
  });
  const frameAmount = Number(
    (variants?.[0] as { calculated_price?: { calculated_amount?: number } } | undefined)
      ?.calculated_price?.calculated_amount ?? 0
  );

  // Lens add-on — server-side from the 2026 matrix.
  let lensCents: number;
  try {
    lensCents = await computeLensAddonCents(pg, body.selection);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return;
  }

  const unit_price = Math.round((frameAmount + lensCents / 100) * 100) / 100;

  await addToCartWorkflow(req.scope).run({
    input: {
      cart_id,
      items: [
        {
          variant_id: body.variant_id,
          quantity: 1,
          unit_price,
          metadata: {
            kind: "configured-frame",
            lens_config: body.selection as unknown as Record<string, unknown>,
            // Reference the prescription by id only — the Rx values (PHI) live in
            // the prescription record, never in cart/order metadata.
            prescription_id: body.prescription_id ?? null,
            frame_price: frameAmount,
            lens_addon: Math.round(lensCents) / 100,
          },
        },
      ],
    },
  });

  const { data: updated } = await query.graph({
    entity: "cart",
    fields: ["id", "total", "item_total", "currency_code", "items.*"],
    filters: { id: cart_id },
  });

  res.json({ cart: updated?.[0] ?? null });
}

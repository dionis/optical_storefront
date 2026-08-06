import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import {
  ContainerRegistrationKeys,
  QueryContext,
} from "@medusajs/framework/utils";
import {
  refreshCartItemsWorkflow,
  updateLineItemInCartWorkflow,
} from "@medusajs/medusa/core-flows";
import type { Knex } from "@mikro-orm/knex";
import { computeLensAddonCents, type LensSelection } from "../../../../../lib/lens-quote";
import { resolveStoreSettings } from "../../../../../lib/store-settings";

/**
 * POST /store/carts/:id/revalidate
 *
 * Re-prices a cart against today's catalog, server-side, without asking the
 * shopper anything.
 *
 * Why this exists: a configured-frame line is added with a `unit_price` computed
 * once, at add time (see ../configured-line/route.ts) — Medusa stores it as a
 * custom price and never touches it again. A cart left open for a week therefore
 * carries last week's frame price, last week's lens matrix and last week's tax
 * rate, and nothing in the flow corrects it. The storefront calls this on cart
 * load and on entering checkout, so the correction is invisible.
 *
 * Everything needed to re-quote is already on the line's metadata (`lens_config`,
 * `prescription_id`), so this recomputes with the SAME code path as the original
 * add — `computeLensAddonCents` plus the variant's calculated price — and never
 * trusts a client-supplied amount.
 *
 * Returns the cart plus a `repriced` list so the storefront can tell the customer
 * a price moved. Changing what someone pays without saying so is the one part of
 * this that must not be silent.
 */

/** Line metadata written by the configured-line route. */
type ConfiguredMeta = {
  kind?: string;
  lens_config?: LensSelection;
  prescription_id?: string | null;
  frame_price?: number;
  lens_addon?: number;
  tax_amount?: number;
  tax_rate?: number;
  price_pretax?: number;
};

type CartItem = {
  id: string;
  variant_id?: string | null;
  title?: string | null;
  unit_price?: number | null;
  quantity?: number | null;
  metadata?: ConfiguredMeta | null;
};

/** A cart whose payment has already been set in motion must not change price. */
const REPRICEABLE_PAYMENT_STATUS = new Set(["not_paid"]);

/** Money comparison in cents — floats must never decide "did the price change?". */
const cents = (v: number) => Math.round(v * 100);

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const { id: cart_id } = req.params as { id: string };

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const pg = req.scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "region_id",
      "currency_code",
      "completed_at",
      "payment_collection.status",
      "items.id",
      "items.variant_id",
      "items.title",
      "items.unit_price",
      "items.quantity",
      "items.metadata",
    ],
    filters: { id: cart_id },
  });
  const cart = carts?.[0] as
    | {
        region_id?: string;
        currency_code?: string;
        completed_at?: Date | null;
        payment_collection?: { status?: string } | null;
        items?: CartItem[];
      }
    | undefined;

  if (!cart) {
    res.status(404).json({ error: "Cart not found.", reason: "cart_not_found" });
    return;
  }

  // An order already exists, or a payment session is live: the amount is either
  // settled or committed to the gateway. Report the cart untouched rather than
  // moving money out from under an in-flight payment.
  const paymentStatus = cart.payment_collection?.status;
  const locked =
    Boolean(cart.completed_at) ||
    (paymentStatus != null && !REPRICEABLE_PAYMENT_STATUS.has(paymentStatus));

  const repriced: Array<{
    item_id: string;
    title: string | null;
    from: number;
    to: number;
  }> = [];
  // Lines whose configuration no longer prices — a lens design or material the
  // owner retired since. We leave these exactly as they are: deleting a
  // customer's line, or guessing a price for it, is worse than flagging it.
  const stale: Array<{ item_id: string; title: string | null }> = [];

  if (!locked) {
    const settings = await resolveStoreSettings(req.scope);

    for (const item of cart.items ?? []) {
      const md = (item.metadata ?? {}) as ConfiguredMeta;
      if (md.kind !== "configured-frame" || !md.lens_config || !item.variant_id) {
        // Plain variant lines are handled by refreshCartItemsWorkflow below.
        continue;
      }

      // Frame price — today's server-computed price for this cart's region.
      const { data: variants } = await query.graph({
        entity: "variant",
        fields: ["id", "calculated_price.calculated_amount"],
        filters: { id: item.variant_id },
        context: {
          calculated_price: QueryContext({
            region_id: cart.region_id,
            currency_code: cart.currency_code,
          }),
        },
      });
      const calculated = (
        variants?.[0] as { calculated_price?: { calculated_amount?: number } } | undefined
      )?.calculated_price?.calculated_amount;
      if (typeof calculated !== "number") {
        // The variant no longer prices for this region (unpublished, price
        // removed). Same policy as an unknown lens design: flag, don't guess.
        stale.push({ item_id: item.id, title: item.title ?? null });
        continue;
      }

      let lensCents: number;
      try {
        lensCents = await computeLensAddonCents(pg, md.lens_config);
      } catch {
        stale.push({ item_id: item.id, title: item.title ?? null });
        continue;
      }

      const preTax = Math.round((calculated + lensCents / 100) * 100) / 100;

      // Same rule as the original add: only a frame-only line WITHOUT a
      // prescription is taxed, at the store's current rate (which is itself
      // admin-editable and may have moved since the line was added).
      const isFrameOnly = md.lens_config.design_code === "frame-only";
      const hasRx = Boolean(md.prescription_id);
      let taxRate = 0;
      let taxAmount = 0;
      let unit_price = preTax;
      if (isFrameOnly && !hasRx && settings.frame_tax_rate > 0) {
        taxRate = settings.frame_tax_rate;
        taxAmount = Math.round(preTax * taxRate * 100) / 100;
        unit_price = Math.round((preTax + taxAmount) * 100) / 100;
      }

      const current = Number(item.unit_price ?? 0);
      if (cents(current) === cents(unit_price)) continue;

      await updateLineItemInCartWorkflow(req.scope).run({
        input: {
          cart_id,
          item_id: item.id,
          update: {
            unit_price,
            metadata: {
              ...md,
              frame_price: calculated,
              lens_addon: Math.round(lensCents) / 100,
              tax_amount: taxAmount,
              tax_rate: taxRate,
              price_pretax: preTax,
              // Breadcrumb for support: this line's price is no longer the one
              // the customer first saw, and this is when it moved.
              repriced_at: new Date().toISOString(),
            } as unknown as Record<string, unknown>,
          },
        },
      });

      repriced.push({
        item_id: item.id,
        title: item.title ?? null,
        from: current,
        to: unit_price,
      });
    }

    // Re-price plain variant lines and recompute totals/taxes. Configured lines
    // carry a custom price, which this workflow leaves alone by design — so it
    // cannot undo the quotes above.
    await refreshCartItemsWorkflow(req.scope).run({
      input: { cart_id, force_refresh: true },
    });
  }

  const { data: updated } = await query.graph({
    entity: "cart",
    fields: ["id", "total", "item_total", "currency_code", "items.*"],
    filters: { id: cart_id },
  });

  res.json({
    cart: updated?.[0] ?? null,
    repriced,
    stale,
    locked,
  });
}

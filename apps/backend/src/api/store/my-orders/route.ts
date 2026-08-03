import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { readSessionToken, verifyToken } from "../../../lib/order-access";
import { deriveOrderProgress, stageIndex } from "../../../lib/order-status";

/**
 * GET /store/my-orders — every order belonging to the session token's address.
 *
 * This is the endpoint that makes the feature worth having: one call, all the
 * shopper's orders, no inbox archaeology. It replaces Medusa's own
 * `GET /store/orders/:id`, which we block in middlewares.ts because it
 * authenticates nobody.
 *
 * The response is a deliberate projection, not the raw order. Line items carry
 * `prescription_id`, and prescriptions are health data — so we send a boolean
 * ("this line has a prescription") and never the id or the values themselves.
 */

const ORDER_FIELDS = [
  "id",
  "display_id",
  "created_at",
  "currency_code",
  "email",
  "total",
  "subtotal",
  "shipping_total",
  "tax_total",
  "payment_status",
  "fulfillment_status",
  "metadata",
  "items.id",
  "items.title",
  "items.quantity",
  "items.total",
  "items.thumbnail",
  "items.metadata",
  "shipping_address.city",
  "shipping_address.country_code",
];

interface RawItem {
  id?: string;
  title?: string | null;
  quantity?: number | null;
  total?: number | null;
  thumbnail?: string | null;
  metadata?: Record<string, unknown> | null;
}

function projectItem(item: RawItem) {
  const lens = (item.metadata?.["lens_config"] ?? {}) as Record<string, unknown>;
  return {
    id: item.id,
    title: item.title ?? "",
    quantity: item.quantity ?? 1,
    total: item.total ?? 0,
    thumbnail: item.thumbnail ?? null,
    // Codes only — the storefront already knows how to label these (DESIGN_LBL
    // in the checkout). The prescription itself never crosses this boundary.
    lens: {
      design_code: (lens["design_code"] as string) ?? null,
      material_code: (lens["material_code"] as string) ?? null,
      photo_code: (lens["photo_code"] as string) ?? null,
      ar_code: (lens["ar_code"] as string) ?? null,
    },
    has_prescription: Boolean(item.metadata?.["prescription_id"]),
  };
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const session = verifyToken(
    readSessionToken({ headers: req.headers as Record<string, unknown>, query: req.query }),
    "session"
  );

  if (!session) {
    res.status(401).json({
      type: "unauthorized",
      message: "Tu sesión de seguimiento caducó. Pide un enlace nuevo.",
    });
    return;
  }

  let rawOrders: Record<string, unknown>[] = [];
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    const { data } = await query.graph({
      entity: "order",
      fields: ORDER_FIELDS,
      // The token's email is the only filter — it is signed, so it cannot be
      // swapped for someone else's by editing the request.
      filters: { email: session.email },
    });
    rawOrders = (data ?? []) as Record<string, unknown>[];
  } catch (error) {
    logger.error(`[my-orders] could not list orders: ${(error as Error).message}`);
    res.status(500).json({ type: "error", message: "No se pudieron cargar tus pedidos." });
    return;
  }

  const orders = rawOrders
    .map((order) => {
      const items = ((order["items"] as RawItem[]) ?? []).map(projectItem);
      const progress = deriveOrderProgress({
        payment_status: order["payment_status"] as string,
        fulfillment_status: order["fulfillment_status"] as string,
        metadata: order["metadata"] as Record<string, unknown>,
        items: (order["items"] as RawItem[]) ?? [],
      });

      return {
        id: order["id"] as string,
        display_id: order["display_id"] ?? null,
        created_at: order["created_at"] ?? null,
        currency_code: order["currency_code"] ?? "usd",
        total: order["total"] ?? 0,
        subtotal: order["subtotal"] ?? 0,
        shipping_total: order["shipping_total"] ?? 0,
        tax_total: order["tax_total"] ?? 0,
        stage: progress.stage,
        stage_index: stageIndex(progress.stage),
        terminal: progress.terminal,
        paid: progress.paid,
        has_prescription: progress.has_prescription,
        // Surfaced so the shopper can see a courier reference when the owner
        // records one; absent for every order until then.
        tracking_number:
          (order["metadata"] as Record<string, unknown>)?.["tracking_number"] ?? null,
        items,
      };
    })
    // Newest first: the order someone just placed is the one they came to check.
    .sort((a, b) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime());

  res.status(200).json({ email: session.email, orders, count: orders.length });
}

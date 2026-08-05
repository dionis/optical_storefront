import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  createOrderFulfillmentWorkflow,
  createOrderShipmentWorkflow,
  markOrderFulfillmentAsDeliveredWorkflow,
  updateOrderWorkflow,
} from "@medusajs/medusa/core-flows";
import { ORDER_STAGES, type OrderStage } from "../../../../../lib/order-status";
import { fetchBoardOrder, isOrderStage, liveFulfillments } from "../../../../../lib/order-board";

/**
 * POST /admin/order-board/:id/stage — move an order to the next stage.
 *
 * One endpoint, one vocabulary. The panel says "this order is now in transit"
 * and the server works out that this means creating a shipment on a specific
 * fulfillment with specific quantities. That translation lives here rather than
 * in the browser for two reasons: it is the only place that can see the
 * fulfillment records the operation needs, and a panel that had to orchestrate
 * `createFulfillment → createShipment → markAsDelivered` itself would be
 * reimplementing Medusa's admin API in a React component, and would drift from
 * it on the first upgrade.
 *
 * The stages are NOT symmetrical, and the asymmetry is the point:
 *   • `confirmed` / `in_lab` are a manual note (`metadata.lab_stage`). The lab
 *     has no digital trail, so the owner sets it, and can unset it — but only
 *     while nothing has been fulfilled.
 *   • `shipped` / `in_transit` / `delivered` are real events with records behind
 *     them. They only move forward. Undoing one is a cancellation or a return,
 *     which is a different (and human) conversation.
 *
 * Body: { stage, tracking_number?, no_notification? }
 */

interface StageBody {
  stage?: string;
  /** Courier reference, recorded when moving to `in_transit`. */
  tracking_number?: string;
  /** Skip the customer email/SMS for this transition. */
  no_notification?: boolean;
}

function fail(res: MedusaResponse, status: number, reason: string, message: string): void {
  res.status(status).json({ type: "invalid_data", reason, message });
}

export async function POST(
  req: AuthenticatedMedusaRequest<StageBody>,
  res: MedusaResponse
): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const orderId = String(req.params.id ?? "");
  const body = (req.body ?? {}) as StageBody;
  const actorId = req.auth_context?.actor_id ?? "";
  const target = body.stage;
  const noNotification = body.no_notification === true;
  const tracking = String(body.tracking_number ?? "").trim();

  if (!isOrderStage(target)) {
    fail(
      res,
      400,
      "unknown_stage",
      `Etapa desconocida '${target}'. Permitidas: ${ORDER_STAGES.join(", ")}.`
    );
    return;
  }

  const before = await fetchBoardOrder(req.scope, orderId);
  if (!before) {
    res.status(404).json({ type: "not_found", message: "Pedido no encontrado." });
    return;
  }

  // `before` was projected by the same function that fed the panel, so "the
  // button was there" and "the server accepted it" cannot disagree.
  if (before.terminal === "canceled" || before.terminal === "refunded") {
    fail(
      res,
      409,
      "terminal",
      "Este pedido está cancelado o reembolsado: su seguimiento ya terminó."
    );
    return;
  }

  const allowed = before.next_stages;
  if (!allowed.includes(target)) {
    fail(
      res,
      409,
      "not_allowed",
      `El pedido está en '${before.stage}' y no puede pasar a '${target}'. ` +
        (allowed.length
          ? `Etapas posibles ahora: ${allowed.join(", ")}.`
          : "No admite más cambios de etapa desde aquí.")
    );
    return;
  }

  try {
    switch (target) {
      case "confirmed":
      case "in_lab":
        await setLabStage(req, orderId, target, actorId);
        break;

      case "shipped":
        await createFulfillment(req, before, actorId, noNotification);
        break;

      case "in_transit":
        await createShipment(req, before, actorId, noNotification, tracking);
        break;

      case "delivered":
        await markDelivered(req, before, noNotification);
        break;
    }
  } catch (error) {
    const message = (error as Error).message ?? "";
    logger.error(`[order-board] ${orderId} → ${target} failed: ${message}`);

    // The one failure the owner can actually fix themselves, and the one Medusa
    // reports most opaquely: no stock location to fulfil from.
    if (/location/i.test(message)) {
      fail(
        res,
        409,
        "no_location",
        "No hay una ubicación de stock asociada al método de envío de este pedido. " +
          "Configúrala en Ajustes → Ubicaciones antes de marcarlo como enviado."
      );
      return;
    }
    res.status(500).json({
      type: "error",
      message: `No se pudo mover el pedido a '${target}'. ${message}`.trim(),
    });
    return;
  }

  const after = await fetchBoardOrder(req.scope, orderId);

  console.info(
    JSON.stringify({
      event: "order_board.stage_changed",
      order_id: orderId,
      from: before.stage,
      to: target,
      resulting_stage: after?.stage ?? null,
      tracking_number: tracking || null,
      admin_user_id: actorId || null,
      timestamp: new Date().toISOString(),
    })
  );

  res.status(200).json({ order: after });
}

/**
 * The manual lab note.
 *
 * `updateOrderWorkflow` replaces `metadata` wholesale, so this merges rather
 * than assigns — `tracking_number`, `notify_email` and everything else the
 * checkout wrote live in the same object and would otherwise be erased by a
 * click on "in lab".
 */
async function setLabStage(
  req: AuthenticatedMedusaRequest<StageBody>,
  orderId: string,
  stage: OrderStage,
  actorId: string
): Promise<void> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "metadata"],
    filters: { id: orderId },
  });
  const current = (data?.[0]?.metadata ?? {}) as Record<string, unknown>;

  await updateOrderWorkflow(req.scope).run({
    input: {
      id: orderId,
      user_id: actorId,
      metadata: { ...current, lab_stage: stage },
    },
  });
}

/** Everything not yet fulfilled goes into one box. */
async function createFulfillment(
  req: AuthenticatedMedusaRequest<StageBody>,
  order: NonNullable<Awaited<ReturnType<typeof fetchBoardOrder>>>,
  actorId: string,
  noNotification: boolean
): Promise<void> {
  const items = order.items
    .map((item) => ({
      id: item.id as string,
      quantity: Number(item.quantity ?? 0) - Number(item.fulfilled_quantity ?? 0),
    }))
    .filter((item) => item.id && item.quantity > 0);

  if (!items.length) {
    throw new Error("No hay artículos pendientes de preparar en este pedido.");
  }

  await createOrderFulfillmentWorkflow(req.scope).run({
    input: {
      order_id: order.id,
      created_by: actorId,
      items,
      no_notification: noNotification,
    },
  });
}

/**
 * Hand the box to the courier.
 *
 * The tracking number is written twice on purpose: as a fulfillment label (where
 * Medusa's own admin expects it) and onto order metadata, because
 * `/store/my-orders` reads `metadata.tracking_number` — that is the copy the
 * customer's tracking page actually shows.
 */
async function createShipment(
  req: AuthenticatedMedusaRequest<StageBody>,
  order: NonNullable<Awaited<ReturnType<typeof fetchBoardOrder>>>,
  actorId: string,
  noNotification: boolean,
  tracking: string
): Promise<void> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "metadata",
      "fulfillments.id",
      "fulfillments.shipped_at",
      "fulfillments.canceled_at",
      "fulfillments.items.line_item_id",
      "fulfillments.items.quantity",
    ],
    filters: { id: order.id },
  });

  const raw = data?.[0] as Record<string, unknown> | undefined;
  const pending = liveFulfillments({
    fulfillments: (raw?.["fulfillments"] ?? []) as never,
  }).find((f) => !f.shipped_at);

  if (!pending?.id) {
    throw new Error("No hay ninguna preparación pendiente de enviar en este pedido.");
  }

  await createOrderShipmentWorkflow(req.scope).run({
    input: {
      order_id: order.id,
      fulfillment_id: pending.id,
      created_by: actorId,
      // Only used to validate the lines belong to the order — the real shipped
      // quantities are read back off the fulfillment by the workflow itself.
      items: (pending.items ?? [])
        .filter((i) => i.line_item_id)
        .map((i) => ({ id: i.line_item_id as string, quantity: Number(i.quantity ?? 1) })),
      // Medusa requires all three label fields; the owner only ever has the
      // number, so the URLs go out empty exactly as its own admin sends them.
      labels: tracking
        ? [{ tracking_number: tracking, tracking_url: "", label_url: "" }]
        : [],
      no_notification: noNotification,
    },
  });

  if (tracking) {
    const current = (raw?.["metadata"] ?? {}) as Record<string, unknown>;
    await updateOrderWorkflow(req.scope).run({
      input: {
        id: order.id,
        user_id: actorId,
        metadata: { ...current, tracking_number: tracking },
      },
    });
  }
}

/** Everything already with the courier is now in the customer's hands. */
async function markDelivered(
  req: AuthenticatedMedusaRequest<StageBody>,
  order: NonNullable<Awaited<ReturnType<typeof fetchBoardOrder>>>,
  noNotification: boolean
): Promise<void> {
  const pending = order.fulfillments.filter(
    (f) => f.id && f.shipped_at && !f.delivered_at && !f.canceled_at
  );

  if (!pending.length) {
    throw new Error("Ninguna preparación de este pedido está en camino todavía.");
  }

  // Sequentially: each one registers a delivery against the same order, and
  // running them in parallel races on the order's own version counter.
  for (const fulfillment of pending) {
    await markOrderFulfillmentAsDeliveredWorkflow(req.scope).run({
      input: {
        orderId: order.id,
        fulfillmentId: fulfillment.id as string,
        no_notification: noNotification,
      },
    });
  }
}

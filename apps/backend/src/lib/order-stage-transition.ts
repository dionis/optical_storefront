import type { INotificationModuleService, Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  createOrderFulfillmentWorkflow,
  createOrderShipmentWorkflow,
  markOrderFulfillmentAsDeliveredWorkflow,
  updateOrderWorkflow,
} from "@medusajs/medusa/core-flows";
import { ORDER_STAGES, type OrderStage } from "./order-status";
import { fetchBoardOrder, isOrderStage, liveFulfillments } from "./order-board";
import { resolveEmailLocale } from "./email/copy";
import { renderOrderStageUpdate } from "./email/order-stage-update";
import { sheetStageEvent, syncOrderToSheet } from "./gsheet-sync";
import { tenant } from "./tenant";

/**
 * Cambio de etapa de un pedido — la única implementación, compartida por el
 * panel (POST /admin/order-board/:id/stage) y por la hoja de Google (cuando el
 * dueño cambia el Estado en la pestaña Pedidos). Traduce la etapa a la
 * operación real de Medusa, guarda el historial, avisa al cliente y replica el
 * resultado en la hoja. Ver el comentario de la ruta para la asimetría de las
 * etapas (nota manual vs. eventos con registro).
 */

export type StageErrorReason =
  | "unknown_stage"
  | "not_found"
  | "terminal"
  | "not_allowed"
  | "no_location"
  | "nothing_to_fulfill"
  | "nothing_to_ship"
  | "nothing_to_deliver";

export interface StageTransitionInput {
  stage: string | undefined;
  /** Quién lo hizo (id de usuario admin) o una etiqueta de origen ("gsheet"). */
  actorId?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  noNotification?: boolean;
}

export interface StageTransitionResult {
  before: NonNullable<Awaited<ReturnType<typeof fetchBoardOrder>>>;
  after: Awaited<ReturnType<typeof fetchBoardOrder>>;
  notified: boolean;
}

/** Only an http(s) URL may travel to the customer as a tracking link. */
export function sanitizeTrackingUrl(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    /* not a URL */
  }
  return "";
}

/** Thrown by the transition helpers; carries the code the panel translates. */
export class StageError extends Error {
  /** Código HTTP sugerido para la ruta. */
  status = 409;
  constructor(
    readonly reason: StageErrorReason,
    message: string,
    readonly extra: Record<string, unknown> = {},
    status = 409
  ) {
    super(message);
    this.name = "StageError";
    this.status = status;
  }
}

/** Texto corto del SMS de etapa (es/en), con tracking cuando existe. */
function stageSmsText(
  locale: "es" | "en",
  stage: OrderStage,
  displayId: string,
  tracking: string | null,
  trackingUrl: string | null
): string {
  const names: Record<OrderStage, { es: string; en: string }> = {
    confirmed: { es: "confirmado", en: "confirmed" },
    in_lab: { es: "en el laboratorio", en: "in the lab" },
    shipped: { es: "empaquetado y listo para salir", en: "packed and ready to ship" },
    in_transit: { es: "en camino", en: "on its way" },
    delivered: { es: "entregado", en: "delivered" },
  };
  const prefix = tenant().smsPrefix;
  const base = locale === "es"
    ? `${prefix}: tu pedido #${displayId} está ${names[stage].es}.`
    : `${prefix}: your order #${displayId} is ${names[stage].en}.`;
  const track = tracking ? (locale === "es" ? ` Guía: ${tracking}.` : ` Tracking: ${tracking}.`) : "";
  const url = trackingUrl ? ` ${trackingUrl}` : "";
  return (base + track + url).slice(0, 320);
}

/** Composes and queues the stage-change email; true when it was handed to the
 *  notification module. Any failure is logged and swallowed on purpose. */
async function sendStageEmail(
  container: MedusaContainer,
  logger: Logger,
  input: {
    email: string | null;
    displayId: string | number;
    orderId: string;
    stage: OrderStage;
    locale: string | null;
    frameOnly: boolean;
    trackingNumber: string | null;
    trackingUrl: string | null;
    notifySms?: boolean;
    phone?: string | null;
  }
): Promise<boolean> {
  const notifications = container.resolve<INotificationModuleService>(Modules.NOTIFICATION);
  const locale = resolveEmailLocale(input.locale);
  let sent = false;

  if (input.email) {
    try {
      const content = renderOrderStageUpdate(locale, {
        displayId: input.displayId,
        stage: input.stage,
        frameOnly: input.frameOnly,
        trackingNumber: input.trackingNumber,
        trackingUrl: input.trackingUrl,
      });
      await notifications.createNotifications({
        to: input.email,
        channel: "email",
        template: "order-stage-update",
        trigger_type: "order_board.stage_changed",
        resource_id: input.orderId,
        resource_type: "order",
        content,
        data: { order_id: input.orderId, stage: input.stage },
      });
      sent = true;
    } catch (error) {
      logger.error(
        `[order-board] stage email for order ${input.orderId} failed: ${(error as Error).message}`
      );
    }
  } else {
    logger.warn(`[order-board] order ${input.orderId} has no email — stage email skipped.`);
  }

  // SMS SOLO si el cliente lo marcó al comprar (notify_sms) y dejó teléfono.
  // Mismo canal Twilio del pedido confirmado; si Twilio no está configurado,
  // el provider de logs lo registra y no rompe nada.
  if (input.notifySms && input.phone) {
    try {
      await notifications.createNotifications({
        to: input.phone,
        channel: "sms",
        template: "order-stage-update-sms",
        trigger_type: "order_board.stage_changed",
        resource_id: input.orderId,
        resource_type: "order",
        content: {
          subject: "",
          text: stageSmsText(locale, input.stage, String(input.displayId), input.trackingNumber, input.trackingUrl),
        },
        data: { order_id: input.orderId, stage: input.stage },
      });
      sent = true;
    } catch (error) {
      logger.error(
        `[order-board] stage SMS for order ${input.orderId} failed: ${(error as Error).message}`
      );
    }
  }

  return sent;
}

/** Añade {stage, at} a metadata.stage_history (merge, nunca reemplaza). */
async function appendStageHistory(
  container: MedusaContainer,
  orderId: string,
  stage: OrderStage,
  actorId: string
): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "metadata"],
    filters: { id: orderId },
  });
  const current = (data?.[0]?.metadata ?? {}) as Record<string, unknown>;
  const prev = Array.isArray(current["stage_history"])
    ? (current["stage_history"] as { stage?: string; at?: string }[])
    : [];
  await updateOrderWorkflow(container).run({
    input: {
      id: orderId,
      user_id: actorId,
      metadata: {
        ...current,
        stage_history: [...prev, { stage, at: new Date().toISOString() }].slice(-20),
      },
    },
  });
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
  container: MedusaContainer,
  orderId: string,
  stage: OrderStage,
  actorId: string
): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "metadata"],
    filters: { id: orderId },
  });
  const current = (data?.[0]?.metadata ?? {}) as Record<string, unknown>;

  await updateOrderWorkflow(container).run({
    input: {
      id: orderId,
      user_id: actorId,
      metadata: { ...current, lab_stage: stage },
    },
  });
}

/** Everything not yet fulfilled goes into one box. */
async function createFulfillment(
  container: MedusaContainer,
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
    throw new StageError("nothing_to_fulfill", "No order line has quantity left to fulfill.");
  }

  await createOrderFulfillmentWorkflow(container).run({
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
  container: MedusaContainer,
  order: NonNullable<Awaited<ReturnType<typeof fetchBoardOrder>>>,
  actorId: string,
  noNotification: boolean,
  tracking: string,
  trackingUrl = ""
): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
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
    throw new StageError("nothing_to_ship", "No live fulfillment on this order is awaiting shipment.");
  }

  await createOrderShipmentWorkflow(container).run({
    input: {
      order_id: order.id,
      fulfillment_id: pending.id,
      created_by: actorId,
      // Only used to validate the lines belong to the order — the real shipped
      // quantities are read back off the fulfillment by the workflow itself.
      items: (pending.items ?? [])
        .filter((i) => i.line_item_id)
        .map((i) => ({ id: i.line_item_id as string, quantity: Number(i.quantity ?? 1) })),
      // Medusa requires all three label fields; the URL viaja cuando el dueño
      // la puso (va también en el botón del email al cliente).
      labels: tracking
        ? [{ tracking_number: tracking, tracking_url: trackingUrl || "", label_url: "" }]
        : [],
      no_notification: noNotification,
    },
  });

  if (tracking || trackingUrl) {
    const current = (raw?.["metadata"] ?? {}) as Record<string, unknown>;
    await updateOrderWorkflow(container).run({
      input: {
        id: order.id,
        user_id: actorId,
        metadata: {
          ...current,
          ...(tracking ? { tracking_number: tracking } : {}),
          ...(trackingUrl ? { tracking_url: trackingUrl } : {}),
        },
      },
    });
  }
}

/** Everything already with the courier is now in the customer's hands. */
async function markDelivered(
  container: MedusaContainer,
  order: NonNullable<Awaited<ReturnType<typeof fetchBoardOrder>>>,
  noNotification: boolean
): Promise<void> {
  const pending = order.fulfillments.filter(
    (f) => f.id && f.shipped_at && !f.delivered_at && !f.canceled_at
  );

  if (!pending.length) {
    throw new StageError("nothing_to_deliver", "No shipped fulfillment on this order is awaiting delivery.");
  }

  // Sequentially: each one registers a delivery against the same order, and
  // running them in parallel races on the order's own version counter.
  for (const fulfillment of pending) {
    await markOrderFulfillmentAsDeliveredWorkflow(container).run({
      input: {
        orderId: order.id,
        fulfillmentId: fulfillment.id as string,
        no_notification: noNotification,
      },
    });
  }
}


/**
 * Mueve el pedido a `input.stage`. Lanza `StageError` (con `status` y `reason`)
 * cuando el cambio no procede; cualquier otro error es un fallo real.
 */
export async function transitionOrderStage(
  container: MedusaContainer,
  orderId: string,
  input: StageTransitionInput
): Promise<StageTransitionResult> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const target = input.stage;
  const actorId = input.actorId ?? "";
  const noNotification = input.noNotification === true;
  const tracking = String(input.trackingNumber ?? "").trim();
  const trackingUrl = sanitizeTrackingUrl(input.trackingUrl);

  if (!isOrderStage(target)) {
    throw new StageError("unknown_stage", `Unknown stage '${target}'. Allowed: ${ORDER_STAGES.join(", ")}.`, {}, 400);
  }

  const before = await fetchBoardOrder(container, orderId);
  if (!before) throw new StageError("not_found", `Order '${orderId}' not found.`, {}, 404);

  if (before.terminal === "canceled" || before.terminal === "refunded") {
    throw new StageError("terminal", "Order is canceled or refunded; its timeline has ended.");
  }

  const allowed = before.next_stages;
  if (!allowed.includes(target)) {
    throw new StageError(
      "not_allowed",
      `Order is at '${before.stage}' and cannot move to '${target}'.`,
      { stage: before.stage, next_stages: allowed }
    );
  }

  try {
    switch (target) {
      case "confirmed":
      case "in_lab":
        await setLabStage(container, orderId, target, actorId);
        break;
      case "shipped":
        await createFulfillment(container, before, actorId, noNotification);
        break;
      case "in_transit":
        await createShipment(container, before, actorId, noNotification, tracking, trackingUrl);
        break;
      case "delivered":
        await markDelivered(container, before, noNotification);
        break;
    }
  } catch (error) {
    const message = (error as Error).message ?? "";
    logger.error(`[order-board] ${orderId} → ${target} failed: ${message}`);
    if (error instanceof StageError) throw error;
    if (/location/i.test(message)) {
      throw new StageError("no_location", "No stock location resolved for this order's shipping method.");
    }
    throw error;
  }

  const after = await fetchBoardOrder(container, orderId);

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

  if (after && before.stage !== after.stage) {
    try {
      await appendStageHistory(container, orderId, after.stage, actorId);
    } catch (error) {
      logger.warn(`[order-board] stage history for ${orderId} not saved: ${(error as Error).message}`);
    }
  }

  let notified = false;
  if (!noNotification && after && before.stage !== after.stage) {
    let notifySms = false;
    let phone: string | null = null;
    let locale: string | null = null;
    try {
      const query = container.resolve(ContainerRegistrationKeys.QUERY);
      const { data } = await query.graph({
        entity: "order",
        fields: ["id", "metadata", "locale", "shipping_address.phone"],
        filters: { id: orderId },
      });
      const raw = data?.[0] as { metadata?: Record<string, unknown> | null; locale?: string | null; shipping_address?: { phone?: string | null } | null } | undefined;
      const md = (raw?.metadata ?? {}) as Record<string, unknown>;
      notifySms = md["notify_sms"] === true || md["notify_sms"] === "true";
      phone =
        (typeof md["phone"] === "string" && md["phone"].trim()) ||
        (raw?.shipping_address?.phone ? String(raw.shipping_address.phone).trim() : "") ||
        null;
      locale = raw?.locale ?? null;
    } catch { /* sin metadata no hay SMS; el email sale igual */ }

    notified = await sendStageEmail(container, logger, {
      email: after.email ? String(after.email) : null,
      displayId: after.display_id != null ? String(after.display_id) : orderId,
      orderId,
      stage: after.stage,
      locale,
      frameOnly: !after.items?.some((i) => i.lens && i.lens.design_code),
      trackingNumber: tracking || after.tracking_number || null,
      trackingUrl: trackingUrl || null,
      notifySms,
      phone,
    });
  }

  if (after && before.stage !== after.stage) {
    await syncOrderToSheet(container, orderId, sheetStageEvent(after.stage), {
      number: tracking || after.tracking_number || null,
      url: trackingUrl || null,
    });
  }

  return { before, after, notified };
}

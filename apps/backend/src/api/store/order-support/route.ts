import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { INotificationModuleService, Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { resolveEmailLocale, t } from "../../../lib/email/copy";
import {
  renderSupportAckEmail,
  renderSupportEmail,
} from "../../../lib/email/order-access-emails";
import { readSessionToken, verifyToken } from "../../../lib/order-access";
import { resolveStoreSettings } from "../../../lib/store-settings";

/**
 * POST /store/order-support — a shopper raises an issue about one of their orders.
 *
 * Authenticated by the same session token as /store/my-orders, and the order is
 * re-checked against the token's email server-side: without that, anyone could
 * post a complaint attributed to someone else's order id.
 *
 * The reason is an enum, not free text, so the subject line is always a string
 * we wrote — a customer-supplied subject is a header-injection vector and makes
 * inbox rules impossible.
 */

const REASONS = {
  delay: "reason_delay",
  wrong: "reason_wrong",
  cancel: "reason_cancel",
  other: "reason_other",
} as const;

type ReasonKey = keyof typeof REASONS;

const MAX_MESSAGE = 2000;

function isReason(value: unknown): value is ReasonKey {
  return typeof value === "string" && value in REASONS;
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
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

  const body = (req.body ?? {}) as {
    order_id?: unknown;
    reason?: unknown;
    message?: unknown;
    locale?: unknown;
  };

  const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
  const reason: ReasonKey = isReason(body.reason) ? body.reason : "other";
  const message = String(body.message ?? "").trim().slice(0, MAX_MESSAGE);
  const locale = resolveEmailLocale(body.locale);
  const storeLocale = resolveEmailLocale(process.env.STORE_NOTIFICATION_LOCALE);

  if (!orderId || !message) {
    res.status(400).json({
      type: "invalid_data",
      message: "Falta el pedido o el mensaje.",
    });
    return;
  }

  // Re-verify ownership: the token proves an email, the order must match it.
  let displayId = "";
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "display_id", "email"],
      filters: { id: orderId, email: session.email },
    });
    const order = orders?.[0] as { display_id?: unknown } | undefined;
    if (!order) {
      res.status(404).json({ type: "not_found", message: "Pedido no encontrado." });
      return;
    }
    displayId = String(order.display_id ?? orderId);
  } catch (error) {
    logger.error(`[order-support] order lookup failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", message: "No se pudo enviar el mensaje." });
    return;
  }

  const settings = await resolveStoreSettings(req.scope);
  const supportInbox = settings.support_email;
  if (!supportInbox) {
    logger.error("[order-support] no support inbox configured — message dropped.");
    res.status(503).json({
      type: "unavailable",
      message: "El canal de soporte no está configurado. Escríbenos por teléfono.",
    });
    return;
  }

  const payload = {
    displayId,
    orderId,
    customerEmail: session.email,
    reasonLabel: t(storeLocale, REASONS[reason]),
    message,
  };

  const notificationService = req.scope.resolve<INotificationModuleService>(
    Modules.NOTIFICATION
  );

  try {
    await notificationService.createNotifications({
      to: supportInbox,
      channel: "email",
      template: "order-support",
      trigger_type: "order-support.raised",
      resource_id: orderId,
      resource_type: "order",
      content: renderSupportEmail(payload, storeLocale),
      data: { order_id: orderId, reason, from: session.email },
    });
  } catch (error) {
    logger.error(`[order-support] support email failed: ${(error as Error).message}`);
    res.status(500).json({ type: "error", message: "No se pudo enviar el mensaje." });
    return;
  }

  // Acknowledgement to the shopper. Best-effort: the message already reached
  // support, so a failure here must not tell them it didn't.
  try {
    await notificationService.createNotifications({
      to: session.email,
      channel: "email",
      template: "order-support-ack",
      trigger_type: "order-support.raised",
      resource_id: orderId,
      resource_type: "order",
      content: renderSupportAckEmail(
        { displayId, reasonLabel: t(locale, REASONS[reason]), message },
        locale
      ),
    });
  } catch (error) {
    logger.warn(`[order-support] acknowledgement to ${session.email} failed: ${(error as Error).message}`);
  }

  res.status(200).json({ ok: true });
}

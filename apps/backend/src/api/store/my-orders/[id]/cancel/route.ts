import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { INotificationModuleService, Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { cancelOrderWorkflow, getOrderDetailWorkflow } from "@medusajs/medusa/core-flows";
import { resolveEmailLocale } from "../../../../../lib/email/copy";
import {
  renderCancelAckEmail,
  renderCancelAdminEmail,
  type CancelNoticeData,
} from "../../../../../lib/email/order-access-emails";
import { readSessionToken, verifyToken } from "../../../../../lib/order-access";
import { cancelEligibility, type CancelBlockedReason } from "../../../../../lib/order-status";
import { resolveStoreSettings } from "../../../../../lib/store-settings";

/**
 * POST /store/my-orders/:id/cancel — the shopper cancels their own order.
 *
 * Guest checkout means there is no customer account to authorize against, so
 * this uses the same signed session token as `GET /store/my-orders`, and — as in
 * `/store/order-support` — the order is re-fetched filtered by the token's
 * email. Holding an order id is not permission to cancel it.
 *
 * The refund is not ours to reinvent: `cancelOrderWorkflow` cancels uncaptured
 * payments, refunds captured ones through whichever provider took the money, and
 * writes the credit lines. Doing it by hand here would mean a second, divergent
 * implementation of money movement — so this route's whole job is authorization,
 * eligibility, and telling both parties what happened.
 */

/** Eligibility failures the shopper can understand, mapped to HTTP + copy. */
const BLOCKED_MESSAGE: Record<CancelBlockedReason, string> = {
  canceled: "Este pedido ya está cancelado.",
  completed: "Este pedido ya está cerrado. Escríbenos para gestionar una devolución.",
  fulfilled:
    "Este pedido ya salió de nuestro taller, así que no se puede cancelar. Escríbenos y lo resolvemos como devolución.",
};

/**
 * `payment_status` and `fulfillment_status` drive both the eligibility check and
 * the "what happened to your money" copy, and neither exists on the plain
 * `Order` graph type — they are aggregated from payment collections and
 * fulfillments. That is why this goes through `getOrderDetailWorkflow` rather
 * than `query.graph`; see the longer note in ../../route.ts.
 */
const ORDER_FIELDS = [
  "id",
  "display_id",
  "email",
  "status",
  "currency_code",
  "total",
  "metadata",
  "items.id",
  "items.metadata",
];

interface OrderRow {
  id: string;
  display_id?: unknown;
  email?: string | null;
  status?: string | null;
  currency_code?: string | null;
  total?: number | null;
  payment_status?: string | null;
  fulfillment_status?: string | null;
  metadata?: Record<string, unknown> | null;
  items?: { metadata?: Record<string, unknown> | null }[] | null;
}

function formatMoney(amount: number, currency: string): string {
  // Medusa v2 amounts are decimal units already — never divide by 100 here.
  try {
    return new Intl.NumberFormat("es", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency.toUpperCase()}`;
  }
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

  const { id: orderId } = req.params as { id: string };
  const locale = resolveEmailLocale((req.body as { locale?: unknown } | undefined)?.locale);
  const storeLocale = resolveEmailLocale(process.env.STORE_NOTIFICATION_LOCALE);

  // Ownership check: the token proves an email, and the order must belong to it.
  // `getOrderDetailWorkflow` has no email filter, so the comparison happens here
  // — and a mismatch returns the same 404 as a missing order, so this cannot be
  // used to probe which order ids exist.
  let order: OrderRow;
  try {
    const { result } = await getOrderDetailWorkflow(req.scope).run({
      input: { order_id: orderId, fields: ORDER_FIELDS, filters: { is_draft_order: false } },
    });
    const found = result as unknown as OrderRow | null;
    if (!found || String(found.email ?? "").toLowerCase() !== session.email.toLowerCase()) {
      res.status(404).json({ type: "not_found", message: "Pedido no encontrado." });
      return;
    }
    order = found;
  } catch (error) {
    // The workflow throws rather than returning null for an unknown id.
    logger.warn(`[my-orders/cancel] order lookup failed: ${(error as Error).message}`);
    res.status(404).json({ type: "not_found", message: "Pedido no encontrado." });
    return;
  }

  const eligibility = cancelEligibility(order);
  if (!eligibility.cancelable) {
    const reason = eligibility.blocked_by ?? "completed";
    res.status(409).json({
      type: "not_allowed",
      reason,
      message: BLOCKED_MESSAGE[reason],
    });
    return;
  }

  try {
    await cancelOrderWorkflow(req.scope).run({ input: { order_id: order.id } });
  } catch (error) {
    // The workflow runs the same eligibility checks we just did, so landing here
    // usually means the order moved between the two — or a payment provider
    // refused the refund. Either way the shopper must not be told it worked.
    logger.error(`[my-orders/cancel] ${order.id} failed: ${(error as Error).message}`);
    res.status(409).json({
      type: "error",
      message:
        "No pudimos cancelar el pedido automáticamente. Escríbenos y lo hacemos manualmente.",
    });
    return;
  }

  const displayId = String(order.display_id ?? order.id);
  const notice: CancelNoticeData = {
    displayId,
    orderId: order.id,
    customerEmail: session.email,
    outcome: eligibility.refund_outcome,
    refundAmount: formatMoney(Number(order.total ?? 0), String(order.currency_code ?? "usd")),
  };

  // The order IS canceled and the money IS handled by this point. Mail is a
  // courtesy on top of that, so every failure below is logged and swallowed —
  // reporting a 500 now would tell the shopper to retry something that already
  // succeeded.
  const notificationService = req.scope.resolve<INotificationModuleService>(
    Modules.NOTIFICATION
  );

  try {
    await notificationService.createNotifications({
      to: session.email,
      channel: "email",
      template: "order-canceled-ack",
      trigger_type: "order.canceled_by_customer",
      resource_id: order.id,
      resource_type: "order",
      content: renderCancelAckEmail(notice, locale),
    });
  } catch (error) {
    logger.warn(`[my-orders/cancel] ack to ${session.email} failed: ${(error as Error).message}`);
  }

  try {
    const settings = await resolveStoreSettings(req.scope);
    // One mail per admin — a shared To: would leak the other addresses.
    for (const recipient of settings.admin_notification_emails) {
      await notificationService.createNotifications({
        to: recipient,
        channel: "email",
        template: "order-canceled-admin",
        trigger_type: "order.canceled_by_customer",
        resource_id: order.id,
        resource_type: "order",
        content: renderCancelAdminEmail(notice, storeLocale),
        data: { order_id: order.id, canceled_by: session.email },
      });
    }
  } catch (error) {
    logger.warn(`[my-orders/cancel] admin notice failed: ${(error as Error).message}`);
  }

  res.status(200).json({
    ok: true,
    order_id: order.id,
    refund_outcome: eligibility.refund_outcome,
  });
}

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { INotificationModuleService, Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  cancelOrderFulfillmentWorkflow,
  cancelOrderWorkflow,
  getOrderDetailWorkflow,
  updateOrderWorkflow,
} from "@medusajs/medusa/core-flows";
import { resolveEmailLocale, type EmailLocale } from "../../../../../lib/email/copy";
import {
  CANCEL_REASONS,
  renderCancelAckEmail,
  renderCancelAdminEmail,
  type CancelNoticeData,
  type CancelReasonKey,
  type CancelStatus,
} from "../../../../../lib/email/order-access-emails";
import { readSessionToken, verifyToken } from "../../../../../lib/order-access";
import {
  cancelEligibility,
  type CancelBlockedReason,
  type CancelWindow,
} from "../../../../../lib/order-status";
import { resolveStoreSettings } from "../../../../../lib/store-settings";

/**
 * POST /store/my-orders/:id/cancel — the shopper cancels their own order.
 *
 * Guest checkout means there is no customer account to authorize against, so
 * this uses the same signed session token as `GET /store/my-orders`, and — as in
 * `/store/order-support` — the order is re-fetched filtered by the token's
 * email. Holding an order id is not permission to cancel it.
 *
 * WHEN a shopper may cancel is the store's policy, and it lives in
 * `cancelEligibility`: the lab's ten business days must have run out AND the
 * order must have been out of the shop for a day. Refusals answer with the
 * `reason` code plus both clocks (`window`), never a sentence — the tracking
 * page is bilingual and owns the wording.
 *
 * HOW it is executed is Medusa's business, and Medusa has a hard limit here:
 * `cancelOrderWorkflow` refuses an order with a live fulfillment, and
 * `cancelOrderFulfillmentWorkflow` refuses a fulfillment that carries a
 * `shipped_at`. Since the policy only opens once something has been dispatched,
 * there are two outcomes and the route reports which one happened:
 *
 *   · `canceled` — the fulfillment was only boxed, so it is cancelled first and
 *     then the order is, with `cancelOrderWorkflow` doing the money exactly as
 *     it does for an admin-side cancellation. Nothing about refunds is
 *     reimplemented here.
 *   · `pending_return` — the parcel is genuinely on the road. Medusa cannot
 *     cancel it, so the authorized cancellation is recorded on the order and the
 *     admins are emailed to close it out by hand. The shopper is told exactly
 *     that; they are never told money moved when it did not.
 */

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
  "created_at",
  "currency_code",
  "total",
  "metadata",
  "items.id",
  "items.metadata",
  // The dispatch clock, and the records the cancellation has to work around.
  "fulfillments.id",
  "fulfillments.created_at",
  "fulfillments.packed_at",
  "fulfillments.shipped_at",
  "fulfillments.canceled_at",
];

interface RawFulfillment {
  id?: string;
  created_at?: string | null;
  packed_at?: string | null;
  shipped_at?: string | null;
  canceled_at?: string | null;
}

interface OrderRow {
  id: string;
  display_id?: unknown;
  email?: string | null;
  status?: string | null;
  created_at?: string | null;
  currency_code?: string | null;
  total?: number | null;
  payment_status?: string | null;
  fulfillment_status?: string | null;
  metadata?: Record<string, unknown> | null;
  items?: { metadata?: Record<string, unknown> | null }[] | null;
  fulfillments?: RawFulfillment[] | null;
}

/** Free-text cap on the shopper's note, mirroring /store/order-support. */
const MAX_NOTE = 500;

function isReason(value: unknown): value is CancelReasonKey {
  return typeof value === "string" && value in CANCEL_REASONS;
}

function formatMoney(amount: number, currency: string, locale: EmailLocale): string {
  // Medusa v2 amounts are decimal units already — never divide by 100 here.
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatDate(iso: string | null, locale: EmailLocale): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(date);
  } catch {
    return date.toISOString();
  }
}

/** Whole hours the parcel had been out when the shopper pressed the button. */
function hoursSince(iso: string | null, now: Date): number {
  if (!iso) return 0;
  const from = new Date(iso).getTime();
  if (Number.isNaN(from)) return 0;
  return Math.max(0, Math.floor((now.getTime() - from) / 3_600_000));
}

/** Fulfillments that still count — a canceled one is history. */
function liveFulfillments(order: OrderRow): RawFulfillment[] {
  return (order.fulfillments ?? []).filter((f) => !f?.canceled_at);
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
      reason: "session_expired",
      message: "Tracking session expired; request a new link.",
    });
    return;
  }

  const { id: orderId } = req.params as { id: string };
  const body = (req.body ?? {}) as { locale?: unknown; reason?: unknown; note?: unknown };
  const locale = resolveEmailLocale(body.locale);
  const storeLocale = resolveEmailLocale(process.env.STORE_NOTIFICATION_LOCALE);
  // The reason is an enum, never free text: it goes into a subject line and into
  // the owner's inbox rules, same rule as /store/order-support.
  const reason: CancelReasonKey = isReason(body.reason) ? body.reason : "other";
  const note = String(body.note ?? "").trim().slice(0, MAX_NOTE);

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
      res.status(404).json({ type: "not_found", reason: "not_found", message: "Order not found." });
      return;
    }
    order = found;
  } catch (error) {
    // The workflow throws rather than returning null for an unknown id.
    logger.warn(`[my-orders/cancel] order lookup failed: ${(error as Error).message}`);
    res.status(404).json({ type: "not_found", reason: "not_found", message: "Order not found." });
    return;
  }

  const now = new Date();
  const eligibility = cancelEligibility(order, now);

  if (!eligibility.cancelable) {
    // The refusal carries BOTH clocks, not just the one that tripped: the
    // shopper is owed "ten business days of lab, then a day on the road, here is
    // where each stands", which is a different message from a bare "no".
    const blocked: CancelBlockedReason = eligibility.blocked_by ?? "completed";
    res.status(409).json({
      type: "not_allowed",
      reason: blocked,
      window: eligibility.window,
      message: blockedNote(blocked, eligibility.window),
    });
    return;
  }

  // ── Execute as far as Medusa allows ────────────────────────────────────────
  let status: CancelStatus;
  try {
    status = await executeCancellation(req, order, logger, {
      by: session.email,
      reason,
      note,
    });
  } catch (error) {
    // Landing here means the order moved between the read and the write, or a
    // payment provider refused the refund. Either way the shopper must not be
    // told it worked.
    logger.error(`[my-orders/cancel] ${order.id} failed: ${(error as Error).message}`);
    res.status(409).json({
      type: "error",
      reason: "execution_failed",
      message: `Could not cancel order ${order.id}. ${(error as Error).message}`.trim(),
    });
    return;
  }

  const displayId = String(order.display_id ?? order.id);
  const notice = (target: EmailLocale): CancelNoticeData => ({
    displayId,
    orderId: order.id,
    customerEmail: session.email,
    outcome: eligibility.refund_outcome,
    refundAmount: formatMoney(
      Number(order.total ?? 0),
      String(order.currency_code ?? "usd"),
      target
    ),
    status,
    reason,
    note,
    labDays: eligibility.window.lab_business_days,
    shippedOn: formatDate(eligibility.window.shipped_at, target),
    hoursSinceShipment: hoursSince(eligibility.window.shipped_at, now),
    requestedAt: formatDate(now.toISOString(), target),
  });

  // The cancellation IS recorded (and the money handled, when Medusa could) by
  // this point. Mail is a courtesy on top of that, so every failure below is
  // logged and swallowed — reporting a 500 now would tell the shopper to retry
  // something that already succeeded.
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
      content: renderCancelAckEmail(notice(locale), locale),
    });
  } catch (error) {
    logger.warn(`[my-orders/cancel] ack to ${session.email} failed: ${(error as Error).message}`);
  }

  try {
    const settings = await resolveStoreSettings(req.scope);
    const adminNotice = notice(storeLocale);
    // One mail per admin — a shared To: would leak the other addresses.
    for (const recipient of settings.admin_notification_emails) {
      await notificationService.createNotifications({
        to: recipient,
        channel: "email",
        template: "order-canceled-admin",
        trigger_type: "order.canceled_by_customer",
        resource_id: order.id,
        resource_type: "order",
        content: renderCancelAdminEmail(adminNotice, storeLocale),
        data: {
          order_id: order.id,
          canceled_by: session.email,
          cancel_reason: reason,
          cancel_note: note,
          cancel_status: status,
          shipped_at: eligibility.window.shipped_at,
        },
      });
    }
  } catch (error) {
    logger.warn(`[my-orders/cancel] admin notice failed: ${(error as Error).message}`);
  }

  console.info(
    JSON.stringify({
      event: "order.canceled_by_customer",
      order_id: order.id,
      canceled_by: session.email,
      reason,
      status,
      lab_days_elapsed: eligibility.window.lab_days_elapsed,
      shipped_at: eligibility.window.shipped_at,
      timestamp: now.toISOString(),
    })
  );

  res.status(200).json({
    ok: true,
    order_id: order.id,
    status,
    refund_outcome: eligibility.refund_outcome,
  });
}

/**
 * Cancel as far as Medusa's own rules allow, and say how far that was.
 *
 * A fulfillment that was only boxed can still be pulled back, and once no live
 * fulfillment remains the order itself can be canceled — which is the path that
 * refunds automatically. A dispatched one cannot, and no amount of retrying
 * changes that, so the cancellation is recorded on the order instead and the
 * admin mail becomes the work item.
 */
async function executeCancellation(
  req: MedusaRequest,
  order: OrderRow,
  logger: Logger,
  details: { by: string; reason: CancelReasonKey; note: string }
): Promise<CancelStatus> {
  for (const fulfillment of liveFulfillments(order)) {
    if (fulfillment.shipped_at || !fulfillment.id) continue;
    await cancelOrderFulfillmentWorkflow(req.scope).run({
      input: { order_id: order.id, fulfillment_id: fulfillment.id },
    });
    fulfillment.canceled_at = new Date().toISOString();
  }

  if (liveFulfillments(order).length === 0) {
    await cancelOrderWorkflow(req.scope).run({ input: { order_id: order.id } });
    return "canceled";
  }

  logger.info(
    `[my-orders/cancel] ${order.id} is already dispatched; recording a customer cancellation for manual handling.`
  );
  await recordPendingCancellation(req, order, details);
  return "pending_return";
}

/**
 * Write the authorized cancellation onto the order.
 *
 * `updateOrderWorkflow` replaces `metadata` wholesale, so this merges rather
 * than assigns — `tracking_number`, `lab_stage` and everything the checkout
 * wrote live in the same object and would otherwise be erased. The flag is what
 * makes the request survive the email: an inbox is not a database, and the owner
 * opening the order in the panel has to be able to see it was cancelled.
 */
async function recordPendingCancellation(
  req: MedusaRequest,
  order: OrderRow,
  details: { by: string; reason: CancelReasonKey; note: string }
): Promise<void> {
  await updateOrderWorkflow(req.scope).run({
    input: {
      id: order.id,
      // Lands on the order-change record as `created_by`/`confirmed_by`. There
      // is no Medusa user behind a guest cancellation, so the address that
      // proved control of the order is the honest author of the change.
      user_id: details.by,
      metadata: {
        ...(order.metadata ?? {}),
        cancellation_requested_at: new Date().toISOString(),
        cancellation_requested_by: details.by,
        cancellation_reason: details.reason,
        // Empty rather than absent, so a note cleared on a second attempt does
        // not leave the previous one standing.
        cancellation_note: details.note,
      },
    },
  });
}

/**
 * English developer note for the logs and for any client with no dictionary.
 *
 * The shopper never reads this: the storefront renders `reason` + `window`
 * through its own `t()` dictionary. A Spanish sentence from the server would be
 * the one string on the page that ignores the language the shopper picked.
 */
function blockedNote(reason: CancelBlockedReason, window: CancelWindow): string {
  switch (reason) {
    case "canceled":
      return "Order is already canceled.";
    case "completed":
      return "Order is closed; refunds go through the return flow.";
    case "lab_window":
      return `Lab window still open: ${window.lab_days_remaining} of ${window.lab_business_days} business days left (until ${window.lab_ready_at}).`;
    case "not_shipped":
      return `Order has not been dispatched yet; cancellation opens ${window.shipping_grace_hours}h after it is.`;
    case "shipping_window":
      return `Dispatched at ${window.shipped_at}; cancellation opens in ${window.shipping_hours_remaining}h (at ${window.shipping_ready_at}).`;
  }
}

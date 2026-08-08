/**
 * Turns Medusa's two independent status fields into the single stage the
 * shopper sees on the tracking timeline.
 *
 * Medusa models payment and fulfillment separately (`PaymentStatus` and
 * `FulfillmentStatus` in @medusajs/types), and neither knows anything about
 * grinding lenses — which for this store is the longest part of the wait and the
 * thing customers actually ask about. So the lab step is ours: the owner can pin
 * it with `order.metadata.lab_stage`, and absent that we infer a sensible stage
 * from the two Medusa fields.
 *
 * Cancellation and refunds are NOT stages — they end the timeline rather than
 * advance it — so they come back separately as `terminal`.
 */

/** Ordered stages of the timeline the storefront draws. */
export const ORDER_STAGES = [
  "confirmed",
  "in_lab",
  "shipped",
  "in_transit",
  "delivered",
] as const;

export type OrderStage = (typeof ORDER_STAGES)[number];

/** States that stop the timeline instead of moving it forward. */
export type OrderTerminalState = "canceled" | "refunded" | "payment_pending";

export interface OrderProgress {
  stage: OrderStage;
  /** Set when the order is not simply "in progress" — overrides the timeline. */
  terminal: OrderTerminalState | null;
  /** Whether the shopper's money is actually committed. */
  paid: boolean;
  /** True when any line carries a prescription (changes the lab-step copy). */
  has_prescription: boolean;
}

interface OrderLike {
  payment_status?: string | null;
  fulfillment_status?: string | null;
  status?: string | null;
  /** When the order was placed — the start of the lab window. */
  created_at?: string | Date | null;
  metadata?: Record<string, unknown> | null;
  items?: { metadata?: Record<string, unknown> | null }[] | null;
  /** Fulfillment records; the latest live one starts the shipping window. */
  fulfillments?:
    | {
        created_at?: string | Date | null;
        packed_at?: string | Date | null;
        shipped_at?: string | Date | null;
        canceled_at?: string | Date | null;
      }[]
    | null;
}

function isStage(value: unknown): value is OrderStage {
  return typeof value === "string" && (ORDER_STAGES as readonly string[]).includes(value);
}

const PAID_STATUSES = new Set(["authorized", "partially_authorized", "captured", "partially_captured"]);

export function orderHasPrescription(order: OrderLike): boolean {
  return (order.items ?? []).some((item) => Boolean(item?.metadata?.["prescription_id"]));
}

/**
 * Resolve the stage shown to the customer.
 *
 * Precedence: a terminal state wins over everything; then an explicit
 * `metadata.lab_stage` set by the owner; then inference from Medusa's fields.
 * The manual override exists because the lab has no digital trail — the owner
 * moving a card in the admin is the only signal that lenses went into
 * production.
 */
export function deriveOrderProgress(order: OrderLike): OrderProgress {
  const payment = String(order.payment_status ?? "");
  const fulfillment = String(order.fulfillment_status ?? "");
  const paid = PAID_STATUSES.has(payment);
  const has_prescription = orderHasPrescription(order);

  let terminal: OrderTerminalState | null = null;
  if (payment === "canceled" || fulfillment === "canceled") terminal = "canceled";
  else if (payment === "refunded" || payment === "partially_refunded") terminal = "refunded";
  else if (!paid) terminal = "payment_pending";

  // Fulfillment is the strongest signal we have: once the store has shipped,
  // that outranks whatever the lab field still says.
  let stage: OrderStage;
  switch (fulfillment) {
    case "delivered":
    case "partially_delivered":
      stage = "delivered";
      break;
    case "shipped":
    case "partially_shipped":
      stage = "in_transit";
      break;
    case "fulfilled":
    case "partially_fulfilled":
      stage = "shipped";
      break;
    default: {
      // Nothing fulfilled yet — the order is with us. Let the owner's manual
      // lab_stage refine it, but never let it claim shipping that Medusa has
      // no record of.
      const manual = order.metadata?.["lab_stage"];
      stage = isStage(manual) && manual !== "delivered" && manual !== "in_transit"
        ? manual
        : paid
          ? "in_lab"
          : "confirmed";
      break;
    }
  }

  return { stage, terminal, paid, has_prescription };
}

/** Index of a stage on the timeline, for progress bars. */
export function stageIndex(stage: OrderStage): number {
  return ORDER_STAGES.indexOf(stage);
}

/* ────────────────────────────  self-cancellation  ──────────────────────────── */

/**
 * The store's self-cancellation policy.
 *
 * Cancelling is a remedy for a late order, not a change of mind: the lab is
 * promised ten business days (the same figure the order confirmation email
 * quotes), and a shipment is given a day on the road before the shopper is
 * allowed to give up on it. Both clocks must have run out.
 *
 * Keep `LAB_BUSINESS_DAYS` in step with `order_confirmation_next_steps_body` in
 * lib/email/copy.ts — promising ten days there and gating on a different number
 * here is the kind of mismatch a customer notices before we do.
 */
export const LAB_BUSINESS_DAYS = 10;

/** How long a shipment must be on the road before it can be given up on. */
export const SHIPPING_GRACE_HOURS = 24;

const MS_HOUR = 3_600_000;

/**
 * Saturday and Sunday only — no holiday calendar is modelled.
 *
 * Everything here reads UTC so the answer does not depend on which timezone the
 * container happens to boot in; the storefront formats the resulting instants in
 * the shopper's own locale.
 */
function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `from` moved forward by `days` business days, keeping the time of day. */
export function addBusinessDays(from: Date, days: number): Date {
  const out = new Date(from.getTime());
  let left = days;
  while (left > 0) {
    out.setUTCDate(out.getUTCDate() + 1);
    if (!isWeekend(out)) left -= 1;
  }
  return out;
}

/**
 * Business days between two instants, rounded up — a partial day still counts,
 * because "one day left" is the honest thing to tell someone who has three hours
 * to wait. Zero once `to` has passed.
 */
export function businessDaysBetween(from: Date, to: Date): number {
  if (to.getTime() <= from.getTime()) return 0;
  const cursor = new Date(from.getTime());
  let count = 0;
  while (cursor.getTime() < to.getTime()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (!isWeekend(cursor)) count += 1;
  }
  return count;
}

/** Why the shopper cannot cancel this order themselves. */
export type CancelBlockedReason =
  /** Already canceled — nothing left to do. */
  | "canceled"
  /** Medusa closed the order; refunds go through the return flow instead. */
  | "completed"
  /** The lab still has time on the clock. */
  | "lab_window"
  /** Nothing has shipped yet, so the shipping clock has not started. */
  | "not_shipped"
  /** It shipped, but not long enough ago. */
  | "shipping_window";

/** What canceling does to the shopper's money. */
export type RefundOutcome =
  /** Money was captured — it goes back to the original payment method. */
  | "refund"
  /** Only an authorization hold exists — canceling releases it. */
  | "release_hold"
  /** Nothing was ever taken. */
  | "nothing";

/**
 * Both policy clocks, always reported — met or not.
 *
 * The shopper is owed the *timing*, not just a "no": a page that says "you
 * cannot cancel" without saying until when sends them to the support form, which
 * is the thing this whole flow exists to avoid. Every field is a number or an
 * ISO instant so the storefront can word it in the shopper's language; nothing
 * here is prose.
 */
export interface CancelWindow {
  /** Business days the lab is allowed (policy constant). */
  lab_business_days: number;
  /** Business days already run since the order was placed. */
  lab_days_elapsed: number;
  /** Business days still to run; 0 once the lab window has closed. */
  lab_days_remaining: number;
  /** When the lab window closes, ISO — null if the order has no date on it. */
  lab_ready_at: string | null;
  lab_done: boolean;
  /** When the order left the store, ISO — null while nothing was dispatched. */
  shipped_at: string | null;
  /** Hours a shipment must be on the road (policy constant). */
  shipping_grace_hours: number;
  /** Hours still to run, rounded up; 0 once the grace has passed. */
  shipping_hours_remaining: number;
  /** When the shipping grace ends, ISO — null while nothing has shipped. */
  shipping_ready_at: string | null;
  shipping_done: boolean;
  /** The instant both conditions hold, ISO — null while the ship date is unknown. */
  eligible_at: string | null;
}

export interface CancelEligibility {
  cancelable: boolean;
  blocked_by: CancelBlockedReason | null;
  refund_outcome: RefundOutcome;
  /**
   * True when lenses are plausibly already in production. Not a blocker — the
   * shopper still owns the decision — but the UI warns before confirming.
   */
  lab_started: boolean;
  /** The two clocks behind `blocked_by`, for the copy that explains the wait. */
  window: CancelWindow;
}

const CAPTURED_STATUSES = new Set(["captured", "partially_captured"]);
const HELD_STATUSES = new Set(["authorized", "partially_authorized"]);

/**
 * The instant the order left the store — the start of the shipping clock.
 *
 * `shipped_at` is the real answer, but it is only written when the owner records
 * the courier hand-off (the `in_transit` transition). An order that was boxed
 * three days ago and never marked as dispatched is, from the shopper's side,
 * just as gone — so `packed_at` and finally the fulfillment's own creation date
 * stand in for it. Without that fallback the clock would never start on exactly
 * the orders this policy is meant to cover: the ones nobody is touching.
 *
 * The LATEST fulfillment wins, not the earliest: with a split shipment, starting
 * the grace period from the first box would let a shopper cancel a parcel that
 * went out this morning. Canceled fulfillments are history and never count.
 */
function dispatchedAt(order: OrderLike): Date | null {
  let latest: Date | null = null;
  for (const fulfillment of order.fulfillments ?? []) {
    if (fulfillment?.canceled_at) continue;
    const at =
      toDate(fulfillment?.shipped_at) ??
      toDate(fulfillment?.packed_at) ??
      toDate(fulfillment?.created_at);
    if (at && (!latest || at.getTime() > latest.getTime())) latest = at;
  }
  return latest;
}

/** Both clocks, resolved against `now`. */
function cancelWindow(order: OrderLike, now: Date): CancelWindow {
  const placed = toDate(order.created_at);
  const labReadyAt = placed ? addBusinessDays(placed, LAB_BUSINESS_DAYS) : null;
  const lab_done = labReadyAt !== null && now.getTime() >= labReadyAt.getTime();

  const shipped = dispatchedAt(order);
  const shippingReadyAt = shipped
    ? new Date(shipped.getTime() + SHIPPING_GRACE_HOURS * MS_HOUR)
    : null;
  const shipping_done = shippingReadyAt !== null && now.getTime() >= shippingReadyAt.getTime();

  // Both clocks run at once — the shipment can only happen after the lab is
  // done in practice, but nothing stops the store shipping early, so the
  // eligible instant is whichever of the two lands last.
  const eligibleAt =
    labReadyAt && shippingReadyAt
      ? new Date(Math.max(labReadyAt.getTime(), shippingReadyAt.getTime()))
      : null;

  return {
    lab_business_days: LAB_BUSINESS_DAYS,
    lab_days_elapsed: placed ? businessDaysBetween(placed, now) : 0,
    lab_days_remaining: labReadyAt ? businessDaysBetween(now, labReadyAt) : LAB_BUSINESS_DAYS,
    lab_ready_at: labReadyAt ? labReadyAt.toISOString() : null,
    lab_done,
    shipped_at: shipped ? shipped.toISOString() : null,
    shipping_grace_hours: SHIPPING_GRACE_HOURS,
    shipping_hours_remaining: shippingReadyAt
      ? Math.max(0, Math.ceil((shippingReadyAt.getTime() - now.getTime()) / MS_HOUR))
      : SHIPPING_GRACE_HOURS,
    shipping_ready_at: shippingReadyAt ? shippingReadyAt.toISOString() : null,
    shipping_done,
    eligible_at: eligibleAt ? eligibleAt.toISOString() : null,
  };
}

/**
 * Can the shopper cancel this order from the tracking page?
 *
 * Two store rules on top of Medusa's own: the lab's ten business days must have
 * run out, and the order must have been on the road for a day. Until then the
 * answer is "not yet, here is when" — `window` carries both clocks so the page
 * can say so — rather than a button that quietly disappears.
 *
 * NOTE ON EXECUTION: an order that satisfies this policy has, by definition, a
 * live fulfillment — and `cancelOrderWorkflow` refuses to cancel an order that
 * has one. Medusa can still do it end to end when that fulfillment was only
 * boxed (the route cancels it first), but once it carries a `shipped_at` nothing
 * in Medusa will cancel it. So eligibility here is the store's authorization to
 * cancel, not a promise that Medusa will execute it unattended — see the cancel
 * route for how the two halves are reconciled.
 */
export function cancelEligibility(order: OrderLike, now: Date = new Date()): CancelEligibility {
  const status = String(order.status ?? "");
  const payment = String(order.payment_status ?? "");
  const progress = deriveOrderProgress(order);
  const window = cancelWindow(order, now);

  const refund_outcome: RefundOutcome = CAPTURED_STATUSES.has(payment)
    ? "refund"
    : HELD_STATUSES.has(payment)
      ? "release_hold"
      : "nothing";

  // The lab step only means anything once the money is committed and the order
  // carries a prescription — a frame-only order is picked off a shelf.
  const lab_started =
    progress.has_prescription && progress.terminal === null && progress.stage === "in_lab";

  // `status` is the authority on whether the ORDER is canceled. Deliberately not
  // `progress.terminal`, which also reports "canceled" for an order whose
  // fulfillments were all canceled or whose payment was voided — neither of
  // which cancels the order itself.
  let blocked_by: CancelBlockedReason | null = null;
  if (status === "canceled") blocked_by = "canceled";
  else if (status === "completed") blocked_by = "completed";
  else if (!window.lab_done) blocked_by = "lab_window";
  else if (!window.shipped_at) blocked_by = "not_shipped";
  else if (!window.shipping_done) blocked_by = "shipping_window";

  return { cancelable: blocked_by === null, blocked_by, refund_outcome, lab_started, window };
}

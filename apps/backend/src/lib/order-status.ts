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
  metadata?: Record<string, unknown> | null;
  items?: { metadata?: Record<string, unknown> | null }[] | null;
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

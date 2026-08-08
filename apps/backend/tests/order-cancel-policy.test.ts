/**
 * Unit tests for the shopper's self-cancellation policy.
 *
 * The rule the store sells is "ten business days in the lab, then a day on the
 * road, and only then can you pull the plug yourself". Every branch of it is a
 * date comparison, which is exactly the kind of code that looks right and is off
 * by a weekend — so it is pinned here as a pure function, no database and no
 * HTTP, same rule as the other suites.
 *
 * `now` is always passed explicitly: a suite whose answers change on a Saturday
 * is worse than no suite.
 */
import {
  LAB_BUSINESS_DAYS,
  SHIPPING_GRACE_HOURS,
  addBusinessDays,
  businessDaysBetween,
  cancelEligibility,
} from "../src/lib/order-status";

/** Monday 2026-03-02, 09:00 UTC — every case is anchored to this. */
const PLACED = "2026-03-02T09:00:00.000Z";

/** The lab window closes ten business days later: Monday 2026-03-16. */
const LAB_READY = "2026-03-16T09:00:00.000Z";

function order(over: Record<string, unknown> = {}) {
  return {
    id: "order_1",
    payment_status: "captured",
    fulfillment_status: "not_fulfilled",
    status: "pending",
    created_at: PLACED,
    metadata: {},
    items: [{ metadata: { prescription_id: "presc_1" } }],
    fulfillments: [] as Record<string, unknown>[],
    ...over,
  };
}

/** A live fulfillment dispatched at `shippedAt`. */
function shipped(shippedAt: string) {
  return [{ id: "ful_1", shipped_at: shippedAt, canceled_at: null }];
}

function eligibility(raw: Record<string, unknown>, now: string) {
  return cancelEligibility(raw as never, new Date(now));
}

describe("business-day arithmetic", () => {
  it("skips weekends when counting the lab window forward", () => {
    // Ten business days from a Monday lands two calendar weeks later, not ten
    // calendar days — the weekend the naive version eats is the whole point.
    expect(addBusinessDays(new Date(PLACED), LAB_BUSINESS_DAYS).toISOString()).toBe(LAB_READY);
  });

  it("does not count the weekend as elapsed lab time", () => {
    // Friday to the following Monday is one business day, not three.
    const friday = new Date("2026-03-06T09:00:00.000Z");
    const monday = new Date("2026-03-09T09:00:00.000Z");
    expect(businessDaysBetween(friday, monday)).toBe(1);
  });

  it("reports zero once the target instant has passed", () => {
    expect(businessDaysBetween(new Date(LAB_READY), new Date(PLACED))).toBe(0);
  });
});

describe("cancelEligibility — the lab window", () => {
  it("refuses while the lab still has time, and says how much", () => {
    const result = eligibility(order(), "2026-03-10T09:00:00.000Z");
    expect(result.cancelable).toBe(false);
    expect(result.blocked_by).toBe("lab_window");
    expect(result.window.lab_done).toBe(false);
    expect(result.window.lab_ready_at).toBe(LAB_READY);
    // Six business days in, four to go — and both numbers travel to the page.
    expect(result.window.lab_days_elapsed).toBe(6);
    expect(result.window.lab_days_remaining).toBe(4);
  });

  it("refuses even when the order shipped early", () => {
    // Shipping ahead of the promise does not shorten the promise: condition one
    // is about the build time the customer was quoted.
    const result = eligibility(
      order({ fulfillment_status: "shipped", fulfillments: shipped("2026-03-04T09:00:00.000Z") }),
      "2026-03-06T09:00:00.000Z"
    );
    expect(result.blocked_by).toBe("lab_window");
    expect(result.window.shipping_done).toBe(true);
  });
});

describe("cancelEligibility — the shipping window", () => {
  it("refuses when the lab window closed but nothing has been dispatched", () => {
    const result = eligibility(order(), "2026-03-17T09:00:00.000Z");
    expect(result.blocked_by).toBe("not_shipped");
    expect(result.window.lab_done).toBe(true);
    expect(result.window.shipped_at).toBeNull();
    // With no dispatch date there is no instant to promise the shopper.
    expect(result.window.eligible_at).toBeNull();
    expect(result.window.shipping_hours_remaining).toBe(SHIPPING_GRACE_HOURS);
  });

  it("refuses inside the grace period, and says how many hours are left", () => {
    const result = eligibility(
      order({
        fulfillment_status: "shipped",
        fulfillments: shipped("2026-03-17T09:00:00.000Z"),
      }),
      "2026-03-17T19:00:00.000Z"
    );
    expect(result.blocked_by).toBe("shipping_window");
    expect(result.window.shipping_hours_remaining).toBe(14);
    expect(result.window.shipping_ready_at).toBe("2026-03-18T09:00:00.000Z");
  });

  it("allows the cancellation once both clocks have run out", () => {
    const result = eligibility(
      order({
        fulfillment_status: "shipped",
        fulfillments: shipped("2026-03-17T09:00:00.000Z"),
      }),
      "2026-03-18T10:00:00.000Z"
    );
    expect(result.cancelable).toBe(true);
    expect(result.blocked_by).toBeNull();
    expect(result.window.lab_done).toBe(true);
    expect(result.window.shipping_done).toBe(true);
    expect(result.refund_outcome).toBe("refund");
  });

  it("starts the clock at the LATEST live fulfillment, not the first", () => {
    // A split shipment must not let a parcel posted this morning be canceled on
    // the strength of one sent last week.
    const result = eligibility(
      order({
        fulfillment_status: "shipped",
        fulfillments: [
          { id: "ful_1", shipped_at: "2026-03-17T09:00:00.000Z", canceled_at: null },
          { id: "ful_2", shipped_at: "2026-03-19T08:00:00.000Z", canceled_at: null },
        ],
      }),
      "2026-03-19T12:00:00.000Z"
    );
    expect(result.blocked_by).toBe("shipping_window");
    expect(result.window.shipped_at).toBe("2026-03-19T08:00:00.000Z");
  });

  it("ignores a canceled fulfillment when looking for the dispatch date", () => {
    // A recalled shipment is history: the order is back with the store, so the
    // shipping clock has not started.
    const result = eligibility(
      order({
        fulfillments: [
          { id: "ful_1", shipped_at: "2026-03-17T09:00:00.000Z", canceled_at: "2026-03-18T09:00:00.000Z" },
        ],
      }),
      "2026-03-20T09:00:00.000Z"
    );
    expect(result.blocked_by).toBe("not_shipped");
    expect(result.window.shipped_at).toBeNull();
  });

  it("falls back to the packing date when the courier hand-off was never recorded", () => {
    // The owner marks `in_transit` by hand and does not always get to it. An
    // order boxed five days ago is gone as far as the shopper is concerned, and
    // this policy exists precisely for orders nobody is touching.
    const result = eligibility(
      order({
        fulfillment_status: "fulfilled",
        fulfillments: [
          {
            id: "ful_1",
            created_at: "2026-03-16T09:00:00.000Z",
            packed_at: "2026-03-16T12:00:00.000Z",
            shipped_at: null,
            canceled_at: null,
          },
        ],
      }),
      "2026-03-20T09:00:00.000Z"
    );
    expect(result.cancelable).toBe(true);
    expect(result.window.shipped_at).toBe("2026-03-16T12:00:00.000Z");
  });
});

describe("cancelEligibility — states that end the timeline", () => {
  it("reports an already-canceled order as such, not as a timing problem", () => {
    const result = eligibility(
      order({
        status: "canceled",
        fulfillments: shipped("2026-03-17T09:00:00.000Z"),
      }),
      "2026-03-20T09:00:00.000Z"
    );
    expect(result.blocked_by).toBe("canceled");
  });

  it("sends a completed order to the return flow", () => {
    const result = eligibility(
      order({ status: "completed", fulfillments: shipped("2026-03-17T09:00:00.000Z") }),
      "2026-03-20T09:00:00.000Z"
    );
    expect(result.blocked_by).toBe("completed");
  });

  it("always reports both clocks, even on a refusal that is not about timing", () => {
    // The page renders `window` whenever it explains the wait; a null here would
    // crash it on exactly the orders that are hardest to reason about.
    const result = eligibility(order({ status: "canceled" }), "2026-03-04T09:00:00.000Z");
    expect(result.window.lab_business_days).toBe(LAB_BUSINESS_DAYS);
    expect(result.window.shipping_grace_hours).toBe(SHIPPING_GRACE_HOURS);
  });
});

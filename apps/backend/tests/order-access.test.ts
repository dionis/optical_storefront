/**
 * Unit tests for guest order access.
 *
 * These cover the two things that decide whether a stranger can read someone
 * else's order: the signed token, and the stage derivation that the tracking
 * page renders. Both are pure functions, so no database and no HTTP — same
 * "no live I/O in CI" rule the other suites follow.
 *
 * NOTE: adding this suite required switching jest.config.json's `moduleResolution`
 * from "Node" to "Bundler". store-settings.ts imports @medusajs/framework/types,
 * whose subpaths are published through an `exports` map that classic Node
 * resolution cannot read; the config is JSON so the reason is recorded here.
 */

const SECRET = "test-secret-not-a-real-key";

describe("order-access tokens", () => {
  let mod: typeof import("../src/lib/order-access");

  beforeAll(async () => {
    process.env.ORDER_ACCESS_SECRET = SECRET;
    mod = await import("../src/lib/order-access");
  });

  it("round-trips an email through a session token", () => {
    const token = mod.issueToken("Shopper@Example.COM", "session");
    const verified = mod.verifyToken(token, "session");
    expect(verified).not.toBeNull();
    // Normalized on the way in, so the email is a stable identifier.
    expect(verified!.email).toBe("shopper@example.com");
  });

  it("refuses a token presented for the wrong purpose", () => {
    // The whole point of splitting the kinds: a link scraped from an inbox must
    // not work as a long-lived session credential.
    const magic = mod.issueToken("a@b.com", "magic");
    expect(mod.verifyToken(magic, "session")).toBeNull();

    const session = mod.issueToken("a@b.com", "session");
    expect(mod.verifyToken(session, "magic")).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = mod.issueToken("victim@example.com", "session");
    const [body, sig] = token.split(".");

    // Re-encode the payload with a different email, keep the original signature.
    const decoded = JSON.parse(
      Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    );
    decoded.email = "attacker@example.com";
    const forgedBody = Buffer.from(JSON.stringify(decoded))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(mod.verifyToken(`${forgedBody}.${sig}`, "session")).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = mod.issueToken("a@b.com", "magic");
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + mod.ORDER_ACCESS_TTL_MS.magic + 1000;
      expect(mod.verifyToken(token, "magic")).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it("rejects malformed input without throwing", () => {
    for (const bad of [null, undefined, "", "nodot", "a.b.c", 42, {}]) {
      expect(mod.verifyToken(bad, "session")).toBeNull();
    }
  });

  it("reads a bearer header and falls back to the query token", () => {
    expect(
      mod.readSessionToken({ headers: { authorization: "Bearer abc123" } })
    ).toBe("abc123");
    expect(mod.readSessionToken({ headers: {}, query: { token: "q1" } })).toBe("q1");
    expect(mod.readSessionToken({ headers: {} })).toBeNull();
  });
});

describe("order stage derivation", () => {
  let mod: typeof import("../src/lib/order-status");

  beforeAll(async () => {
    mod = await import("../src/lib/order-status");
  });

  const rxItem = { metadata: { prescription_id: "rx_1" } };

  it("treats an unpaid order as pending, not as progress", () => {
    const p = mod.deriveOrderProgress({
      payment_status: "not_paid",
      fulfillment_status: "not_fulfilled",
    });
    expect(p.paid).toBe(false);
    expect(p.terminal).toBe("payment_pending");
  });

  it("puts a paid, unfulfilled prescription order in the lab", () => {
    const p = mod.deriveOrderProgress({
      payment_status: "captured",
      fulfillment_status: "not_fulfilled",
      items: [rxItem],
    });
    expect(p.stage).toBe("in_lab");
    expect(p.terminal).toBeNull();
    expect(p.has_prescription).toBe(true);
  });

  it("lets fulfillment outrank a stale manual lab stage", () => {
    // The owner left lab_stage at in_lab but Medusa says it shipped — believe
    // the shipment, never the note.
    const p = mod.deriveOrderProgress({
      payment_status: "captured",
      fulfillment_status: "shipped",
      metadata: { lab_stage: "in_lab" },
    });
    expect(p.stage).toBe("in_transit");
  });

  it("never lets a manual stage claim shipping Medusa has no record of", () => {
    const p = mod.deriveOrderProgress({
      payment_status: "captured",
      fulfillment_status: "not_fulfilled",
      metadata: { lab_stage: "delivered" },
    });
    expect(p.stage).toBe("in_lab");
  });

  it("marks cancellations and refunds as terminal", () => {
    expect(
      mod.deriveOrderProgress({ payment_status: "canceled" }).terminal
    ).toBe("canceled");
    expect(
      mod.deriveOrderProgress({ payment_status: "refunded" }).terminal
    ).toBe("refunded");
  });

  it("reports delivered orders as delivered", () => {
    const p = mod.deriveOrderProgress({
      payment_status: "captured",
      fulfillment_status: "delivered",
    });
    expect(p.stage).toBe("delivered");
    expect(mod.stageIndex(p.stage)).toBe(mod.ORDER_STAGES.length - 1);
  });
});

/**
 * Self-cancellation gates real money: whether the shopper is offered the button,
 * and which promise the confirmation makes about the refund. Both are pure
 * functions of the order's status fields, so they are cheap to pin down here —
 * and expensive to get wrong in front of a customer.
 */
describe("customer cancellation eligibility", () => {
  let mod: typeof import("../src/lib/order-status");

  beforeAll(async () => {
    mod = await import("../src/lib/order-status");
  });

  const rxItem = { metadata: { prescription_id: "rx_1" } };

  // The store's rule is a remedy for a late order, not a change of mind: the lab
  // gets its ten business days and the courier gets a day before the shopper may
  // pull the plug. The full arithmetic is pinned in order-cancel-policy.test.ts;
  // what matters here is that the two gates exist and name themselves.
  const PLACED = "2026-03-02T09:00:00.000Z";
  const AFTER_BOTH = new Date("2026-03-20T09:00:00.000Z");

  it("refuses a fresh paid order — the lab still has its ten business days", () => {
    const e = mod.cancelEligibility(
      {
        status: "pending",
        payment_status: "captured",
        fulfillment_status: "not_fulfilled",
        created_at: PLACED,
      },
      new Date("2026-03-04T09:00:00.000Z")
    );
    expect(e.cancelable).toBe(false);
    expect(e.blocked_by).toBe("lab_window");
  });

  it("refuses an order still sitting in the shop after the lab window closed", () => {
    const e = mod.cancelEligibility(
      {
        status: "pending",
        payment_status: "captured",
        fulfillment_status: "not_fulfilled",
        created_at: PLACED,
      },
      AFTER_BOTH
    );
    expect(e.cancelable).toBe(false);
    expect(e.blocked_by).toBe("not_shipped");
  });

  it("allows cancelling once the lab window closed and the parcel has been out a day", () => {
    const e = mod.cancelEligibility(
      {
        status: "pending",
        payment_status: "captured",
        fulfillment_status: "shipped",
        created_at: PLACED,
        fulfillments: [{ shipped_at: "2026-03-17T09:00:00.000Z", canceled_at: null }],
      },
      AFTER_BOTH
    );
    expect(e.cancelable).toBe(true);
    expect(e.blocked_by).toBeNull();
  });

  it("treats a canceled fulfillment as nothing shipped", () => {
    // A recalled shipment puts the order back in the shop, so the courier clock
    // has not started — the shopper is not yet owed the button.
    const e = mod.cancelEligibility(
      {
        status: "pending",
        payment_status: "captured",
        fulfillment_status: "canceled",
        created_at: PLACED,
        fulfillments: [
          { shipped_at: "2026-03-17T09:00:00.000Z", canceled_at: "2026-03-18T09:00:00.000Z" },
        ],
      },
      AFTER_BOTH
    );
    expect(e.cancelable).toBe(false);
    expect(e.blocked_by).toBe("not_shipped");
    expect(e.window.shipped_at).toBeNull();
  });

  it("refuses an order that is already canceled or completed", () => {
    expect(mod.cancelEligibility({ status: "canceled" }).blocked_by).toBe("canceled");
    expect(mod.cancelEligibility({ status: "completed" }).blocked_by).toBe("completed");
  });

  it("distinguishes a refund from releasing a hold from nothing at all", () => {
    const outcome = (payment_status: string) =>
      mod.cancelEligibility({ status: "pending", payment_status }).refund_outcome;
    // Captured money goes back to the card.
    expect(outcome("captured")).toBe("refund");
    expect(outcome("partially_captured")).toBe("refund");
    // Only authorized — there is nothing to send back, just a hold to drop.
    expect(outcome("authorized")).toBe("release_hold");
    expect(outcome("partially_authorized")).toBe("release_hold");
    // Never charged.
    expect(outcome("not_paid")).toBe("nothing");
    expect(outcome("awaiting")).toBe("nothing");
  });

  it("flags lens production only for a paid prescription order still in the lab", () => {
    expect(
      mod.cancelEligibility({
        status: "pending",
        payment_status: "captured",
        fulfillment_status: "not_fulfilled",
        items: [rxItem],
      }).lab_started
    ).toBe(true);

    // Frame-only: nothing is being ground, so no warning.
    expect(
      mod.cancelEligibility({
        status: "pending",
        payment_status: "captured",
        fulfillment_status: "not_fulfilled",
        items: [{ metadata: {} }],
      }).lab_started
    ).toBe(false);

    // Unpaid: the lab has not started on an order we have not been paid for.
    expect(
      mod.cancelEligibility({
        status: "pending",
        payment_status: "not_paid",
        fulfillment_status: "not_fulfilled",
        items: [rxItem],
      }).lab_started
    ).toBe(false);
  });
});

describe("admin recipient list parsing", () => {
  it("splits on commas, semicolons and newlines, de-duplicating", async () => {
    const { parseEmailList } = await import("../src/lib/store-settings");
    expect(parseEmailList("a@x.com, B@X.com\nc@y.com; a@x.com")).toEqual([
      "a@x.com",
      "b@x.com",
      "c@y.com",
    ]);
    expect(parseEmailList(null)).toEqual([]);
    expect(parseEmailList("   ")).toEqual([]);
  });
});

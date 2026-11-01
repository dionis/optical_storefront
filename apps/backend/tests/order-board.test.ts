/**
 * Unit tests for the admin order board.
 *
 * The board's whole contract is that the panel never offers a move the API will
 * refuse: it renders `next_stages`, and the POST route validates against that
 * same array. So these tests pin `availableTransitions` — a pure function, no
 * database and no HTTP, same rule as the other suites.
 */
import {
  applyPosDelivery,
  availableTransitions,
  filterBoardRows,
  liveFulfillments,
  isOrderStage,
  projectBoardOrder,
  projectPayments,
  slimBoardOrder,
} from "../src/lib/order-board";
import { deriveOrderProgress } from "../src/lib/order-status";

/** Minimal order shaped like what `getOrdersListWorkflow` returns. */
function order(over: Record<string, unknown> = {}) {
  return {
    id: "order_1",
    payment_status: "captured",
    fulfillment_status: "not_fulfilled",
    status: "pending",
    metadata: {},
    items: [{ id: "item_1", quantity: 1, detail: { quantity: 1, fulfilled_quantity: 0 } }],
    fulfillments: [],
    ...over,
  };
}

function transitionsFor(raw: Record<string, unknown>) {
  const progress = deriveOrderProgress(raw as never);
  return availableTransitions(raw as never, progress);
}

describe("availableTransitions", () => {
  it("offers the lab note and shipping on a fresh paid order", () => {
    // Paid and unfulfilled derives to `in_lab`, so the only note left to set is
    // the way back to `confirmed`.
    expect(transitionsFor(order())).toEqual(["confirmed", "shipped"]);
  });

  it("offers the lab note on an unpaid order, which sits at confirmed", () => {
    const raw = order({ payment_status: "not_paid" });
    expect(transitionsFor(raw)).toEqual(["in_lab", "shipped"]);
  });

  it("stops offering the lab note once something is fulfilled", () => {
    // The lab step is a manual note, but claiming an order is still in the lab
    // after a box exists would contradict Medusa's own record.
    const raw = order({
      fulfillment_status: "fulfilled",
      items: [{ id: "item_1", quantity: 1, detail: { quantity: 1, fulfilled_quantity: 1 } }],
      fulfillments: [{ id: "ful_1", shipped_at: null, delivered_at: null, canceled_at: null }],
    });
    expect(transitionsFor(raw)).toEqual(["in_transit"]);
  });

  it("offers delivery once a fulfillment has shipped", () => {
    const raw = order({
      fulfillment_status: "shipped",
      items: [{ id: "item_1", quantity: 1, detail: { quantity: 1, fulfilled_quantity: 1 } }],
      fulfillments: [{ id: "ful_1", shipped_at: "2026-03-01", delivered_at: null, canceled_at: null }],
    });
    expect(transitionsFor(raw)).toEqual(["delivered"]);
  });

  it("offers nothing once everything is delivered", () => {
    const raw = order({
      fulfillment_status: "delivered",
      items: [{ id: "item_1", quantity: 1, detail: { quantity: 1, fulfilled_quantity: 1 } }],
      fulfillments: [
        { id: "ful_1", shipped_at: "2026-03-01", delivered_at: "2026-03-04", canceled_at: null },
      ],
    });
    expect(transitionsFor(raw)).toEqual([]);
  });

  it("offers nothing on a canceled order", () => {
    // Cancellation ends the timeline; reviving it is a new order, not a stage.
    const raw = order({ payment_status: "canceled" });
    expect(transitionsFor(raw)).toEqual([]);
  });

  it("still offers shipping when only part of an order is fulfilled", () => {
    const raw = order({
      fulfillment_status: "partially_fulfilled",
      items: [{ id: "item_1", quantity: 3, detail: { quantity: 3, fulfilled_quantity: 1 } }],
      fulfillments: [{ id: "ful_1", shipped_at: null, delivered_at: null, canceled_at: null }],
    });
    expect(transitionsFor(raw)).toEqual(["shipped", "in_transit"]);
  });

  it("ignores a canceled fulfillment when deciding what can move", () => {
    // A voided fulfillment is history. Treating it as shippable would send the
    // owner into a workflow error they cannot act on.
    const raw = order({
      fulfillments: [{ id: "ful_1", shipped_at: null, delivered_at: null, canceled_at: "2026-03-02" }],
    });
    expect(liveFulfillments(raw as never)).toHaveLength(0);
    expect(transitionsFor(raw)).toEqual(["confirmed", "shipped"]);
  });
});

describe("projectBoardOrder", () => {
  it("derives the same stage the shopper's timeline shows", () => {
    const raw = order({ metadata: { lab_stage: "in_lab" } });
    const row = projectBoardOrder(raw as never);
    expect(row.stage).toBe(deriveOrderProgress(raw as never).stage);
    expect(row.lab_stage).toBe("in_lab");
  });

  it("reports a prescription without ever exposing its values", () => {
    const raw = order({
      items: [
        {
          id: "item_1",
          quantity: 1,
          detail: { quantity: 1, fulfilled_quantity: 0 },
          metadata: {
            prescription_id: "presc_9",
            // Health data that must not survive the projection.
            prescription: { od_sphere: -2.25, os_sphere: -1.75 },
          },
        },
      ],
    });
    const row = projectBoardOrder(raw as never);
    expect(row.has_prescription).toBe(true);
    expect(row.items[0].prescription_id).toBe("presc_9");
    expect(JSON.stringify(row)).not.toContain("od_sphere");
  });

  it("prefers a fulfillment label over the hand-typed metadata number", () => {
    const raw = order({
      metadata: { tracking_number: "OLD-1" },
      fulfillments: [
        {
          id: "ful_1",
          shipped_at: "2026-03-01",
          canceled_at: null,
          labels: [{ tracking_number: "NEW-2" }],
        },
      ],
    });
    expect(projectBoardOrder(raw as never).tracking_number).toBe("NEW-2");
  });
});

describe("projectBoardOrder — seller, note, history, brand/sku", () => {
  it("carries the seller code (uppercased), the owner's note and the stage history", () => {
    const raw = order({
      metadata: {
        seller_code: " ana ",
        owner_note: "Llamar antes de enviar",
        stage_history: [{ stage: "in_lab", at: "2026-10-02T10:00:00Z" }, { bogus: true }, { stage: "shipped", at: "2026-10-04T10:00:00Z" }],
        tracking_url: "https://courier.example/t/1",
      },
    });
    const row = projectBoardOrder(raw as never);
    expect(row.seller_code).toBe("ANA");
    expect(row.owner_note).toBe("Llamar antes de enviar");
    expect(row.stage_history).toEqual([
      { stage: "in_lab", at: "2026-10-02T10:00:00Z" },
      { stage: "shipped", at: "2026-10-04T10:00:00Z" },
    ]);
    expect(row.tracking_url).toBe("https://courier.example/t/1");
  });

  it("carries the traffic source the referral link was tagged with, cleaned", () => {
    expect(projectBoardOrder(order({ metadata: { seller_code: "ana", seller_source: " Instagram " } }) as never).seller_source).toBe("instagram");
    expect(projectBoardOrder(order({ metadata: { seller_code: "ana", seller_source: "what's-app" } }) as never).seller_source).toBe("whatsapp");
    expect(projectBoardOrder(order({ metadata: { seller_code: "ana", seller_source: "x".repeat(40) } }) as never).seller_source).toHaveLength(20);
    expect(projectBoardOrder(order({ metadata: { seller_code: "ana", seller_source: "123" } }) as never).seller_source).toBeNull();
    // The source is searchable from the board's free text, like the code.
    const rows = [
      projectBoardOrder(order({ id: "o1", metadata: { seller_code: "ANA", seller_source: "tiktok" } }) as never),
      projectBoardOrder(order({ id: "o2", metadata: { seller_code: "ANA" } }) as never),
    ];
    expect(filterBoardRows(rows, { q: "tiktok" }).map((r) => r.id)).toEqual(["o1"]);
  });

  it("defaults to null / [] when the metadata has none of it", () => {
    const row = projectBoardOrder(order() as never);
    expect(row.seller_code).toBeNull();
    expect(row.seller_source).toBeNull();
    expect(row.owner_note).toBeNull();
    expect(row.stage_history).toEqual([]);
    expect(row.tracking_url).toBeNull();
  });

  it("reads brand slug and SKU from the product metadata and the line snapshot", () => {
    const raw = order({
      items: [
        {
          id: "item_1",
          quantity: 1,
          variant_sku: "fx2043-blk",
          product_handle: "fx2043",
          detail: { quantity: 1, fulfilled_quantity: 0 },
          variant: { product: { thumbnail: null, metadata: { brand: "Flexure", brand_slug: "flexure" } } },
        },
        {
          id: "item_2",
          quantity: 1,
          detail: { quantity: 1, fulfilled_quantity: 0 },
          variant: { sku: "case-01", product: { metadata: { brand: "Cases" } } },
        },
      ],
    });
    const [frame, estuche] = projectBoardOrder(raw as never).items;
    expect(frame.sku).toBe("FX2043-BLK");
    expect(frame.brand_slug).toBe("flexure");
    expect(frame.product_handle).toBe("fx2043");
    expect(estuche.sku).toBe("CASE-01");
    expect(estuche.brand_slug).toBe("cases"); // name → slug fallback
  });

  it("filters by seller code, 'none' for unattributed, and finds the code in free text", () => {
    const rows = [
      projectBoardOrder(order({ id: "o1", metadata: { seller_code: "ANA" } }) as never),
      projectBoardOrder(order({ id: "o2", metadata: { seller_code: "luis" } }) as never),
      projectBoardOrder(order({ id: "o3", metadata: {} }) as never),
    ];
    expect(filterBoardRows(rows, { seller: "ana" }).map((r) => r.id)).toEqual(["o1"]);
    expect(filterBoardRows(rows, { seller: "LUIS" }).map((r) => r.id)).toEqual(["o2"]);
    expect(filterBoardRows(rows, { seller: "none" }).map((r) => r.id)).toEqual(["o3"]);
    expect(filterBoardRows(rows, {}).map((r) => r.id)).toEqual(["o1", "o2", "o3"]);
    expect(filterBoardRows(rows, { q: "luis" }).map((r) => r.id)).toEqual(["o2"]);
  });

  it("prefers a fulfillment label URL over the metadata one", () => {
    const raw = order({
      metadata: { tracking_url: "https://old.example" },
      fulfillments: [{ id: "ful_1", shipped_at: "2026-03-01", canceled_at: null, labels: [{ tracking_number: "N", tracking_url: "https://new.example" }] }],
    });
    expect(projectBoardOrder(raw as never).tracking_url).toBe("https://new.example");
  });
});

describe("isOrderStage", () => {
  it("accepts the real stages and rejects anything else", () => {
    expect(isOrderStage("in_lab")).toBe(true);
    expect(isOrderStage("delivered")).toBe(true);
    // `processing` is the legacy alias the storefront still renders; it is not
    // a stage the API accepts.
    expect(isOrderStage("processing")).toBe(false);
    expect(isOrderStage("")).toBe(false);
    expect(isOrderStage(null)).toBe(false);
  });
});

describe("projectBoardOrder — till sale, payments, slim view", () => {
  it("carries the till sale behind a POS order and starts undelivered", () => {
    const row = projectBoardOrder(order({ metadata: { source: "pos", establishment_id: "est_1", pos_sale_id: "sale_7", pos_sale_number: "R39-000127" } }) as never);
    expect(row.channel).toBe("pos");
    expect(row.pos_sale_id).toBe("sale_7");
    expect(row.pos_sale_number).toBe("R39-000127");
    expect(row.pos_delivered_at).toBeNull();
    expect(row.payments).toEqual([]);
  });

  it("applyPosDelivery: a sale handed over at the till is delivered with no moves left", () => {
    const a = projectBoardOrder(order({ id: "o_a", metadata: { source: "pos", pos_sale_id: "sale_a" } }) as never);
    const b = projectBoardOrder(order({ id: "o_b", metadata: { source: "pos", pos_sale_id: "sale_b" } }) as never);
    // A canceled sale keeps its terminal state even if the till says delivered.
    const c = projectBoardOrder(order({ id: "o_c", payment_status: "canceled", metadata: { source: "pos", pos_sale_id: "sale_c" } }) as never);
    applyPosDelivery([a, b, c], new Map([["sale_a", "2026-10-30T15:00:00.000Z"], ["sale_c", "2026-10-30T15:00:00.000Z"]]));
    expect(a.stage).toBe("delivered");
    expect(a.next_stages).toEqual([]);
    expect(a.pos_delivered_at).toBe("2026-10-30T15:00:00.000Z");
    expect(b.stage).toBe("in_lab");
    expect(b.pos_delivered_at).toBeNull();
    expect(c.terminal).toBe("canceled");
    expect(c.stage).not.toBe("delivered");
  });

  it("projectPayments: one row per Medusa payment with captured and refunded sums", () => {
    const rows = projectPayments({
      payment_collections: [{ payments: [
        { id: "pay_1", provider_id: "pp_stripe_stripe", amount: 270, currency_code: "usd", created_at: "2026-10-01T10:00:00Z", captured_at: "2026-10-01T10:01:00Z", captures: [{ amount: 200 }, { amount: 70 }], refunds: [{ amount: 20 }] },
      ] }],
    });
    expect(rows).toEqual([expect.objectContaining({ id: "pay_1", amount: 270, captured: 270, refunded: 20, provider_id: "pp_stripe_stripe" })]);
    expect(projectPayments({})).toEqual([]);
  });

  it("slimBoardOrder keeps the stage, the moves and the money and drops items, addresses and customer", () => {
    const full = projectBoardOrder(order({
      display_id: 42, total: 270, email: "ana@example.com",
      shipping_address: { first_name: "Ana", city: "Miami", phone: "305" },
      metadata: { seller_code: "dan", stage_history: [{ stage: "in_lab", at: "2026-10-02T10:00:00Z" }] },
    }) as never);
    const slim = slimBoardOrder(full) as Record<string, unknown>;
    expect(slim).toEqual(expect.objectContaining({ id: "order_1", display_id: 42, total: 270, stage: "in_lab", next_stages: ["confirmed", "shipped"], seller_code: "DAN", channel: "web" }));
    expect(slim.stage_history).toEqual([{ stage: "in_lab", at: "2026-10-02T10:00:00Z" }]);
    expect(slim).not.toHaveProperty("items");
    expect(slim).not.toHaveProperty("customer");
    expect(slim).not.toHaveProperty("shipping_address");
    expect(JSON.stringify(slim)).not.toContain("ana@example.com");
  });
});

/**
 * Hand-over of a till sale (HU-29) and "collect the balance and hand over in
 * one step" (HU-32), lib/pos-data.ts markDelivered / collectAndDeliver. Pure
 * and stubbed, like pos-data-atomic.test.ts: the delivery stamp is one
 * guarded UPDATE checked as text, the connection is a recorder, the order
 * board and the stage machine are stubs that record what they were asked.
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { collectAndDeliver, deliveryClaimPlan, markDelivered, PosError, type SaleRow } from "../src/lib/pos-data";
import { recordAudit } from "../src/lib/audit";
import { fetchBoardOrder } from "../src/lib/order-board";
import { transitionOrderStage } from "../src/lib/order-stage-transition";

jest.mock("../src/lib/audit", () => ({ recordAudit: jest.fn(async () => undefined) }));
jest.mock("../src/lib/sale-facts", () => ({ projectOrder: jest.fn(async () => 1), voidFacts: jest.fn(async () => undefined) }));
jest.mock("../src/lib/order-board", () => ({ fetchBoardOrder: jest.fn() }));
jest.mock("../src/lib/order-stage-transition", () => {
  class StageError extends Error {
    status = 409;
    constructor(readonly reason: string, message: string) {
      super(message);
    }
  }
  return { StageError, transitionOrderStage: jest.fn(async () => ({ notified: false })) };
});

const board = (over: Record<string, unknown> = {}) => ({ id: "order_1", stage: "in_lab", terminal: null, next_stages: ["confirmed", "shipped"], ...over });

function fakePg(answers: Array<Array<Record<string, unknown>>>) {
  const calls: Array<{ sql: string; bindings: unknown[] }> = [];
  const pg = {
    raw: jest.fn(async (sql: string, bindings: unknown[]) => {
      calls.push({ sql, bindings });
      return { rows: answers.shift() ?? [] };
    }),
  };
  return { pg, calls };
}

function container(pg: unknown, services: Record<string, unknown> = {}) {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const registry: Record<string, unknown> = { [ContainerRegistrationKeys.PG_CONNECTION]: pg, [ContainerRegistrationKeys.LOGGER]: logger, ...services };
  return { scope: { resolve: (key: string) => registry[key] } as never, logger };
}

const saleRow = (over: Partial<SaleRow> = {}): SaleRow => ({
  id: "poss_1",
  number: "Op2-000001",
  establishment_id: "est_1",
  terminal_id: "t1",
  seller_id: "u_seller",
  seller_code: "V1",
  customer_id: "cus_1",
  order_id: "order_1",
  list: 200,
  discount: 0,
  discount_pct: 0,
  total: 200,
  paid: 200,
  insurance: 0,
  balance: 0,
  status: "completed",
  tray: "Op2-3",
  promised_on: null,
  delivery: "pickup",
  delivered_at: null,
  voided_at: null,
  void_reason: null,
  void_note: null,
  void_requested_at: null,
  created_at: "2026-11-01T12:00:00.000Z",
  payments: [],
  internal_note: null, edited_at: null, edited_by: null, deleted_at: null, deleted_by: null, delete_reason: null, previous_numbers: [],
  has_wearing_photo: false, wearing_photo_at: null,
  ...over,
});

const stored = (over: Record<string, unknown> = {}) => ({
  id: "poss_1",
  number: "Op2-000001",
  establishment_id: "est_1",
  terminal_id: "t1",
  seller_id: "u_seller",
  seller_code: "V1",
  customer_id: "cus_1",
  order_id: "order_1",
  list_cents: 20000,
  discount_cents: 0,
  discount_pct: 0,
  total_cents: 20000,
  paid_cents: 20000,
  insurance_cents: 0,
  balance_cents: 0,
  status: "completed",
  tray_number: 3,
  promised_on: null,
  delivery: "pickup",
  delivered_at: "2026-11-05T15:00:00.000Z",
  created_at: "2026-11-01T12:00:00.000Z",
  ...over,
});

function services(rowNow: Record<string, unknown> | null) {
  const svc = {
    listPosSales: jest.fn(async () => (rowNow ? [rowNow] : [])),
    listPosSalePayments: jest.fn(async () => []),
    listPosTrays: jest.fn(async () => [{ id: "tray_1" }]),
    updatePosTrays: jest.fn(async () => undefined),
    createPosSalePayments: jest.fn(async (rows: unknown[]) => (rows as Array<Record<string, unknown>>).map((r, i) => ({ ...r, id: `pay_${i}` }))),
    createInsuranceClaims: jest.fn(),
    updatePosSales: jest.fn(),
  };
  const orders = {
    retrieveOrder: jest.fn(async () => ({ id: "order_1", display_id: 7, metadata: { pos_sale_id: "poss_1" } })),
    updateOrders: jest.fn(async () => undefined),
  };
  return { svc, orders, services: { pos: svc, [Modules.ORDER]: orders } };
}

const collection = (amount_cents: number) => ({
  payments: [{ method_code: "card", amount_cents, reference: null, fee_cents: 0, counts_as_cash: false, insurance: false, details: {} }],
  paid_cents: amount_cents,
  insurance_cents: 0,
  balance_cents: 0,
}) as never;

const failsWith = async (p: Promise<unknown>, reason: string, status: number) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(PosError);
  expect((err as PosError).reason).toBe(reason);
  expect((err as PosError).status).toBe(status);
  return err as PosError;
};

beforeEach(() => {
  jest.clearAllMocks();
  (fetchBoardOrder as jest.Mock).mockResolvedValue(board());
});

describe("deliveryClaimPlan", () => {
  it("stamps only a live, settled, undelivered sale", () => {
    const { sql, bindings } = deliveryClaimPlan("poss_1");
    expect(sql).toMatch(/UPDATE pos_sale/);
    expect(sql).toMatch(/SET delivered_at = now\(\)/);
    expect(sql).toMatch(/WHERE id = \? AND deleted_at IS NULL AND status <> 'voided' AND balance_cents <= 0 AND delivered_at IS NULL/);
    expect(sql).toMatch(/RETURNING delivered_at/);
    expect(bindings).toEqual(["poss_1"]);
  });
});

describe("markDelivered", () => {
  it("walks the order to delivered BEFORE the stamp, then stamps, frees the tray and audits", async () => {
    const order: string[] = [];
    (transitionOrderStage as jest.Mock).mockImplementation(async (_c: unknown, _id: string, input: { stage: string }) => { order.push(`stage:${input.stage}`); return { notified: input.stage === "delivered" }; });
    const s = services(stored());
    const { pg, calls } = fakePg([]);
    pg.raw.mockImplementation(async (sql: string, bindings: unknown[]) => { calls.push({ sql, bindings }); order.push("claim"); return { rows: [{ delivered_at: new Date() }] }; });
    const c = container(pg, s.services);

    const out = await markDelivered(c.scope, saleRow(), { actorId: "u_clerk" });

    // A pickup sale has no fulfillment: shipped → in_transit → delivered, the first two silent.
    expect(order).toEqual(["stage:shipped", "stage:in_transit", "stage:delivered", "claim"]);
    expect(transitionOrderStage).toHaveBeenNthCalledWith(1, c.scope, "order_1", { stage: "shipped", actorId: "u_clerk", noNotification: true });
    expect(transitionOrderStage).toHaveBeenNthCalledWith(2, c.scope, "order_1", { stage: "in_transit", actorId: "u_clerk", noNotification: true });
    expect(transitionOrderStage).toHaveBeenNthCalledWith(3, c.scope, "order_1", { stage: "delivered", actorId: "u_clerk", noNotification: false });
    expect(calls[0].bindings).toEqual(["poss_1"]);
    expect(s.svc.updatePosTrays).toHaveBeenCalledWith([{ id: "tray_1", released_at: expect.any(Date) }]);
    // Never rewritten from the caller's numbers: the stamp is the UPDATE.
    expect(s.svc.updatePosSales).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(c.scope, expect.objectContaining({ action: "sale.deliver", actorId: "u_clerk", entityId: "poss_1", after: { delivery: "pickup", order_stage_moved: true } }));
    expect(out).toMatchObject({ id: "poss_1", delivered_at: "2026-11-05T15:00:00.000Z" });
  });

  it("starts from the step the order still needs (already shipped → in_transit, delivered)", async () => {
    (fetchBoardOrder as jest.Mock).mockResolvedValue(board({ stage: "shipped", next_stages: ["in_transit"] }));
    const c = container(fakePg([[{ delivered_at: new Date() }]]).pg, services(stored()).services);
    await markDelivered(c.scope, saleRow({ delivery: "ship" }));
    expect((transitionOrderStage as jest.Mock).mock.calls.map((x) => x[2].stage)).toEqual(["in_transit", "delivered"]);
  });

  it("a refused step is logged and the delivery stands (audited as not moved)", async () => {
    const { StageError } = jest.requireMock("../src/lib/order-stage-transition");
    (transitionOrderStage as jest.Mock).mockRejectedValueOnce(new StageError("no_location", "no stock location"));
    const c = container(fakePg([[{ delivered_at: new Date() }]]).pg, services(stored()).services);
    await expect(markDelivered(c.scope, saleRow())).resolves.toMatchObject({ id: "poss_1" });
    expect(transitionOrderStage).toHaveBeenCalledTimes(1);
    expect(c.logger.warn).toHaveBeenCalledWith(expect.stringContaining("no_location"));
    expect(recordAudit).toHaveBeenCalledWith(c.scope, expect.objectContaining({ after: { delivery: "pickup", order_stage_moved: false } }));
  });

  it("a canceled order, an order already delivered or no order: nothing to move", async () => {
    for (const [b, moved] of [[board({ terminal: "canceled" }), false], [board({ stage: "delivered", next_stages: [] }), true], [null, false]] as const) {
      jest.clearAllMocks();
      (fetchBoardOrder as jest.Mock).mockResolvedValue(b);
      const c = container(fakePg([[{ delivered_at: new Date() }]]).pg, services(stored()).services);
      await markDelivered(c.scope, saleRow());
      expect(transitionOrderStage).not.toHaveBeenCalled();
      expect(recordAudit).toHaveBeenCalledWith(c.scope, expect.objectContaining({ after: expect.objectContaining({ order_stage_moved: moved }) }));
    }
    jest.clearAllMocks();
    const c = container(fakePg([[{ delivered_at: new Date() }]]).pg, services(stored()).services);
    await markDelivered(c.scope, saleRow({ order_id: null }));
    expect(fetchBoardOrder).not.toHaveBeenCalled();
  });

  it("refuses on what the caller saw without touching anything", async () => {
    const { pg } = fakePg([]);
    const c = container(pg, services(stored()).services);
    await failsWith(markDelivered(c.scope, saleRow({ status: "voided" })), "sale_voided", 409);
    const owed = await failsWith(markDelivered(c.scope, saleRow({ balance: 50 })), "balance_due", 409);
    expect(owed.extra).toEqual({ balance: 50 });
    expect(pg.raw).not.toHaveBeenCalled();
    expect(fetchBoardOrder).not.toHaveBeenCalled();
  });

  it("is idempotent: an already delivered sale comes back as it is", async () => {
    const { pg } = fakePg([]);
    const c = container(pg, services(stored()).services);
    const already = saleRow({ delivered_at: "2026-11-04T10:00:00.000Z" });
    await expect(markDelivered(c.scope, already)).resolves.toBe(already);
    expect(pg.raw).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("a refused stamp names the reason from the sale as it is now, or yields to the twin that delivered", async () => {
    const voided = container(fakePg([[]]).pg, services(stored({ status: "voided", paid_cents: 0 })).services);
    await failsWith(markDelivered(voided.scope, saleRow()), "sale_voided", 409);
    const owed = container(fakePg([[]]).pg, services(stored({ paid_cents: 15000, balance_cents: 5000, delivered_at: null })).services);
    await failsWith(markDelivered(owed.scope, saleRow()), "balance_due", 409);
    const gone = container(fakePg([[]]).pg, services(null).services);
    await failsWith(markDelivered(gone.scope, saleRow()), "sale_not_found", 404);
    // Delivered by the other tap a moment ago: no error, no second audit, no tray release.
    const twin = services(stored());
    const c = container(fakePg([[]]).pg, twin.services);
    await expect(markDelivered(c.scope, saleRow())).resolves.toMatchObject({ delivered_at: "2026-11-05T15:00:00.000Z" });
    expect(twin.svc.updatePosTrays).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("collectAndDeliver (HU-32)", () => {
  it("collects the balance first (atomic claim + ledger), then delivers the sale as the collection left it", async () => {
    // The row as the collection leaves it: settled, not yet delivered.
    const s = services(stored({ delivered_at: null }));
    const { pg, calls } = fakePg([[{ paid_cents: "20000", insurance_cents: "0", balance_cents: "0" }], [{ delivered_at: new Date() }]]);
    const c = container(pg, s.services);
    const out = await collectAndDeliver(c.scope, saleRow({ paid: 150, balance: 50 }), collection(5000), "u_clerk");
    expect(calls.map((x) => x.sql.includes("paid_cents = paid_cents +") ? "collect" : x.sql.includes("delivered_at = now()") ? "deliver" : "?")).toEqual(["collect", "deliver"]);
    expect(s.svc.createPosSalePayments).toHaveBeenCalledWith([expect.objectContaining({ sale_id: "poss_1", amount_cents: 5000, kind: "balance", received_by: "u_clerk" })]);
    expect(recordAudit).toHaveBeenCalledWith(c.scope, expect.objectContaining({ action: "payment.collect" }));
    expect(recordAudit).toHaveBeenCalledWith(c.scope, expect.objectContaining({ action: "sale.deliver", actorId: "u_clerk" }));
    expect(out.collected).toBe(true);
    expect(out.sale).toMatchObject({ id: "poss_1", balance: 0 });
  });

  it("with nothing owed the payments are ignored: a plain delivery", async () => {
    const s = services(stored());
    const c = container(fakePg([[{ delivered_at: new Date() }]]).pg, s.services);
    const out = await collectAndDeliver(c.scope, saleRow(), collection(5000), "u_clerk");
    expect(s.svc.createPosSalePayments).not.toHaveBeenCalled();
    expect(out.collected).toBe(false);
    expect(recordAudit).toHaveBeenCalledTimes(1);
  });

  it("a balance with no payments is balance_due before anything is written; a refused collection stops the delivery", async () => {
    const { pg } = fakePg([]);
    const c = container(pg, services(stored()).services);
    await failsWith(collectAndDeliver(c.scope, saleRow({ balance: 50 }), null, "u_clerk"), "balance_due", 409);
    await failsWith(collectAndDeliver(c.scope, saleRow({ balance: 50 }), { payments: [], paid_cents: 0, insurance_cents: 0, balance_cents: 5000 } as never, "u_clerk"), "balance_due", 409);
    expect(pg.raw).not.toHaveBeenCalled();
    // The claim loses (voided meanwhile): no ledger row, no stamp, no stage move.
    const s = services(stored({ status: "voided", paid_cents: 0, balance_cents: 0 }));
    const refused = container(fakePg([[]]).pg, s.services);
    await failsWith(collectAndDeliver(refused.scope, saleRow({ balance: 50 }), collection(5000), "u_clerk"), "sale_voided", 409);
    expect(s.svc.createPosSalePayments).not.toHaveBeenCalled();
    expect(transitionOrderStage).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

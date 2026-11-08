/**
 * The four places where the POS used to read a row and then write what it
 * had computed from that read — a discount approval consumed by a sale, the
 * owner's decision on an approval, a balance collected on a sale, and the
 * void of a sale (two confirmations = two refunds) — are now single guarded
 * UPDATEs (lib/pos-data.ts). Pure and stubbed: the SQL
 * plans are checked as text, the connection is a recorder, and the services
 * are the few methods each path touches. The database itself is exercised
 * against a real backend.
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  approvalClaimPlan,
  approvalDecisionPlan,
  approvalReleasePlan,
  claimApproval,
  collectPayment,
  decideApproval,
  paymentClaimPlan,
  PosError,
  requestVoid,
  voidClaimPlan,
  voidSale,
  type SaleRow,
} from "../src/lib/pos-data";
import { recordAudit } from "../src/lib/audit";
import { projectOrder, voidFacts } from "../src/lib/sale-facts";

jest.mock("../src/lib/audit", () => ({ recordAudit: jest.fn(async () => undefined) }));
jest.mock("../src/lib/sale-facts", () => ({ projectOrder: jest.fn(async () => 1), voidFacts: jest.fn(async () => undefined) }));

const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";

/** A knex stand-in that records every raw statement and answers from a queue of row sets. */
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

type Services = Record<string, Record<string, unknown>>;

function container(pg: unknown, services: Services = {}) {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const registry: Record<string, unknown> = {
    [ContainerRegistrationKeys.PG_CONNECTION]: pg,
    [ContainerRegistrationKeys.LOGGER]: logger,
    ...services,
  };
  return {
    scope: { resolve: (key: string) => registry[key] } as never,
    logger,
  };
}

const approvalRow = (over: Record<string, unknown> = {}) => ({
  id: "posdisc_1",
  establishment_id: "est_1",
  terminal_id: "t1",
  requested_by: "u_seller",
  discount_pct: 15,
  limit_pct: 10,
  below_minimum: false,
  list_cents: 20000,
  total_cents: 17000,
  lines: [],
  reason: null,
  status: "pending",
  decided_by: null,
  decided_at: null,
  decision_note: null,
  expires_at: FUTURE,
  sale_id: null,
  created_at: "2026-11-01T12:00:00.000Z",
  ...over,
});

const failsWith = async (p: Promise<unknown>, reason: string, status: number) => {
  await expect(p).rejects.toBeInstanceOf(PosError);
  await p.catch((e: PosError) => {
    expect(e.reason).toBe(reason);
    expect(e.status).toBe(status);
    return e;
  });
};

beforeEach(() => jest.clearAllMocks());

// ── The plans: the guards are in the WHERE, not in the caller ────────────────

describe("approvalClaimPlan", () => {
  it("only consumes an approved, unexpired request, by the database clock", () => {
    const { sql, bindings } = approvalClaimPlan("posdisc_1");
    expect(sql).toMatch(/UPDATE discount_approval/);
    expect(sql).toMatch(/SET status = 'used'/);
    expect(sql).toMatch(/WHERE id = \? AND deleted_at IS NULL AND status = 'approved'/);
    expect(sql).toMatch(/\(expires_at IS NULL OR expires_at > now\(\)\)/);
    expect(sql).toMatch(/RETURNING id/);
    expect(bindings).toEqual(["posdisc_1"]);
  });
});

describe("approvalReleasePlan", () => {
  it("gives back a claimed approval only while no sale is linked to it", () => {
    const { sql, bindings } = approvalReleasePlan("posdisc_1");
    expect(sql).toMatch(/SET status = 'approved'/);
    expect(sql).toMatch(/WHERE id = \? AND status = 'used' AND sale_id IS NULL/);
    expect(bindings).toEqual(["posdisc_1"]);
  });
});

describe("approvalDecisionPlan", () => {
  it("decides only a pending, unexpired request and returns the row", () => {
    const { sql, bindings } = approvalDecisionPlan("posdisc_1", "approved", "u_owner", "ok");
    expect(sql).toMatch(/SET status = \?, decided_by = \?, decided_at = now\(\), decision_note = \?/);
    expect(sql).toMatch(/WHERE id = \? AND deleted_at IS NULL AND status = 'pending' AND expires_at > now\(\)/);
    expect(sql).toMatch(/RETURNING \*/);
    expect(bindings).toEqual(["approved", "u_owner", "ok", "posdisc_1"]);
  });
});

describe("paymentClaimPlan", () => {
  it("adds to the sale's current figures and refuses voided, settled or overpaid sales", () => {
    const { sql, bindings } = paymentClaimPlan("poss_1", 5000, 1500);
    expect(sql).toMatch(/UPDATE pos_sale/);
    expect(sql).toMatch(/paid_cents = paid_cents \+ \?/);
    expect(sql).toMatch(/insurance_cents = insurance_cents \+ \?/);
    expect(sql).toMatch(/balance_cents = total_cents - \(paid_cents \+ \?\) - \(insurance_cents \+ \?\)/);
    expect(sql).toMatch(/WHERE id = \? AND deleted_at IS NULL AND status <> 'voided' AND balance_cents > 0/);
    expect(sql).toMatch(/\(paid_cents \+ insurance_cents \+ \? \+ \?\) <= total_cents/);
    expect(sql).toMatch(/RETURNING paid_cents, insurance_cents, balance_cents/);
    // One binding per placeholder, in the order the placeholders appear.
    expect((sql.match(/\?/g) ?? []).length).toBe(bindings.length);
    expect(bindings).toEqual([5000, 1500, 5000, 1500, "poss_1", 5000, 1500]);
  });
});

// ── claimApproval: 0 rows says why ──────────────────────────────────────────

describe("claimApproval", () => {
  const withApproval = (rows: Array<Array<Record<string, unknown>>>, current: Record<string, unknown> | null) => {
    const { pg, calls } = fakePg(rows);
    const svc = { listDiscountApprovals: jest.fn(async () => (current ? [current] : [])) };
    return { ...container(pg, { pos: svc }), calls, svc };
  };

  it("returns quietly when the UPDATE took the row", async () => {
    const c = withApproval([[{ id: "posdisc_1" }]], null);
    await expect(claimApproval(c.scope, "posdisc_1")).resolves.toBeUndefined();
    expect(c.calls).toHaveLength(1);
    expect(c.svc.listDiscountApprovals).not.toHaveBeenCalled();
  });

  it("approval_used when another sale got there first", async () => {
    const c = withApproval([[]], approvalRow({ status: "used", sale_id: "poss_9" }));
    await failsWith(claimApproval(c.scope, "posdisc_1"), "approval_used", 409);
  });

  it("approval_expired when the clock won, even if the row still says approved", async () => {
    const lapsed = withApproval([[]], approvalRow({ status: "approved", expires_at: PAST }));
    await failsWith(claimApproval(lapsed.scope, "posdisc_1"), "approval_expired", 409);
    const skew = withApproval([[]], approvalRow({ status: "approved", expires_at: FUTURE }));
    await failsWith(claimApproval(skew.scope, "posdisc_1"), "approval_expired", 409);
  });

  it("approval_rejected / approval_not_found for the other states", async () => {
    await failsWith(claimApproval(withApproval([[]], approvalRow({ status: "rejected" })).scope, "posdisc_1"), "approval_rejected", 409);
    await failsWith(claimApproval(withApproval([[]], null).scope, "posdisc_1"), "approval_not_found", 404);
  });
});

// ── decideApproval: one decision wins, the other is told the state ───────────

describe("decideApproval", () => {
  it("returns the decided row from RETURNING and audits it", async () => {
    const decided = approvalRow({ status: "approved", decided_by: "u_owner", decided_at: new Date(FUTURE), decision_note: "ok" });
    const { pg, calls } = fakePg([[decided]]);
    const svc = { listDiscountApprovals: jest.fn() };
    const c = container(pg, { pos: svc });
    const out = await decideApproval(c.scope, "posdisc_1", "approved", "u_owner", "ok");
    expect(out).toMatchObject({ id: "posdisc_1", status: "approved", decided_by: "u_owner", decision_note: "ok" });
    expect(calls[0].bindings).toEqual(["approved", "u_owner", "ok", "posdisc_1"]);
    expect(svc.listDiscountApprovals).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      c.scope,
      expect.objectContaining({ action: "discount.approve", entityId: "posdisc_1", establishmentId: "est_1", before: { status: "pending" }, after: { status: "approved", pct: 15, note: "ok" } })
    );
  });

  it("the second decision gets approval_<state> and no audit", async () => {
    const { pg } = fakePg([[]]);
    const svc = { listDiscountApprovals: jest.fn(async () => [approvalRow({ status: "rejected" })]) };
    const c = container(pg, { pos: svc });
    await failsWith(decideApproval(c.scope, "posdisc_1", "approved", "u_owner", null), "approval_rejected", 409);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("a pending request that lapsed is approval_expired; a missing one is 404", async () => {
    const lapsed = container(fakePg([[]]).pg, { pos: { listDiscountApprovals: async () => [approvalRow({ status: "pending", expires_at: PAST })] } });
    await failsWith(decideApproval(lapsed.scope, "posdisc_1", "rejected", "u_owner", null), "approval_expired", 409);
    const missing = container(fakePg([[]]).pg, { pos: { listDiscountApprovals: async () => [] } });
    await failsWith(decideApproval(missing.scope, "posdisc_x", "rejected", "u_owner", null), "approval_not_found", 404);
  });
});

// ── collectPayment: the ledger only after the sale accepted the money ────────

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
  paid: 50,
  insurance: 0,
  balance: 150,
  status: "completed",
  tray: null,
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
  paid_cents: 5000,
  insurance_cents: 0,
  balance_cents: 15000,
  status: "completed",
  tray_number: null,
  promised_on: null,
  delivery: "pickup",
  created_at: "2026-11-01T12:00:00.000Z",
  ...over,
});

const collection = (amount_cents: number) => ({
  payments: [{ method_code: "card", amount_cents, reference: null, fee_cents: 0, counts_as_cash: false, insurance: false, details: {} }],
  paid_cents: amount_cents,
  insurance_cents: 0,
  balance_cents: 0,
}) as never;

function saleServices(rowNow: Record<string, unknown> | null) {
  const order: string[] = [];
  const svc = {
    listPosSales: jest.fn(async () => (rowNow ? [rowNow] : [])),
    listPosSalePayments: jest.fn(async () => []),
    createPosSalePayments: jest.fn(async (rows: unknown[]) => {
      order.push("ledger");
      return (rows as Array<Record<string, unknown>>).map((r, i) => ({ ...r, id: `pay_${i}` }));
    }),
    createInsuranceClaims: jest.fn(),
    updatePosSales: jest.fn(),
  };
  const orders = {
    retrieveOrder: jest.fn(async () => ({ id: "order_1", display_id: 7, metadata: { pos_sale_id: "poss_1" } })),
    updateOrders: jest.fn(async () => undefined),
  };
  return { svc, orders, order, services: { pos: svc, [Modules.ORDER]: orders } };
}

describe("collectPayment", () => {
  it("claims first, then writes the ledger, stamps the returned figures, audits and reprojects", async () => {
    const s = saleServices(stored({ paid_cents: 15000, balance_cents: 5000 }));
    const { pg, calls } = fakePg([[{ paid_cents: "15000", insurance_cents: "0", balance_cents: "5000" }]]);
    pg.raw.mockImplementation(async (sql: string, bindings: unknown[]) => {
      calls.push({ sql, bindings });
      s.order.push("claim");
      return { rows: [{ paid_cents: "15000", insurance_cents: "0", balance_cents: "5000" }] };
    });
    const c = container(pg, s.services);

    const out = await collectPayment(c.scope, saleRow(), collection(10000), "u_clerk");

    expect(s.order).toEqual(["claim", "ledger"]);
    expect(calls[0].bindings).toEqual([10000, 0, 10000, 0, "poss_1", 10000, 0]);
    expect(s.svc.createPosSalePayments).toHaveBeenCalledWith([
      expect.objectContaining({ sale_id: "poss_1", method_code: "card", amount_cents: 10000, kind: "balance", received_by: "u_clerk", cash_session_id: null }),
    ]);
    // The sale row is never rewritten from the caller's stale numbers.
    expect(s.svc.updatePosSales).not.toHaveBeenCalled();
    expect(s.orders.updateOrders).toHaveBeenCalledWith("order_1", { metadata: { pos_sale_id: "poss_1", balance_due_cents: 5000, paid_cents: 15000 } });
    expect(recordAudit).toHaveBeenCalledWith(
      c.scope,
      expect.objectContaining({ action: "payment.collect", before: { balance_cents: 15000 }, after: { balance_cents: 5000, collected_cents: 10000 } })
    );
    expect(projectOrder).toHaveBeenCalledWith(c.scope, "order_1");
    expect(out).toMatchObject({ id: "poss_1", paid: 150, balance: 50 });
  });

  it("a refused claim writes no ledger row and names the reason from the sale as it is now", async () => {
    const cases: Array<[Record<string, unknown>, string, Record<string, unknown>]> = [
      [stored({ status: "voided", paid_cents: 0, balance_cents: 0 }), "sale_voided", {}],
      [stored({ paid_cents: 20000, balance_cents: 0 }), "nothing_due", {}],
      [stored({ paid_cents: 15000, balance_cents: 5000 }), "overpaid", { balance: 50 }],
    ];
    for (const [rowNow, reason, extra] of cases) {
      const s = saleServices(rowNow);
      const c = container(fakePg([[]]).pg, s.services);
      const err = await collectPayment(c.scope, saleRow(), collection(10000), "u_clerk").catch((e: PosError) => e);
      expect(err).toBeInstanceOf(PosError);
      expect((err as PosError).reason).toBe(reason);
      expect((err as PosError).status).toBe(409);
      expect((err as PosError).extra).toEqual(extra);
      expect(s.svc.createPosSalePayments).not.toHaveBeenCalled();
      expect(s.orders.updateOrders).not.toHaveBeenCalled();
    }
    expect(recordAudit).not.toHaveBeenCalled();
    expect(projectOrder).not.toHaveBeenCalled();
  });

  it("a sale that vanished is 404, and what the caller already saw still short-circuits", async () => {
    const gone = container(fakePg([[]]).pg, saleServices(null).services);
    await failsWith(collectPayment(gone.scope, saleRow(), collection(100), null), "sale_not_found", 404);
    const { pg } = fakePg([]);
    const c = container(pg, saleServices(stored()).services);
    await failsWith(collectPayment(c.scope, saleRow({ status: "voided" }), collection(100), null), "sale_voided", 409);
    await failsWith(collectPayment(c.scope, saleRow({ balance: 0 }), collection(100), null), "nothing_due", 409);
    expect(pg.raw).not.toHaveBeenCalled();
  });

  it("a failing reprojection is logged, never thrown", async () => {
    (projectOrder as jest.Mock).mockRejectedValueOnce(new Error("facts down"));
    const s = saleServices(stored({ paid_cents: 20000, balance_cents: 0 }));
    const c = container(fakePg([[{ paid_cents: 20000, insurance_cents: 0, balance_cents: 0 }]]).pg, s.services);
    await expect(collectPayment(c.scope, saleRow(), collection(15000), "u_clerk")).resolves.toMatchObject({ balance: 0 });
    expect(c.logger.warn).toHaveBeenCalledWith(expect.stringContaining("facts down"));
  });
});

// ── requestVoid: a repeat updates the reason, never who asked first ──────────

describe("requestVoid", () => {
  it("the first request stamps who and when", async () => {
    const s = saleServices(stored());
    const c = container(fakePg([]).pg, s.services);
    await requestVoid(c.scope, saleRow(), "u_seller", "wrong_entry", null);
    expect(s.svc.updatePosSales).toHaveBeenCalledWith({ id: "poss_1", void_requested_by: "u_seller", void_requested_at: expect.any(Date), void_reason: "wrong_entry", void_note: null });
    expect(recordAudit).toHaveBeenCalledWith(c.scope, expect.objectContaining({ action: "sale.void_request", before: undefined, after: { reason: "wrong_entry", note: null } }));
  });

  it("a repeat keeps the first requester and timestamp and audits what changed", async () => {
    const s = saleServices(stored({ void_requested_by: "u_seller", void_requested_at: "2026-11-01T13:00:00.000Z", void_reason: "wrong_entry", void_note: null }));
    const c = container(fakePg([]).pg, s.services);
    await requestVoid(c.scope, saleRow(), "u_other", "other", "customer called back");
    expect(s.svc.updatePosSales).toHaveBeenCalledWith({ id: "poss_1", void_reason: "other", void_note: "customer called back" });
    expect(recordAudit).toHaveBeenCalledWith(
      c.scope,
      expect.objectContaining({ action: "sale.void_request", actorId: "u_other", before: { reason: "wrong_entry", note: null }, after: { reason: "other", note: "customer called back" } })
    );
  });
});

// ── voidSale: one void, one set of refunds ──────────────────────────────────

describe("voidClaimPlan", () => {
  it("marks a live sale voided with who, when and why, and refuses one already voided", () => {
    const { sql, bindings } = voidClaimPlan("poss_1", "u_mgr", "duplicate", "typed twice");
    expect(sql).toMatch(/UPDATE pos_sale/);
    expect(sql).toMatch(/SET status = 'voided', voided_at = now\(\), voided_by = \?, void_reason = \?, void_note = COALESCE\(NULLIF\(\?, ''\), void_note\)/);
    expect(sql).toMatch(/WHERE id = \? AND deleted_at IS NULL AND status <> 'voided'/);
    expect(sql).toMatch(/RETURNING voided_at/);
    expect((sql.match(/\?/g) ?? []).length).toBe(bindings.length);
    expect(bindings).toEqual(["u_mgr", "duplicate", "typed twice", "poss_1"]);
  });

  it("a confirmation without a note binds '' so the request's note survives (COALESCE)", () => {
    const { bindings } = voidClaimPlan("poss_1", "u_mgr", "customer_changed_mind", null);
    expect(bindings).toEqual(["u_mgr", "customer_changed_mind", "", "poss_1"]);
  });
});

describe("voidSale", () => {
  const cardRow = { sale_id: "poss_1", method_code: "card", amount_cents: 5000, kind: "deposit", reference: null, created_at: "2026-11-01T12:00:00.000Z" };
  function voidServices(rowNow: Record<string, unknown> | null, payments: Array<Record<string, unknown>> = [cardRow]) {
    const svc = {
      listPosSales: jest.fn(async () => (rowNow ? [rowNow] : [])),
      listPosSalePayments: jest.fn(async () => payments),
      listPosPaymentMethods: jest.fn(async () => [
        { id: "pm_card", code: "card", kind: "card", receivable: false, counts_as_cash: false, is_active: true },
        { id: "pm_cash", code: "cash", kind: "cash", receivable: false, counts_as_cash: true, is_active: true },
        { id: "pm_ins", code: "insurance", kind: "insurance", receivable: true, counts_as_cash: false, is_active: true },
      ]),
      createPosSalePayments: jest.fn(async (rows: unknown[]) => (rows as Array<Record<string, unknown>>).map((r, i) => ({ ...r, id: `ref_${i}` }))),
      listInsuranceClaims: jest.fn(async () => []),
      updateInsuranceClaims: jest.fn(),
      updatePosSales: jest.fn(),
      listPosTrays: jest.fn(async () => [{ id: "tray_1" }]),
      updatePosTrays: jest.fn(),
    };
    return { svc, services: { pos: svc } };
  }

  it("claims first; only the winner writes the refunds, releases the tray and audits", async () => {
    const s = voidServices(stored({ status: "voided", paid_cents: 5000, balance_cents: 15000 }));
    const { pg, calls } = fakePg([[{ voided_at: "2026-11-05T12:00:00.000Z" }]]);
    const c = container(pg, s.services);

    const out = await voidSale(c.scope, saleRow({ order_id: null, paid: 50, balance: 150 }), "u_mgr", "wrong_entry", null);

    expect(calls[0].bindings).toEqual(["u_mgr", "wrong_entry", "", "poss_1"]);
    // The card deposit comes back by the same method, as a negative ledger row.
    expect(s.svc.createPosSalePayments).toHaveBeenCalledWith([
      expect.objectContaining({ sale_id: "poss_1", method_code: "card", amount_cents: -5000, kind: "refund", received_by: "u_mgr", counts_as_cash: false, cash_session_id: null }),
    ]);
    // The claim wrote status/who/when/why; here only the figures are zeroed.
    expect(s.svc.updatePosSales).toHaveBeenCalledWith({ id: "poss_1", paid_cents: 0, insurance_cents: 0, balance_cents: 0 });
    expect(s.svc.updatePosSales).not.toHaveBeenCalledWith(expect.objectContaining({ status: "voided" }));
    expect(s.svc.updatePosTrays).toHaveBeenCalledWith([expect.objectContaining({ id: "tray_1" })]);
    expect(voidFacts).toHaveBeenCalledWith(c.scope, "poss_1");
    expect(recordAudit).toHaveBeenCalledWith(
      c.scope,
      expect.objectContaining({ action: "sale.void", entityId: "poss_1", after: { status: "voided", reason: "wrong_entry", note: null, order_canceled: false } })
    );
    expect(out.order_canceled).toBe(false);
    expect(out.sale.status).toBe("voided");
  });

  it("the second confirmation gets sale_voided and writes nothing", async () => {
    const s = voidServices(stored({ status: "voided", paid_cents: 0, balance_cents: 0 }));
    const c = container(fakePg([[]]).pg, s.services);
    await failsWith(voidSale(c.scope, saleRow({ order_id: null }), "u_mgr", "duplicate", "again"), "sale_voided", 409);
    expect(s.svc.createPosSalePayments).not.toHaveBeenCalled();
    expect(s.svc.updatePosSales).not.toHaveBeenCalled();
    expect(s.svc.updatePosTrays).not.toHaveBeenCalled();
    expect(voidFacts).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("a sale that vanished is 404; what the caller already saw short-circuits before any UPDATE", async () => {
    const gone = container(fakePg([[]]).pg, voidServices(null).services);
    await failsWith(voidSale(gone.scope, saleRow({ order_id: null }), "u_mgr", "other", null), "sale_not_found", 404);
    const { pg } = fakePg([]);
    const c = container(pg, voidServices(stored()).services);
    await failsWith(voidSale(c.scope, saleRow({ status: "voided" }), "u_mgr", "other", null), "sale_voided", 409);
    expect(pg.raw).not.toHaveBeenCalled();
  });

  it("insurance and receivable methods are never refunded; a follow-up failure is logged and rethrown, the mark stands", async () => {
    const insRow = { ...cardRow, method_code: "insurance", amount_cents: 3000 };
    const s = voidServices(stored({ status: "voided" }), [cardRow, insRow]);
    s.svc.listPosTrays.mockRejectedValueOnce(new Error("trays down"));
    const c = container(fakePg([[{ voided_at: "x" }]]).pg, s.services);
    await expect(voidSale(c.scope, saleRow({ order_id: null }), "u_mgr", "other", null)).rejects.toThrow("trays down");
    expect(s.svc.createPosSalePayments).toHaveBeenCalledWith([expect.objectContaining({ method_code: "card", amount_cents: -5000 })]);
    expect(c.logger.error).toHaveBeenCalledWith(expect.stringContaining("marked voided but a follow-up failed"));
  });
});

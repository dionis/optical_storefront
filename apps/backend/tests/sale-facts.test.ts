import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { factFromLine, ordersMissingFacts, projectOrder, RECONCILE_BATCH, reconcileSaleFacts, type LineContext } from "../src/lib/sale-facts";
import { POS_MODULE } from "../src/modules/pos";
import { SALES_ANALYTICS_MODULE } from "../src/modules/sales-analytics";
import { previousPeriod } from "../src/lib/sales-analytics";

const ctx: LineContext = {
  orderId: "order_1",
  channel: "pos",
  saleId: "poss_1",
  saleNumber: "Op2-000147",
  establishmentId: "est_2",
  terminalId: "posterm_1",
  sellerId: "user_1",
  sellerCode: "CM07",
  customerId: "cus_1",
  paymentMethods: ["cash"],
  // 22:30 in Katy on Oct 27 is 03:30 UTC on Oct 28.
  soldAt: new Date("2026-10-28T03:30:00Z"),
  status: "active",
  tz: "America/Chicago",
};

describe("factFromLine", () => {
  it("a frame with lenses, discounted, on its local day", () => {
    const f = factFromLine(
      {
        id: "item_1",
        product_id: "prod_1",
        variant_id: "var_1",
        variant_sku: "GR825-BLK",
        product_title: "GR 825",
        quantity: 1,
        unit_price: 202.5,
        metadata: { list_price: 225, frame_price: 32.4, lens_addon: 170.1, tax_amount: 0, prescription_id: "rx_1", lens_config: { design_code: "prog-mid", material_code: "poly", photo_code: "photo-grey", ar_code: "ar-green" } },
      },
      { brand: "Capri", brand_slug: "capri" },
      ctx
    );
    expect(f).toMatchObject({
      category: "frame",
      brand: "Capri",
      lens_design: "prog-mid",
      has_prescription: true,
      list_cents: 22500,
      discount_cents: 2250,
      total_cents: 20250,
      frame_cents: 3240,
      lenses_cents: 17010,
      sold_date_local: "2026-10-27",
    });
  });

  it("a case and a customer's own frame", () => {
    expect(factFromLine({ id: "i2", product_id: "p2", quantity: 1, unit_price: 10, metadata: {} }, { brand_slug: "case" }, ctx).category).toBe("case");
    const own = factFromLine({ id: "i3", title: "Ray-Ban", quantity: 1, unit_price: 120, metadata: { kind: "own-frame", lens_config: { design_code: "sv" } } }, {}, ctx);
    expect(own).toMatchObject({ category: "own_frame", product_id: null, lens_design: "sv" });
  });

  it("a frame-only line with sales tax keeps the tax apart", () => {
    const f = factFromLine({ id: "i4", product_id: "p4", quantity: 1, unit_price: 38.52, metadata: { list_price: 36, tax_amount: 2.52, lens_config: { design_code: "frame-only" } } }, {}, ctx);
    expect(f).toMatchObject({ tax_cents: 252, list_cents: 3600, discount_cents: 0, lens_design: null });
  });
});

describe("previousPeriod", () => {
  it("is the same length just before", () => {
    expect(previousPeriod("2026-10-01", "2026-10-31")).toEqual({ from: "2026-08-31", to: "2026-09-30" });
    expect(previousPeriod("2026-10-27", "2026-10-27")).toEqual({ from: "2026-10-26", to: "2026-10-26" });
  });
});

/** A knex builder stand-in: records the chain, resolves to `rows`. */
function fakeKnex(rows: unknown[] = [], fail?: Error) {
  const calls: Array<[string, unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => {
    calls.push([name, args]);
    if (name === "leftJoin" && typeof args[1] === "function") {
      const on: { on: jest.Mock; andOnNull: jest.Mock } = { on: jest.fn<unknown, unknown[]>(() => on), andOnNull: jest.fn<unknown, unknown[]>(() => on) };
      (args[1] as (this: unknown) => void).call(on);
      calls.push(["leftJoin.on", [on.on.mock.calls[0], on.andOnNull.mock.calls[0]]]);
    }
    return builder;
  };
  for (const m of ["leftJoin", "whereNull", "where", "whereNotIn", "orderBy", "limit", "select"]) builder[m] = chain(m);
  builder.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => (fail ? Promise.reject(fail) : Promise.resolve(rows)).then(ok, ko);
  const pg = jest.fn<typeof builder, [string]>(() => builder);
  return { pg, calls };
}

const SINCE = new Date("2026-08-07T00:00:00Z");

describe("ordersMissingFacts", () => {
  it("left-joins live facts and keeps the recent, non-draft orders with none, oldest first, capped", async () => {
    const { pg, calls } = fakeKnex([{ id: "order_1" }, { id: "order_2" }]);
    await expect(ordersMissingFacts(pg as never, SINCE, 100)).resolves.toEqual(["order_1", "order_2"]);
    expect(pg).toHaveBeenCalledWith("order as o");
    expect(calls).toContainEqual(["leftJoin.on", [["f.order_id", "=", "o.id"], ["f.deleted_at"]]]);
    expect(calls).toContainEqual(["whereNull", ["o.deleted_at"]]);
    expect(calls).toContainEqual(["where", ["o.created_at", ">=", SINCE]]);
    expect(calls).toContainEqual(["whereNotIn", ["o.status", ["draft", "archived"]]]);
    expect(calls).toContainEqual(["whereNull", ["f.id"]]);
    expect(calls).toContainEqual(["orderBy", ["o.created_at", "asc"]]);
    expect(calls).toContainEqual(["limit", [100]]);
    expect(calls).toContainEqual(["select", ["o.id"]]);
  });

  it("defaults to the batch size", async () => {
    const { pg, calls } = fakeKnex([]);
    await ordersMissingFacts(pg as never, SINCE);
    expect(calls).toContainEqual(["limit", [RECONCILE_BATCH]]);
  });
});

/** The pieces projectOrder touches, as stubs; `found` is what the order query answers. */
function projectionContainer(found: Record<string, unknown> | null, pgRows: unknown[] = [], sale: Record<string, unknown> | null = null) {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const pos = { listPosSales: jest.fn(async () => (sale ? [sale] : [])), listPosSalePayments: jest.fn(async () => []) };
  const facts = { listSaleFacts: jest.fn(async () => []), deleteSaleFacts: jest.fn(), createSaleFacts: jest.fn(async (rows: unknown) => rows) };
  const query = { graph: jest.fn(async () => ({ data: found ? [found] : [] })) };
  // loadProductMetadata reads product metadata by pg; an empty answer is fine here.
  const meta = { whereIn: () => meta, select: () => Promise.resolve([]), whereNull: () => meta };
  const pgFacts = fakeKnex(pgRows);
  const pg = (table: string) => (table === "order as o" ? pgFacts.pg(table) : meta);
  const registry: Record<string, unknown> = {
    [ContainerRegistrationKeys.LOGGER]: logger,
    [ContainerRegistrationKeys.PG_CONNECTION]: pg,
    [ContainerRegistrationKeys.QUERY]: query,
    [POS_MODULE]: pos,
    [SALES_ANALYTICS_MODULE]: facts,
  };
  return { scope: { resolve: (k: string) => registry[k] } as never, logger, pos, facts, query };
}

const webLikeOrder = { id: "order_1", created_at: "2026-11-01T15:00:00Z", customer_id: "cus_1", status: "pending", metadata: {}, items: [{ id: "item_1", product_id: "prod_1", quantity: 1, unit_price: 100, metadata: {} }] };

describe("projectOrder recovers the till from pos_sale when the order lost its metadata", () => {
  it("joins pos_sale by order_id: channel pos, the sale's store, seller and till", async () => {
    const c = projectionContainer(webLikeOrder, [], { id: "poss_1", number: "Op2-000001", status: "completed", establishment_id: "est_2", seller_id: "user_7", seller_code: "V7", terminal_id: "posterm_3", order_id: "order_1" });
    await expect(projectOrder(c.scope, "order_1")).resolves.toBe(1);
    expect(c.pos.listPosSales).toHaveBeenCalledWith({ order_id: "order_1" }, { take: 1 });
    expect(c.facts.createSaleFacts).toHaveBeenCalledWith([
      expect.objectContaining({ channel: "pos", sale_id: "poss_1", sale_number: "Op2-000001", establishment_id: "est_2", seller_id: "user_7", seller_code: "V7", terminal_id: "posterm_3" }),
    ]);
  });

  it("without a sale it is what it says: a web order of no store", async () => {
    const c = projectionContainer(webLikeOrder);
    await projectOrder(c.scope, "order_1");
    expect(c.facts.createSaleFacts).toHaveBeenCalledWith([expect.objectContaining({ channel: "web", sale_id: null, establishment_id: null, seller_id: null })]);
  });
});

describe("reconcileSaleFacts", () => {
  it("projects every order without facts and logs how many got rows; never throws", async () => {
    const c = projectionContainer(webLikeOrder, [{ id: "order_1" }, { id: "order_2" }]);
    await expect(reconcileSaleFacts(c.scope, new Date("2026-11-05T12:00:00Z"))).resolves.toBe(2);
    expect(c.query.graph).toHaveBeenCalledTimes(2);
    expect(c.logger.info).toHaveBeenCalledWith(expect.stringMatching(/^\[sale-fact\] reconciled 2 orders \(2 without facts since 2026-08-07\)/));
  });

  it("is quiet when nothing is missing, and a database failure is a warning", async () => {
    const quiet = projectionContainer(webLikeOrder, []);
    await expect(reconcileSaleFacts(quiet.scope)).resolves.toBe(0);
    expect(quiet.logger.info).not.toHaveBeenCalled();
    const broken = projectionContainer(webLikeOrder, []);
    (broken.scope as { resolve: (k: string) => unknown }).resolve = (k: string) => (k === ContainerRegistrationKeys.PG_CONNECTION ? () => { throw new Error("db down"); } : (quiet.scope as { resolve: (k: string) => unknown }).resolve(k));
    await expect(reconcileSaleFacts(broken.scope)).resolves.toBe(0);
    expect(quiet.logger.warn).toHaveBeenCalledWith(expect.stringContaining("db down"));
  });
});

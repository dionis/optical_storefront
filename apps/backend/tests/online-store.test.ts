import { ledgerOf, statementOf, WEB_ENTITY, buildStatement, type LedgerFact, type LedgerInput, type LedgerItem } from "../src/lib/financial-statement";
import { forgetOnlineStore, onlineStore, pickOnlineStore } from "../src/lib/online-store";
import { webChannelChecks, type WebChannelFacts } from "../src/lib/web-channel";
import type { CostRule } from "../src/lib/costing";

/**
 * THE ONLINE STORE (11-nov-2026): one store of kind `online` is the web shop.
 *  - which store it is, and that the designation is cached and forgettable;
 *  - the ledger books a web order on it: its sales, its gateway fee, next to
 *    its own costs — and the «web» entity no longer exists;
 *  - without one, the ledger is exactly what it was.
 */

describe("pickOnlineStore", () => {
  const rows = [
    { id: "est_1", code: "Op1", name: "Clinic", kind: "own", is_active: true, color: "#111111" },
    { id: "est_4", code: "Op4", name: "Online Optical Store", kind: "online", is_active: true, color: "#0E5AD0" },
    { id: "est_5", code: "Op5", name: "Second web", kind: "online", is_active: true, color: null },
  ];
  it("is the active store of kind online — the oldest when two exist", () => {
    expect(pickOnlineStore(rows)).toEqual({ id: "est_4", code: "Op4", name: "Online Optical Store", color: "#0E5AD0" });
  });
  it("is null when no store is online, or the online one is switched off", () => {
    expect(pickOnlineStore(rows.slice(0, 1))).toBeNull();
    expect(pickOnlineStore([{ ...rows[1], is_active: false }])).toBeNull();
  });
});

describe("onlineStore — read once, cached, dropped on a write", () => {
  const containerOf = (rows: unknown[], calls: { n: number }, fail = false) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["whereNull", "where", "orderBy", "limit"]) chain[m] = () => chain;
    chain.select = async () => {
      calls.n += 1;
      if (fail) throw new Error("db down");
      return rows;
    };
    const pg = () => chain;
    return { resolve: () => pg } as never;
  };
  beforeEach(() => forgetOnlineStore());

  it("asks the database once within the cache window and again after forgetOnlineStore()", async () => {
    const calls = { n: 0 };
    const c = containerOf([{ id: "est_4", code: "Op4", name: "Online", kind: "online", is_active: true, color: "#0E5AD0" }], calls);
    expect((await onlineStore(c, 1_000))?.code).toBe("Op4");
    expect((await onlineStore(c, 5_000))?.id).toBe("est_4");
    expect(calls.n).toBe(1);
    forgetOnlineStore();
    await onlineStore(c, 6_000);
    expect(calls.n).toBe(2);
  });

  it("a failed read answers null and is not cached", async () => {
    const calls = { n: 0 };
    expect(await onlineStore(containerOf([], calls, true), 1_000)).toBeNull();
    const ok = containerOf([{ id: "est_4", code: "Op4", name: "Online", kind: "online", is_active: true }], calls);
    expect((await onlineStore(ok, 1_001))?.id).toBe("est_4");
  });
});

// ── The ledger ───────────────────────────────────────────────────────────────

const rule = (kind: CostRule["kind"], match_key: string, amount: number, unit: CostRule["unit"] = "fixed"): CostRule => ({ kind, match_key, label: match_key, amount, unit, active: true, sort_order: 0 });
const RULES: CostRule[] = [rule("order_percent", "payment_fee", 2.9, "percent"), rule("payment_fixed", "payment_fee_fixed", 0.3)];

const fact = (o: Partial<LedgerFact>): LedgerFact => ({
  order_id: "o1",
  channel: "pos",
  establishment_id: "est_1",
  seller_id: null,
  seller_code: null,
  product_id: "p1",
  sku: "FX1",
  qty: 1,
  total_cents: 10000,
  tax_cents: 0,
  lens_design: null,
  lens_material: null,
  lens_photo: null,
  lens_ar: null,
  lens_finish: null,
  sold_date_local: "2026-11-05",
  ...o,
});
const FACTS = [
  fact({}),
  fact({ order_id: "w1", channel: "web", establishment_id: null, total_cents: 20000, tax_cents: 1000 }),
  fact({ order_id: "w2", channel: "web", establishment_id: null, total_cents: 5000 }),
];
const litem = (o: Partial<LedgerItem>): LedgerItem => ({ id: "c", establishment_id: "est_4", kind: "fixed", amount_cents: 0, frequency: "monthly", amortize_months: null, starts_on: "2026-01-01", ends_on: null, allocation: null, category: "software", ...o });
const ITEMS = [
  litem({ id: "hosting", amount_cents: 9000 }),
  litem({ id: "box", kind: "variable", amount_cents: 200, per_sale: true, category: "supplies" }),
  litem({ id: "acct", establishment_id: null, amount_cents: 30000, allocation: { method: "sales" } }),
];
const input = (o: Partial<LedgerInput> = {}): LedgerInput => ({
  months: ["2026-11"],
  facts: FACTS,
  pays: [],
  rules: RULES,
  items: ITEMS,
  brandOf: () => null,
  pctOf: () => null,
  storeIds: ["est_1", "est_4"],
  activeStoreIds: ["est_1", "est_4"],
  tz: "UTC",
  web: true,
  ...o,
});

describe("ledgerOf — the web's orders are the online store's sales", () => {
  const [nov] = ledgerOf(input({ onlineStoreId: "est_4" }));
  const op4 = nov.entities.get("est_4")!;

  it("books the web orders on the online store and creates no «web» entity", () => {
    expect(nov.entities.has(WEB_ENTITY)).toBe(false);
    expect(op4.sales_count).toBe(2);
    expect(op4.gross_sales).toBe(25000);
    expect(op4.sales_tax).toBe(1000);
    expect(op4.net_sales).toBe(24000);
    expect(op4.web_net_sales).toBe(24000);
    expect(nov.entities.get("est_1")!.net_sales).toBe(10000);
  });

  it("the gateway fee stays the web's formula, once per order", () => {
    expect(op4.payment_fees).toBe(Math.round((20000 * 2.9) / 100) + 30 + Math.round((5000 * 2.9) / 100) + 30);
  });

  it("the store's own, per-sale and shared costs apply to it like to any store", () => {
    const by = Object.fromEntries(op4.costs.map((c) => [c.item_id, c.cents]));
    expect(by.hosting).toBe(9000);
    expect(by.box).toBe(400); // 2 web orders × $2
    // shared by sales: 24000 of 34000 net
    const shared = [...nov.entities.values()].flatMap((e) => e.costs.filter((c) => c.item_id === "acct"));
    expect(shared.reduce((s, c) => s + c.cents, 0)).toBe(30000);
    expect(by.acct).toBeGreaterThan(nov.entities.get("est_1")!.costs.find((c) => c.item_id === "acct")!.cents);
  });

  it("the statement keeps «sold on the web» apart from the till, and the total is the same business", () => {
    const st = statementOf([op4]);
    expect(st.revenue.total).toBe(24000);
    const all = statementOf([...nov.entities.values()]);
    const before = statementOf([...ledgerOf(input())[0].entities.values()]);
    expect(all.revenue.total).toBe(before.revenue.total);
    expect(all.opex.card_fees).toBe(before.opex.card_fees);
    const doc = buildStatement([nov], "month", [
      { id: "est_1", code: "Op1", name: "A", color: null, kind: "store" },
      { id: "est_4", code: "Op4", name: "Online", color: null, kind: "store" },
      { id: "total", code: "TOTAL", name: "", color: null, kind: "total" },
    ]);
    expect(doc.statements.all.total.revenue.total).toBe(34000);
  });

  it("a view without the online store leaves the web out, even with `web`", () => {
    const [m] = ledgerOf(input({ onlineStoreId: "est_4", storeIds: ["est_1"] }));
    expect([...m.entities.keys()]).toEqual(["est_1"]);
    expect(m.entities.get("est_1")!.net_sales).toBe(10000);
  });

  it("without an online store nothing changes: «web» is its own entity with no store costs", () => {
    const [m] = ledgerOf(input());
    expect(m.entities.get(WEB_ENTITY)!.net_sales).toBe(24000);
    expect(m.entities.get(WEB_ENTITY)!.costs).toEqual([]);
    expect(m.entities.get("est_4")!.sales_count).toBe(0);
  });
});

describe("webChannelChecks — the store the web is run with", () => {
  const FACTS_WEB: WebChannelFacts = { publishableKeys: 1, webProducts: 10, regionProviders: ["pp_stripe_stripe"], shippingOptions: 1, lastWebOrder: null, webOrders30d: 0 };
  const ENV = { NODE_ENV: "production", STOREFRONT_URL: "https://shop.example.com" } as NodeJS.ProcessEnv;
  const item = (f: WebChannelFacts) => webChannelChecks(f, ENV).find((c) => c.key === "web.store");
  it("passes with an online store and names it", () => {
    expect(item({ ...FACTS_WEB, onlineStore: { code: "Op4", name: "Online Optical Store" } })).toEqual({ key: "web.store", ok: true, detail: "Op4 · Online Optical Store" });
  });
  it("fails when the backend serves a web catalogue and no store is the online one", () => {
    expect(item({ ...FACTS_WEB, onlineStore: null })?.ok).toBe(false);
    expect(item({ ...FACTS_WEB, webProducts: 0, onlineStore: null })?.ok).toBe(true);
  });
  it("is left out when the designation was not read", () => {
    expect(item(FACTS_WEB)).toBeUndefined();
  });
});

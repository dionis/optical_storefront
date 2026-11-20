/**
 * The digest and the alert plumbing that reads the database (lib/alerts-data.ts),
 * stubbed: the knex builder is a recorder, the services answer from arrays.
 *  - the digest reads sale_fact (web orders when the rule asks, integer cents
 *    until the end, voided sales only counted as voided);
 *  - "store without sales" ignores voided sales;
 *  - the void-requested default is seeded once on an existing installation;
 *  - the emails name who asked and link to the sale.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { alertPanelUrl, digestFigures, digestOrdersQuery, ensureDefaultRules, runAlertsJob, type DigestOrderRow } from "../src/lib/alerts-data";
import { alertLine, renderAlertEmail, renderDigestEmail } from "../src/lib/email/alert-emails";
import { SALES_ALERT_MODULE } from "../src/modules/sales-alert";
import { POS_MODULE } from "../src/modules/pos";

jest.mock("../src/lib/establishments", () => ({
  listEstablishments: jest.fn(async () => [
    { id: "est_1", code: "Op2", name: "El Rancho 39", color: "#B5651D", is_active: true },
    { id: "est_2", code: "Op3", name: "El Rancho 41", color: "#C2185B", is_active: true },
  ]),
}));
jest.mock("../src/lib/store-settings", () => ({ resolveStoreSettings: jest.fn(async () => ({ admin_notification_emails: ["owner@example.com"] })) }));

/** A knex builder stand-in: every call is recorded, the chain resolves to `rows`. */
function fakeKnex(rows: unknown[] = []) {
  const calls: Array<[string, unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => {
    calls.push([name, args]);
    // Nested where callbacks run against the same recorder.
    if (name === "where" && typeof args[0] === "function") (args[0] as (b: unknown) => void).call(builder, builder);
    return builder;
  };
  for (const m of ["whereNull", "where", "whereIn", "orWhere", "select", "sum", "groupBy", "limit", "orderBy"]) builder[m] = chain(m);
  builder.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(rows).then(ok, ko);
  const pg = Object.assign(jest.fn(() => builder), { raw: jest.fn((x: string) => x) });
  return { pg, calls, builder };
}

const ruleRow = (over: Record<string, unknown> = {}) => ({
  id: "alr_1", name: "Resumen", event: "digest", conditions: {}, establishment_ids: null, seller_ids: null, recipients: ["owner@example.com"],
  mode: "daily", schedule: { at: "20:00" }, is_active: true, last_sent_at: null, locale: "es", created_by: "system", updated_by: null, created_at: "2026-11-01T00:00:00.000Z", ...over,
});

const SINCE = new Date("2026-11-04T02:00:00Z");
const NOW = new Date("2026-11-05T02:00:00Z");

describe("digestOrdersQuery", () => {
  it("till sales only by default, one row per order, capped", () => {
    const { pg, calls } = fakeKnex();
    digestOrdersQuery(pg as never, ruleRow({ conditions: {} }) as never, SINCE, NOW);
    expect(pg).toHaveBeenCalledWith("sale_fact");
    expect(calls).toContainEqual(["where", ["channel", "pos"]]);
    expect(calls).toContainEqual(["where", ["sold_at", ">=", SINCE]]);
    expect(calls).toContainEqual(["groupBy", ["order_id", "channel", "establishment_id", "seller_id", "seller_code", "status"]]);
    expect(calls).toContainEqual(["sum", [{ total_cents: "total_cents" }]]);
    expect(calls).toContainEqual(["limit", [20000]]);
  });

  it("include_web adds the web orders even when the rule watches given stores", () => {
    const { pg, calls } = fakeKnex();
    digestOrdersQuery(pg as never, ruleRow({ conditions: { include_web: true }, establishment_ids: ["est_1"], seller_ids: ["user_1"] }) as never, SINCE, NOW);
    expect(calls).not.toContainEqual(["where", ["channel", "pos"]]);
    expect(calls).toContainEqual(["whereIn", ["establishment_id", ["est_1"]]]);
    expect(calls).toContainEqual(["orWhere", ["channel", "web"]]);
    expect(calls).toContainEqual(["whereIn", ["seller_id", ["user_1"]]]);
  });
});

describe("digestFigures", () => {
  const stores = new Map([["est_1", { label: "Op2 · El Rancho 39", color: "#B5651D" }]]);
  const rows: DigestOrderRow[] = [
    { order_id: "o1", channel: "pos", establishment_id: "est_1", seller_id: "user_1", seller_code: "V1", status: "active", total_cents: "20250" },
    { order_id: "o2", channel: "pos", establishment_id: "est_1", seller_id: "user_2", seller_code: "V2", status: "active", total_cents: 10001 },
    { order_id: "o3", channel: "pos", establishment_id: "est_1", seller_id: "user_1", seller_code: "V1", status: "voided", total_cents: 99999 },
    { order_id: "o4", channel: "web", establishment_id: null, seller_id: null, seller_code: null, status: "active", total_cents: "3333" },
  ];

  it("sums in integer cents, converts once at the end, and lists the web store as its own row", () => {
    const d = digestFigures(rows, stores);
    // 20250 + 10001 + 3333 = 33584 cents, never 202.5 + 100.01 + 33.33 in floats.
    expect(d.total).toBe(335.84);
    expect(d.count).toBe(3);
    expect(d.stores).toEqual([
      { label: "Op2 · El Rancho 39", color: "#B5651D", web: false, count: 2, total: 302.51, voided: 1 },
      { label: "", color: null, web: true, count: 1, total: 33.33, voided: 0 },
    ]);
    expect(d.sellers).toEqual([
      { label: "V1", count: 1, total: 202.5 },
      { label: "V2", count: 1, total: 100.01 },
      { label: "—", count: 1, total: 33.33 },
    ]);
  });

  it("a voided sale counts in its store's voided column and nowhere else", () => {
    const d = digestFigures([rows[2]], stores);
    expect(d).toEqual({ stores: [{ label: "Op2 · El Rancho 39", color: "#B5651D", web: false, count: 0, total: 0, voided: 1 }], sellers: [], count: 0, total: 0 });
  });

  it("the email names the web row in the reader's language", () => {
    const d = { since: "x", date: "2026-11-05", ...digestFigures(rows, stores) };
    expect(renderDigestEmail({ name: "Resumen" }, d, "es", "https://p/admin").text).toContain("tienda online: 1 · $33.33");
    expect(renderDigestEmail({ name: "Summary" }, d, "en", "https://p/admin").html).toContain("online store");
  });
});

describe("runAlertsJob: store.idle ignores voided sales", () => {
  it("asks for the latest LIVE sale of each store", async () => {
    const listPosSales = jest.fn(async () => []);
    const alerts = {
      listAlertRules: jest.fn(async () => [ruleRow({ event: "store.idle", conditions: { idle_after: "00:00" }, mode: "every_n_hours", schedule: { hours: 1 } })]),
      createAlertRules: jest.fn(async () => undefined),
      listAlertDeliveries: jest.fn(async () => []),
      createAlertDeliveries: jest.fn(async () => { throw new Error("duplicate"); }),
      updateAlertRules: jest.fn(async () => undefined),
    };
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const registry: Record<string, unknown> = { [SALES_ALERT_MODULE]: alerts, [POS_MODULE]: { listPosSales }, [ContainerRegistrationKeys.LOGGER]: logger };
    await runAlertsJob({ resolve: (k: string) => registry[k] } as never, new Date("2026-11-05T20:00:00Z"));
    expect(listPosSales).toHaveBeenCalledWith({ establishment_id: "est_1", status: { $ne: "voided" } }, { take: 1, order: { created_at: "DESC" } });
    expect(listPosSales).toHaveBeenCalledWith({ establishment_id: "est_2", status: { $ne: "voided" } }, expect.anything());
  });
});

describe("ensureDefaultRules", () => {
  const svcWith = (existing: Array<{ event: string }>) => {
    const s = { listAlertRules: jest.fn(async () => existing), createAlertRules: jest.fn<Promise<void>, [unknown]>(async () => undefined) };
    const registry: Record<string, unknown> = { [SALES_ALERT_MODULE]: s };
    return { s, scope: { resolve: (k: string) => registry[k] } as never };
  };

  it("seeds the whole starting set when no rule ever existed", async () => {
    const { s, scope } = svcWith([]);
    await ensureDefaultRules(scope);
    const created = s.createAlertRules.mock.calls[0][0] as Array<{ event: string; created_by: string }>;
    expect(created.map((r) => r.event)).toEqual(["sale.created", "discount.requested", "sale.voided", "sale.void_requested", "cash.diff", "digest"]);
    expect(created.every((r) => r.created_by === "system")).toBe(true);
  });

  it("adds only 'void requested' to an installation that predates it, once", async () => {
    const { s, scope } = svcWith([{ event: "sale.created" }, { event: "digest" }]);
    await ensureDefaultRules(scope);
    expect((s.createAlertRules.mock.calls[0][0] as Array<{ event: string }>).map((r) => r.event)).toEqual(["sale.void_requested"]);
    const done = svcWith([{ event: "sale.created" }, { event: "sale.void_requested" }]);
    await ensureDefaultRules(done.scope);
    expect(done.s.createAlertRules).not.toHaveBeenCalled();
  });
});

describe("void requested email (HU-28)", () => {
  const data = { number: "Op2-000147", total: 202.5, reason: "price_error", note: "El precio era con descuento", requested_by: "V1", seller_code: "V1", store_code: "Op2", store_name: "El Rancho 39" };

  it("says who asked, which sale, why and the note, in both languages", () => {
    expect(alertLine("sale.void_requested", data, "es")).toBe("V1 pide anular la venta Op2-000147 ($202.50) en Op2 · El Rancho 39: error de precio — «El precio era con descuento»");
    expect(alertLine("sale.void_requested", { ...data, note: null }, "en")).toBe("V1 asks to void sale Op2-000147 ($202.50) at Op2 · El Rancho 39: price error");
  });

  it("links to the sale, not to the list", () => {
    const url = alertPanelUrl({ event: "sale.void_requested", data }, "https://p");
    expect(url).toBe("https://p/admin?tab=possales&number=Op2-000147");
    expect(alertPanelUrl({ event: "sale.voided", data }, "https://p")).toBe("https://p/admin?tab=possales");
    const mail = renderAlertEmail({ name: "Anulación solicitada" }, [{ event: "sale.void_requested", data }], "es", url);
    expect(mail.html).toContain(`href="${url.replace("&", "&amp;")}"`);
    expect(mail.html).toContain("Abrir la venta Op2-000147");
    expect(mail.subject).toContain("V1 pide anular la venta Op2-000147");
  });
});

/**
 * The panel's single search bar. What matters here, in order:
 *
 *  1. the scope: a seller finds only their own sales and no colleague; a
 *     manager only their stores' — enforced in the SQL, not in the browser;
 *  2. the term the owner actually types: a sale number off a receipt, a phone
 *     as they wrote it down;
 *  3. the autocomplete budget: a short term never reaches the database, every
 *     group is one bounded query, and a group that fails does not take the
 *     answer down with it.
 */
import type { EstablishmentRow } from "../src/lib/establishments";
import {
  cleanTerm,
  clampLimit,
  likeEscape,
  omniScope,
  omniSearch,
  orderDisplayId,
  orderPlan,
  packGroups,
  patientPlan,
  phoneKey,
  saleNumberCandidates,
  salePlan,
  sellerPlan,
  shortDate,
  storeMatches,
  toFrameItem,
  toPatientItem,
  toSaleItem,
  toSellerItem,
  type StaffLike,
} from "../src/lib/omni-search";
import { listEstablishments } from "../src/lib/establishments";
import { isAllowedForRestrictedRole } from "../src/lib/staff-roles";

jest.mock("../src/lib/establishments", () => ({ listEstablishments: jest.fn() }));

const store = (id: string, code: string, name: string, is_active = true): EstablishmentRow => ({
  id,
  code,
  name,
  address: null,
  phone: null,
  sales_channel_id: null,
  color: "#000000",
  kind: "own",
  receipt_note: null,
  settlement_pct: null,
  is_active,
  created_at: "2026-01-01T00:00:00.000Z",
});

const STORES = [store("est_01", "Op1", "Centro"), store("est_02", "Op2", "Fry Family"), store("est_03", "Op3", "Hialeah")];

const SELLER: StaffLike = { user_id: "u_me", is_admin: false, role: "seller", establishment_ids: ["est_02"] };
const MANAGER: StaffLike = { user_id: "u_mgr", is_admin: false, role: "manager", establishment_ids: ["est_02"] };
const SUPERVISOR: StaffLike = { user_id: "u_sup", is_admin: false, role: "supervisor", establishment_ids: ["est_01", "est_02"] };
const OWNER: StaffLike = { user_id: "u_own", is_admin: true, role: "owner", establishment_ids: null };

// ---------------------------------------------------------------------------
// The term
// ---------------------------------------------------------------------------

describe("cleanTerm / clampLimit / likeEscape", () => {
  it("trims, collapses the spaces and caps the length", () => {
    expect(cleanTerm("  Daniela   Ruiz  ")).toBe("Daniela Ruiz");
    expect(cleanTerm(undefined)).toBe("");
    expect(cleanTerm(123)).toBe("");
    expect(cleanTerm("x".repeat(200))).toHaveLength(80);
  });

  it("keeps the per-group limit small: 5 by default, 10 at most", () => {
    expect(clampLimit(undefined)).toBe(5);
    expect(clampLimit("")).toBe(5);
    expect(clampLimit("0")).toBe(5);
    expect(clampLimit("-3")).toBe(5);
    expect(clampLimit("abc")).toBe(5);
    expect(clampLimit("3")).toBe(3);
    expect(clampLimit("10")).toBe(10);
    expect(clampLimit("1000")).toBe(10);
  });

  it("makes a typed LIKE metacharacter literal, so one `%` is not a table scan", () => {
    expect(likeEscape("100%")).toBe("100\\%");
    expect(likeEscape("a_b")).toBe("a\\_b");
    expect(likeEscape("a\\b")).toBe("a\\\\b");
  });
});

describe("saleNumberCandidates", () => {
  const codes = ["Op1", "Op2", "Op3"];

  it("reads the number as it is printed, however the owner types it", () => {
    expect(saleNumberCandidates("Op1-000123", codes)).toEqual(["Op1-000123"]);
    expect(saleNumberCandidates("op1-123", codes)).toEqual(["Op1-000123"]);
    expect(saleNumberCandidates("OP1 123", codes)).toEqual(["Op1-000123"]);
    expect(saleNumberCandidates("  Op2 - 7 ", codes)).toEqual(["Op2-000007"]);
  });

  it("takes the sequence alone as that sale in each store the caller may see", () => {
    expect(saleNumberCandidates("123", codes)).toEqual(["Op1-000123", "Op2-000123", "Op3-000123"]);
    expect(saleNumberCandidates("000123", codes)).toEqual(["Op1-000123", "Op2-000123", "Op3-000123"]);
    expect(saleNumberCandidates("#123", codes)).toEqual(["Op1-000123", "Op2-000123", "Op3-000123"]);
    // Only the stores in scope: a sequence never reaches another store's sale.
    expect(saleNumberCandidates("123", ["Op2"])).toEqual(["Op2-000123"]);
  });

  it("gives nothing for a store code outside the caller's stores", () => {
    expect(saleNumberCandidates("Op1-123", ["Op2"])).toEqual([]);
  });

  it("gives nothing when the term is not a number at all", () => {
    expect(saleNumberCandidates("ruiz", codes)).toEqual([]);
    expect(saleNumberCandidates("Op1-", codes)).toEqual([]);
    expect(saleNumberCandidates("Op2", codes)).toEqual([]);
    expect(saleNumberCandidates("1234567", codes)).toEqual([]);
  });
});

describe("orderDisplayId", () => {
  it("reads an order number as the integer it is", () => {
    expect(orderDisplayId("1024")).toBe(1024);
    expect(orderDisplayId("#1024")).toBe(1024);
    expect(orderDisplayId(" 0001024 ")).toBe(1024);
  });

  it("is null for anything that is not a plain number, so the group is not queried", () => {
    expect(orderDisplayId("ruiz")).toBeNull();
    expect(orderDisplayId("Op1-123")).toBeNull();
    expect(orderDisplayId("0")).toBeNull();
  });
});

describe("phoneKey", () => {
  it("compares the last ten digits, so the phone as written down matches the one registered", () => {
    expect(phoneKey("+1 305 555 0101")).toBe("3055550101");
    expect(phoneKey("(305) 555-0101")).toBe("3055550101");
    expect(phoneKey("3055550101")).toBe("3055550101");
    expect(phoneKey("13055550101")).toBe("3055550101");
  });

  it("is null under seven digits — a short number matches half the town", () => {
    expect(phoneKey("555")).toBeNull();
    expect(phoneKey("ruiz")).toBeNull();
    expect(phoneKey("555-01")).toBeNull();
  });
});

describe("shortDate", () => {
  it("is the day as the store reads it", () => {
    expect(shortDate("2026-10-28T12:00:00.000Z", "America/Chicago")).toBe("28 oct");
    expect(shortDate("2026-01-05T12:00:00.000Z", "America/Chicago")).toBe("5 ene");
    expect(shortDate("not a date", "America/Chicago")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

describe("omniScope", () => {
  it("lets owner and superadmin reach everything", () => {
    expect(omniScope(OWNER, STORES)).toEqual({ userId: "u_own", storeIds: null, ownSellerId: null, staffVisible: true });
  });

  it("limits a supervisor and a manager to their stores, but not to their own sales", () => {
    expect(omniScope(MANAGER, STORES)).toEqual({ userId: "u_mgr", storeIds: ["est_02"], ownSellerId: null, staffVisible: true });
    expect(omniScope(SUPERVISOR, STORES)).toEqual({ userId: "u_sup", storeIds: ["est_01", "est_02"], ownSellerId: null, staffVisible: true });
  });

  it("pins a seller to their own sales and hides the people and the stores from them", () => {
    expect(omniScope(SELLER, STORES)).toEqual({ userId: "u_me", storeIds: ["est_02"], ownSellerId: "u_me", staffVisible: false });
  });

  it("leaves a deactivated user with no store to look into", () => {
    expect(omniScope({ user_id: "u_x", is_admin: false, role: null, establishment_ids: [] }, STORES).storeIds).toEqual([]);
  });

  it("never counts a closed store as in scope", () => {
    const closed = [store("est_01", "Op1", "Centro"), store("est_02", "Op2", "Fry Family", false)];
    expect(omniScope({ ...MANAGER, establishment_ids: ["est_01", "est_02"] }, closed).storeIds).toEqual(["est_01"]);
  });
});

describe("the plans carry the scope", () => {
  const codes = ["Op1", "Op2", "Op3"];

  it("a seller's sale plan is pinned to them; a manager's is not", () => {
    const seller = salePlan("ruiz", omniScope(SELLER, STORES), codes, 5);
    expect(seller.sellerId).toBe("u_me");
    expect(seller.stores).toEqual(["est_02"]);

    const manager = salePlan("ruiz", omniScope(MANAGER, STORES), codes, 5);
    expect(manager.sellerId).toBeNull();
    expect(manager.stores).toEqual(["est_02"]);

    const owner = salePlan("ruiz", omniScope(OWNER, STORES), codes, 5);
    expect(owner.sellerId).toBeNull();
    expect(owner.stores).toBeNull();
  });

  it("a patient must have a sale in scope for everyone but an admin", () => {
    expect(patientPlan("ruiz", omniScope(SELLER, STORES), 5)).toMatchObject({ requireSale: true, sellerId: "u_me", stores: ["est_02"] });
    expect(patientPlan("ruiz", omniScope(MANAGER, STORES), 5)).toMatchObject({ requireSale: true, sellerId: null, stores: ["est_02"] });
    // The owner searches the whole customer base, web customers included.
    expect(patientPlan("ruiz", omniScope(OWNER, STORES), 5)).toMatchObject({ requireSale: false, sellerId: null, stores: null });
  });

  it("a seller has no seller query at all; a manager's is limited to their stores", () => {
    expect(sellerPlan("dan", omniScope(SELLER, STORES), 5)).toBeNull();
    expect(sellerPlan("dan", omniScope(MANAGER, STORES), 5)).toMatchObject({ stores: ["est_02"] });
    expect(sellerPlan("dan", omniScope(OWNER, STORES), 5)).toMatchObject({ stores: null });
  });

  it("asks for an order only when the term is a number, and through a sale in scope for a non-admin", () => {
    expect(orderPlan("ruiz", omniScope(OWNER, STORES), 5)).toBeNull();
    expect(orderPlan("1024", omniScope(OWNER, STORES), 5)).toMatchObject({ displayId: 1024, requireSale: false });
    expect(orderPlan("1024", omniScope(SELLER, STORES), 5)).toMatchObject({ requireSale: true, sellerId: "u_me", stores: ["est_02"] });
  });
});

describe("storeMatches", () => {
  it("finds a store by its name anywhere and by the start of its code", () => {
    const scope = omniScope(OWNER, STORES);
    expect(storeMatches("family", scope, STORES, 5).map((s) => s.id)).toEqual(["est_02"]);
    expect(storeMatches("op3", scope, STORES, 5).map((s) => s.id)).toEqual(["est_03"]);
    expect(storeMatches("hia", scope, STORES, 5).map((s) => s.id)).toEqual(["est_03"]);
  });

  it("never shows a manager a store that is not theirs", () => {
    const scope = omniScope(MANAGER, STORES);
    expect(storeMatches("centro", scope, STORES, 5)).toEqual([]);
    expect(storeMatches("op1", scope, STORES, 5)).toEqual([]);
    expect(storeMatches("fry", scope, STORES, 5).map((s) => s.id)).toEqual(["est_02"]);
  });

  it("shows a seller no store at all, not even their own", () => {
    expect(storeMatches("fry", omniScope(SELLER, STORES), STORES, 5)).toEqual([]);
  });

  it("respects the limit", () => {
    expect(storeMatches("op", omniScope(OWNER, STORES), STORES, 2)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Rows the panel reads
// ---------------------------------------------------------------------------

const NAMES = new Map(STORES.map((s) => [s.id, { code: s.code, name: s.name }]));

describe("row mapping", () => {
  it("a sale reads as its number, who it is for, where and when", () => {
    const item = toSaleItem(
      {
        id: "poss_1",
        number: "Op2-000123",
        establishment_id: "est_02",
        total_cents: 24050,
        created_at: "2026-10-28T12:00:00.000Z",
        order_id: "order_9",
        first_name: "Daniela",
        last_name: "Ruiz",
      },
      NAMES,
      "America/Chicago"
    );
    expect(item).toEqual({
      id: "poss_1",
      label: "Op2-000123",
      sub: "Daniela Ruiz · Fry Family · 28 oct",
      amount: 240.5,
      store_id: "est_02",
      extra: { order_id: "order_9" },
    });
  });

  it("a patient carries a name, a phone and the purchases in scope — and nothing clinical", () => {
    const item = toPatientItem({ id: "cus_1", first_name: "Daniela", last_name: "Ruiz", email: "d@x.co", phone: "+1 305 555 0101", sales: 3 });
    expect(item).toEqual({
      id: "cus_1",
      label: "Daniela Ruiz",
      sub: "+1 305 555 0101 · 3 compras",
      store_id: null,
      extra: { phone: "+1 305 555 0101" },
    });
    const keys = new Set([...Object.keys(item), ...Object.keys(item.extra ?? {})]);
    for (const forbidden of ["prescription", "prescription_id", "sphere", "cylinder", "axis", "add", "diagnosis", "birth_date", "rx"]) {
      expect(keys.has(forbidden)).toBe(false);
    }
    expect(JSON.stringify(item)).not.toMatch(/sphere|cylinder|prescription|diagnos/i);
  });

  it("says `1 compra` for a single purchase and drops the count when there is none", () => {
    expect(toPatientItem({ id: "c", first_name: "A", last_name: "B", email: null, phone: "305", sales: 1 }).sub).toBe("305 · 1 compra");
    expect(toPatientItem({ id: "c", first_name: "A", last_name: "B", email: null, phone: null, sales: 0 }).sub).toBeNull();
  });

  it("a seller reads as their name, their code and their store", () => {
    expect(toSellerItem({ id: "sel_1", name: "Daniela Ruiz", code: "DAN", establishment_id: "est_02" }, NAMES)).toEqual({
      id: "sel_1",
      label: "Daniela Ruiz",
      sub: "DAN · Fry Family",
      extra: { code: "DAN" },
    });
  });

  it("a frame reads as brand, model and colour, with its code below", () => {
    expect(toFrameItem({ id: "prod_1", title: "DICAPRIO DC-204", brand: "DICAPRIO", sku: "DC204-BK", color: "Negro" })).toEqual({
      id: "prod_1",
      label: "DICAPRIO DC-204 Negro",
      sub: "SKU DC204-BK · DICAPRIO",
      extra: { sku: "DC204-BK" },
    });
    // The brand is prepended only when the title does not already carry it.
    expect(toFrameItem({ id: "prod_2", title: "DC-310", brand: "FLEXURE", sku: null, color: null }).label).toBe("FLEXURE DC-310");
  });
});

describe("packGroups", () => {
  it("leaves out the groups that found nothing and keeps the panel's order", () => {
    const groups = packGroups({
      frame: [{ id: "p", label: "F", sub: null }],
      patient: [],
      sale: [{ id: "s", label: "Op1-000001", sub: null }],
    });
    expect(groups.map((g) => g.kind)).toEqual(["sale", "frame"]);
  });

  it("is empty when nothing matched", () => {
    expect(packGroups({ sale: [], patient: [], frame: [] })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The whole request, over a knex that records what it was asked
// ---------------------------------------------------------------------------

interface Call {
  table: string;
  m: string;
  args: unknown[];
}

const CHAIN = [
  "select", "where", "whereNot", "whereNull", "whereIn", "whereILike", "whereRaw", "whereExists",
  "orWhere", "orWhereIn", "orWhereILike", "orWhereRaw", "andWhere", "count",
  "leftJoin", "innerJoin", "join", "joinRaw", "on", "andOn", "andOnNull", "orderBy", "limit", "groupBy", "first",
];

/** A knex that answers with fixtures and keeps a note of every call, per table. */
function recordingPg(rows: Record<string, unknown[]>, fails: string[] = []) {
  const calls: Call[] = [];
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of CHAIN) {
      b[m] = (...args: unknown[]) => {
        calls.push({ table, m, args });
        // The OR blocks are callbacks over the same builder: run them so their
        // predicates are recorded too.
        for (const a of args) if (typeof a === "function") (a as (q: unknown) => void).call(b, b);
        return b;
      };
    }
    b.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
      (fails.includes(table) ? Promise.reject(new Error(`${table} exploded`)) : Promise.resolve(rows[table] ?? [])).then(ok, bad);
    return b;
  };
  const pg = ((t: unknown) => builder(typeof t === "string" ? t : String(Object.values(t as object)[0]))) as unknown as Record<string, unknown> &
    ((t: unknown) => unknown);
  (pg as Record<string, unknown>).raw = (sql: string, bindings?: unknown) => ({ sql, bindings });
  return { pg, calls };
}

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function containerOf(pg: unknown) {
  return {
    resolve: (key: string) => (key === "__pg_connection__" ? pg : logger),
  } as never;
}

const SALE_ROW = {
  id: "poss_1",
  number: "Op2-000123",
  establishment_id: "est_02",
  total_cents: 24050,
  created_at: "2026-10-28T12:00:00.000Z",
  order_id: "order_9",
  first_name: "Daniela",
  last_name: "Ruiz",
};
const PATIENT_ROW = { id: "cus_1", first_name: "Daniela", last_name: "Ruiz", email: "d@x.co", phone: "+1 305 555 0101", sales: 3 };
const SELLER_ROW = { id: "sel_1", name: "Daniela Ruiz", code: "DAN", establishment_id: "est_02" };
const FRAME_ROW = { id: "prod_1", title: "DICAPRIO DC-204", brand: "DICAPRIO", sku: "DC204-BK", color: "Negro" };

beforeEach(() => {
  jest.clearAllMocks();
  (listEstablishments as jest.Mock).mockResolvedValue(STORES);
});

describe("omniSearch", () => {
  it("does not touch the database for a term under two characters", async () => {
    const { pg, calls } = recordingPg({});
    const resolve = jest.fn((key: string) => (key === "__pg_connection__" ? pg : logger));
    for (const q of ["", " ", "r", "  a "]) {
      const body = await omniSearch({ resolve } as never, OWNER, { q });
      expect(body.groups).toEqual([]);
    }
    expect(calls).toEqual([]);
    // Not even the establishment list is read: that is a query too.
    expect(listEstablishments).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("answers with one group per kind that found something, and leaves the rest out", async () => {
    const { pg } = recordingPg({ pos_sale: [SALE_ROW], customer: [PATIENT_ROW], seller: [SELLER_ROW], product: [FRAME_ROW], order: [] });
    const body = await omniSearch(containerOf(pg), OWNER, { q: "ruiz" });
    expect(body.q).toBe("ruiz");
    expect(body.groups.map((g) => g.kind)).toEqual(["sale", "patient", "seller", "frame"]);
    expect(body.groups[0].items[0]).toMatchObject({ label: "Op2-000123", amount: 240.5, store_id: "est_02" });
  });

  it("serves the store group from the list it already has, without a query", async () => {
    const { pg, calls } = recordingPg({});
    const body = await omniSearch(containerOf(pg), OWNER, { q: "family" });
    expect(body.groups).toEqual([{ kind: "store", items: [{ id: "est_02", label: "Fry Family", sub: "Op2" }] }]);
    expect(calls.some((c) => c.table === "establishment")).toBe(false);
  });

  it("is four queries for a word and five for a number — one per group, in parallel", async () => {
    const word = recordingPg({});
    await omniSearch(containerOf(word.pg), OWNER, { q: "ruiz" });
    expect(new Set(word.calls.filter((c) => c.m === "limit").map((c) => c.table))).toEqual(new Set(["pos_sale", "customer", "seller", "product"]));
    expect(word.calls.filter((c) => c.m === "limit")).toHaveLength(4);

    const number = recordingPg({});
    await omniSearch(containerOf(number.pg), OWNER, { q: "1024" });
    expect(number.calls.filter((c) => c.m === "limit")).toHaveLength(5);
    expect(number.calls.some((c) => c.table === "order" && c.m === "where" && c.args[0] === "o.display_id" && c.args[1] === 1024)).toBe(true);
  });

  it("puts the limit on every query and caps it at ten", async () => {
    const a = recordingPg({});
    await omniSearch(containerOf(a.pg), OWNER, { q: "ruiz" });
    expect(a.calls.filter((c) => c.m === "limit").map((c) => c.args[0])).toEqual([5, 5, 5, 5]);

    const b = recordingPg({});
    await omniSearch(containerOf(b.pg), OWNER, { q: "ruiz", limit: "500" });
    expect(new Set(b.calls.filter((c) => c.m === "limit").map((c) => c.args[0]))).toEqual(new Set([10]));
  });

  it("cuts a group that came back longer than the limit", async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...SALE_ROW, id: `poss_${i}` }));
    const { pg } = recordingPg({ pos_sale: many });
    const body = await omniSearch(containerOf(pg), OWNER, { q: "ruiz", limit: "3" });
    expect(body.groups.find((g) => g.kind === "sale")?.items).toHaveLength(3);
  });

  it("returns the groups that did come back when one query fails, and logs it", async () => {
    const { pg } = recordingPg({ pos_sale: [SALE_ROW], customer: [PATIENT_ROW] }, ["product"]);
    const body = await omniSearch(containerOf(pg), OWNER, { q: "ruiz" });
    expect(body.groups.map((g) => g.kind)).toEqual(["sale", "patient"]);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("[omni-search] the frame query failed"));
  });

  // -------------------------------------------------------------------------
  // The scope, in the SQL
  // -------------------------------------------------------------------------

  it("a seller only ever asks for their own sales, in their own store", async () => {
    const { pg, calls } = recordingPg({ pos_sale: [SALE_ROW], customer: [PATIENT_ROW], seller: [SELLER_ROW], product: [FRAME_ROW] });
    const body = await omniSearch(containerOf(pg), SELLER, { q: "ruiz" });

    // Every sale predicate pins the seller; nothing asks for another store.
    expect(calls).toContainEqual({ table: "pos_sale", m: "where", args: ["s.seller_id", "u_me"] });
    expect(calls).toContainEqual({ table: "pos_sale", m: "whereIn", args: ["s.establishment_id", ["est_02"]] });
    const stores = calls.filter((c) => c.m === "whereIn" && /establishment_id$/.test(String(c.args[0]))).map((c) => c.args[1]);
    expect(stores.length).toBeGreaterThan(0);
    for (const s of stores) expect(s).toEqual(["est_02"]);
    // The count of purchases is their own too.
    expect(calls).toContainEqual({ table: "pos_sale", m: "where", args: ["s2.seller_id", "u_me"] });
    expect(calls).toContainEqual({ table: "pos_sale", m: "whereIn", args: ["s2.establishment_id", ["est_02"]] });
    // And the patient must hang off a sale of theirs.
    expect(calls.some((c) => c.table === "customer" && c.m === "whereExists")).toBe(true);

    // No colleague and no store, however well they match.
    expect(calls.some((c) => c.table === "seller")).toBe(false);
    expect(body.groups.map((g) => g.kind)).toEqual(["sale", "patient", "frame"]);
  });

  it("a manager asks for their stores but not for one seller's sales", async () => {
    const { pg, calls } = recordingPg({ pos_sale: [SALE_ROW], customer: [PATIENT_ROW], seller: [SELLER_ROW] });
    await omniSearch(containerOf(pg), MANAGER, { q: "ruiz" });

    expect(calls).toContainEqual({ table: "pos_sale", m: "whereIn", args: ["s.establishment_id", ["est_02"]] });
    expect(calls).toContainEqual({ table: "seller", m: "whereIn", args: ["sl.establishment_id", ["est_02"]] });
    expect(calls.some((c) => /seller_id$/.test(String(c.args[0])))).toBe(false);
    // Never a store outside theirs.
    for (const c of calls.filter((x) => x.m === "whereIn")) {
      const v = c.args[1];
      if (Array.isArray(v)) expect(v).not.toContain("est_01");
    }
  });

  it("a manager cannot reach another store's sale by typing its number", async () => {
    const { pg, calls } = recordingPg({});
    await omniSearch(containerOf(pg), MANAGER, { q: "123" });
    // The sequence is expanded only over the stores in scope: Op1 and Op3 are
    // never even candidates, and the store filter is there regardless.
    const numbers = calls.find((c) => c.m === "orWhereIn" && c.args[0] === "s.number")?.args[1];
    expect(numbers).toEqual(["Op2-000123"]);
    expect(calls).toContainEqual({ table: "pos_sale", m: "whereIn", args: ["s.establishment_id", ["est_02"]] });

    const other = recordingPg({});
    await omniSearch(containerOf(other.pg), MANAGER, { q: "Op1-000123" });
    expect(other.calls.find((c) => c.m === "orWhereIn" && c.args[0] === "s.number")).toBeUndefined();
  });

  it("the owner asks with no store or seller filter at all", async () => {
    const { pg, calls } = recordingPg({});
    await omniSearch(containerOf(pg), OWNER, { q: "ruiz" });
    expect(calls.some((c) => /establishment_id$/.test(String(c.args[0])))).toBe(false);
    expect(calls.some((c) => /seller_id$/.test(String(c.args[0])))).toBe(false);
    // No EXISTS either: the whole customer base is searchable, web included.
    expect(calls.some((c) => c.m === "whereExists")).toBe(false);
  });

  it("asks nothing of the database for a user whose stores were all taken away", async () => {
    const { pg, calls } = recordingPg({ pos_sale: [SALE_ROW] });
    const body = await omniSearch(containerOf(pg), { user_id: "u_x", is_admin: false, role: null, establishment_ids: [] }, { q: "ruiz" });
    expect(body).toEqual({ q: "ruiz", groups: [] });
    expect(calls).toEqual([]);
  });

  it("matches names and codes by prefix, and only the frame title from the middle", async () => {
    const { pg, calls } = recordingPg({});
    await omniSearch(containerOf(pg), OWNER, { q: "ruiz" });
    const patterns = calls.filter((c) => c.m === "orWhereILike").map((c) => ({ col: c.args[0], pat: c.args[1] }));
    expect(patterns).toContainEqual({ col: "c.last_name", pat: "ruiz%" });
    expect(patterns).toContainEqual({ col: "c.first_name", pat: "ruiz%" });
    expect(patterns).toContainEqual({ col: "s.seller_code", pat: "ruiz%" });
    expect(patterns).toContainEqual({ col: "sl.code", pat: "ruiz%" });
    // The only `%term%` in the whole request is the frame's title.
    expect(patterns.filter((p) => String(p.pat).startsWith("%"))).toEqual([{ col: "p.title", pat: "%ruiz%" }]);
  });

  it("compares the phone with the digits on both sides, and only when it looks like a phone", async () => {
    const { pg, calls } = recordingPg({});
    await omniSearch(containerOf(pg), OWNER, { q: "(305) 555-0101" });
    const raw = calls.filter((c) => c.m === "orWhereRaw" && String(c.args[0]).includes("regexp_replace"));
    expect(raw).toHaveLength(2); // the patient's phone and the seller's
    for (const c of raw) expect(c.args[1]).toEqual(["3055550101"]);

    const short = recordingPg({});
    await omniSearch(containerOf(short.pg), OWNER, { q: "ruiz" });
    expect(short.calls.some((c) => c.m === "orWhereRaw" && String(c.args[0]).includes("regexp_replace"))).toBe(false);
  });
});

describe("the route is reachable by the roles that need it", () => {
  it("lets a restricted role call GET /admin/search — the scoping happens inside", () => {
    expect(isAllowedForRestrictedRole("GET", "/admin/search?q=ruiz")).toBe(true);
    expect(isAllowedForRestrictedRole("GET", "/admin/search")).toBe(true);
  });

  it("opens nothing else: no writes and no neighbouring path", () => {
    expect(isAllowedForRestrictedRole("POST", "/admin/search")).toBe(false);
    expect(isAllowedForRestrictedRole("GET", "/admin/search/anything")).toBe(false);
    expect(isAllowedForRestrictedRole("GET", "/admin/searchable")).toBe(false);
  });
});

import { readFileSync } from "fs";
import { join } from "path";
/**
 * Sellers: referral codes, dashboard-link tokens and stats grouping. Pure
 * functions only — no database, no HTTP.
 */
import {
  COUNTER_SOURCE,
  SELLER_SOURCES,
  attributeSale,
  customerInitials,
  deriveSellerCode,
  goalProgress,
  groupSellerStats,
  normalizeSellerCode,
  normalizeSellerSource,
  parseCommissionPct,
  sellerLinks,
  parseSellerLink,
  sellerLinkProblem,
  sellerPlacementProblem,
  sellerSourceOf,
  signSellerToken,
  statsDayFilter,
  verifySellerToken, projectSeller, type StatOrder } from "../src/lib/sellers";
import { normalizeSellerCodeLoose } from "../src/lib/order-board";
import { EMPTY_TERMINAL_USAGE, sellerTillProblem, terminalDeactivateProblem, terminalDeleteProblem, type TerminalUsage } from "../src/lib/pos";

beforeAll(() => {
  process.env.SELLER_LINK_SECRET = "test-seller-secret";
  process.env.STOREFRONT_URL = "https://shop.example/";
});

describe("normalizeSellerCode", () => {
  it("uppercases, folds accents and drops separators", () => {
    expect(normalizeSellerCode("ana")).toBe("ANA");
    expect(normalizeSellerCode(" ángel-g ")).toBe("ANGELG");
    expect(normalizeSellerCode("ana.g2")).toBe("ANAG2");
  });

  it("rejects codes outside 3–12 characters", () => {
    expect(normalizeSellerCode("ab")).toBeNull();
    expect(normalizeSellerCode("abcdefghijklm")).toBeNull();
    expect(normalizeSellerCode("")).toBeNull();
    expect(normalizeSellerCode(null)).toBeNull();
  });

  it("the loose variant (what a cart carried) never rejects, only cleans", () => {
    expect(normalizeSellerCodeLoose(" ana ")).toBe("ANA");
    expect(normalizeSellerCodeLoose("a")).toBe("A");
    expect(normalizeSellerCodeLoose("")).toBeNull();
    expect(normalizeSellerCodeLoose(undefined)).toBeNull();
  });
});

describe("normalizeSellerSource", () => {
  it("keeps a lowercase a-z token of at most 20 characters", () => {
    expect(normalizeSellerSource("instagram")).toBe("instagram");
    expect(normalizeSellerSource(" TikTok ")).toBe("tiktok");
    expect(normalizeSellerSource("x")).toBe("x");
    expect(normalizeSellerSource("what's-app 2")).toBe("whatsapp");
    expect(normalizeSellerSource("a".repeat(30))).toHaveLength(20);
  });

  it("is null when nothing is left, and the stats fall back to the plain link", () => {
    expect(normalizeSellerSource("")).toBeNull();
    expect(normalizeSellerSource("123")).toBeNull();
    expect(normalizeSellerSource(undefined)).toBeNull();
    expect(normalizeSellerSource(null)).toBeNull();
    expect(sellerSourceOf({ seller_source: null })).toBe("link");
    expect(sellerSourceOf({ seller_source: "Facebook" })).toBe("facebook");
  });
});

describe("deriveSellerCode", () => {
  it("uses the first name", () => {
    expect(deriveSellerCode("Ana García")).toBe("ANA");
    expect(deriveSellerCode("José Luis")).toBe("JOSE");
  });

  it("adds the surname initial, then a counter, when taken", () => {
    expect(deriveSellerCode("Ana García", new Set(["ANA"]))).toBe("ANAG");
    expect(deriveSellerCode("Ana García", new Set(["ANA", "ANAG"]))).toBe("ANAG2");
    expect(deriveSellerCode("Ana García", new Set(["ANA", "ANAG", "ANAG2"]))).toBe("ANAG3");
    expect(deriveSellerCode("Ana", new Set(["ANA"]))).toBe("ANA2");
  });

  it("pads short names and caps long ones", () => {
    expect(deriveSellerCode("Jo")).toBe("JOX");
    expect(deriveSellerCode("Maximiliana Rodríguez")).toBe("MAXIMILIANA");
    expect(deriveSellerCode("Maximilianaaaaa X").length).toBeLessThanOrEqual(12);
    expect(deriveSellerCode("")).toBe("VEND");
  });
});

describe("seller tokens", () => {
  it("round-trips and binds the version", () => {
    const t = signSellerToken("sel_1", 1);
    expect(verifySellerToken(t)).toEqual({ sid: "sel_1", v: 1, p: "seller" });
  });

  it("rejects a tampered or foreign token", () => {
    const t = signSellerToken("sel_1", 1);
    expect(verifySellerToken(t.slice(0, -2) + "zz")).toBeNull();
    expect(verifySellerToken("not-a-token")).toBeNull();
    expect(verifySellerToken(null)).toBeNull();
    const [body] = t.split(".");
    expect(verifySellerToken(`${body}.AAAA`)).toBeNull();
  });

  it("a rotated version is a different token (the old one no longer matches the row)", () => {
    const v1 = signSellerToken("sel_1", 1);
    const v2 = signSellerToken("sel_1", 2);
    expect(v1).not.toBe(v2);
    expect(verifySellerToken(v1)?.v).toBe(1);
    expect(verifySellerToken(v2)?.v).toBe(2);
  });

  it("builds the referral and dashboard links on the storefront origin", () => {
    const links = sellerLinks({ id: "sel_1", code: "ANA", token_version: 3 });
    expect(links.referral_url).toBe("https://shop.example/?ref=ANA");
    expect(links.dashboard_url.startsWith("https://shop.example/vendedor?t=")).toBe(true);
    const token = decodeURIComponent(links.dashboard_url.split("t=")[1]);
    expect(verifySellerToken(token)).toEqual({ sid: "sel_1", v: 3, p: "seller" });
  });

  it("builds one tagged referral link per network (the plain link for 'link')", () => {
    const { social_links, referral_url } = sellerLinks({ id: "sel_1", code: "ANA", token_version: 1 });
    expect(Object.keys(social_links).sort()).toEqual([...SELLER_SOURCES].sort());
    expect(social_links.instagram).toBe("https://shop.example/?ref=ANA&src=instagram");
    expect(social_links.whatsapp).toBe("https://shop.example/?ref=ANA&src=whatsapp");
    expect(social_links.x).toBe("https://shop.example/?ref=ANA&src=x");
    expect(social_links.link).toBe(referral_url);
    expect(social_links.link).toBe("https://shop.example/?ref=ANA");
  });
});

describe("parseCommissionPct", () => {
  it("accepts 0–100 with a percent sign and defaults to 0", () => {
    expect(parseCommissionPct("10")).toBe(10);
    expect(parseCommissionPct("12.5%")).toBe(12.5);
    expect(parseCommissionPct(undefined)).toBe(0);
    expect(parseCommissionPct("")).toBe(0);
  });
  it("rejects out-of-range or non-numeric", () => {
    expect(parseCommissionPct("101")).toBeNull();
    expect(parseCommissionPct("-1")).toBeNull();
    expect(parseCommissionPct("abc")).toBeNull();
  });
});

describe("groupSellerStats", () => {
  const sellers = [
    { id: "s1", code: "ANA", name: "Ana", commission_pct: 10, active: true },
    { id: "s2", code: "LUIS", name: "Luis", commission_pct: 5, active: false },
  ];
  const orders = [
    { seller_code: "ANA", total: 100, terminal: null, created_at: "2026-10-01T10:00:00Z", seller_source: "instagram" },
    { seller_code: "ana", total: 50.5, terminal: null, created_at: "2026-10-05T10:00:00Z", seller_source: null },
    { seller_code: "ANA", total: 999, terminal: "canceled" as const, created_at: "2026-10-06T10:00:00Z", seller_source: "instagram" },
    { seller_code: null, total: 30, terminal: null, created_at: "2026-10-02T10:00:00Z", seller_source: "tiktok" },
    { seller_code: "GHOST", total: 20, terminal: null, created_at: "2026-10-03T10:00:00Z", seller_source: "facebook" },
  ];

  it("sums revenue per seller, skips terminal orders and computes the commission", () => {
    const { sellers: rows, unattributed } = groupSellerStats(orders, sellers);
    const ana = rows.find((r) => r.code === "ANA")!;
    expect(ana.orders).toBe(2);
    expect(ana.revenue).toBe(150.5);
    expect(ana.commission).toBe(15.05);
    expect(ana.last_order_at).toBe("2026-10-05T10:00:00.000Z");
    // Sellers with no sales are still listed, with zeros.
    const luis = rows.find((r) => r.code === "LUIS")!;
    expect(luis).toMatchObject({ orders: 0, revenue: 0, commission: 0, last_order_at: null, active: false });
    // No code, or a code that belongs to nobody, is unattributed.
    expect(unattributed).toEqual({ orders: 2, revenue: 50 });
  });

  it("groups each seller's sales by the network that brought them ('link' when untagged)", () => {
    const { sellers: rows, sources } = groupSellerStats(orders, sellers);
    const ana = rows.find((r) => r.code === "ANA")!;
    expect(ana.by_source).toEqual([
      { source: "instagram", orders: 1, revenue: 100 },
      { source: "link", orders: 1, revenue: 50.5 },
    ]);
    expect(rows.find((r) => r.code === "LUIS")!.by_source).toEqual([]);
    // Across attributed orders only: the canceled one and the unattributed ones never count.
    expect(sources).toEqual([
      { source: "instagram", orders: 1, revenue: 100 },
      { source: "link", orders: 1, revenue: 50.5 },
    ]);
  });

  it("sorts sources by revenue, then orders, then name", () => {
    const { sources } = groupSellerStats(
      [
        { seller_code: "ANA", total: 10, terminal: null, created_at: "2026-10-01T10:00:00Z", seller_source: "tiktok" },
        { seller_code: "ANA", total: 10, terminal: null, created_at: "2026-10-01T10:00:00Z", seller_source: "facebook" },
        { seller_code: "ANA", total: 5, terminal: null, created_at: "2026-10-01T10:00:00Z", seller_source: "facebook" },
        { seller_code: "ANA", total: 15, terminal: null, created_at: "2026-10-01T10:00:00Z", seller_source: "whatsapp" },
      ],
      sellers
    );
    expect(sources.map((s) => s.source)).toEqual(["facebook", "whatsapp", "tiktok"]);
  });

  it("adds units, the average ticket and the quota (share of EVERY sale, attributed or not), biggest first", () => {
    const withItems = orders.map((o, i) => ({ ...o, id: `o${i}`, items: [{ quantity: 2 }, { quantity: 1 }] }));
    const { sellers: rows } = groupSellerStats(withItems, sellers);
    const ana = rows[0];
    expect(ana.code).toBe("ANA");
    expect(ana.units).toBe(6);
    expect(ana.avg_ticket).toBe(75.25);
    // 150.5 of 200.5 (ana + the two unattributed orders).
    expect(ana.share_pct).toBe(75.1);
    expect(ana.profit).toBeNull();
    expect(ana.avg_profit).toBeNull();
    expect(rows[1]).toMatchObject({ code: "LUIS", units: 0, avg_ticket: 0, share_pct: 0 });
  });

  it("fills profit and the average profit per sale only when a profit map is given", () => {
    const withIds = orders.map((o, i) => ({ ...o, id: `o${i}` }));
    const profit = new Map([["o0", 40], ["o1", 10.5], ["o2", 500], ["o3", 9]]);
    const { sellers: rows } = groupSellerStats(withIds, sellers, profit);
    const ana = rows.find((r) => r.code === "ANA")!;
    // The canceled order (o2) counts for nobody, whatever its profit.
    expect(ana.profit).toBe(50.5);
    expect(ana.avg_profit).toBe(25.25);
    expect(rows.find((r) => r.code === "LUIS")).toMatchObject({ profit: 0, avg_profit: 0 });
  });
});

describe("groupSellerStats over sale_fact: counter sales and web referrals (QA D-13, 5-nov-2026)", () => {
  // SOFIA sells at the till as panel user u_sofia; LUIS only shares referral links.
  const sellers = [
    { id: "s1", code: "SOFIA", name: "Sofía", commission_pct: 10, active: true, user_id: "u_sofia" },
    { id: "s2", code: "LUIS", name: "Luis", commission_pct: 5, active: true, user_id: null },
  ];
  const at = "2026-11-05T15:00:00Z";
  // A till sale: seller_id = the user, seller_code = the receipt code (here the owner's ME01, not a record's code).
  const pos = (over: Partial<StatOrder> = {}): StatOrder => ({ id: "o-pos", channel: "pos", seller_id: "u_sofia", seller_code: "SOFIA", total: 71.33, tax_total: 5.33, created_at: at, units: 2, ...over });
  // A web order from a referral link: no user, only the code.
  const web = (over: Partial<StatOrder> = {}): StatOrder => ({ id: "o-web", channel: "web", seller_id: null, seller_code: "LUIS", total: 100, tax_total: 0, created_at: at, units: 1, seller_source: "instagram", ...over });

  it("a seller with a panel user gets their till sales, whatever code the receipt printed", () => {
    const { sellers: rows, unattributed } = groupSellerStats([pos(), pos({ id: "o-pos2", seller_code: "ME01", total: 50, tax_total: 0 })], sellers);
    const sofia = rows.find((r) => r.code === "SOFIA")!;
    expect(sofia).toMatchObject({ orders: 2, revenue: 121.33, net_revenue: 116, commission: 11.6, units: 4 });
    expect(sofia.by_source).toEqual([{ source: "counter", orders: 2, revenue: 121.33 }]);
    expect(unattributed).toEqual({ orders: 0, revenue: 0 });
  });

  it("a referral-only seller gets the web orders that carry their code, by network", () => {
    const { sellers: rows } = groupSellerStats([web(), web({ id: "o-web2", seller_source: null, total: 20 })], sellers);
    const luis = rows.find((r) => r.code === "LUIS")!;
    expect(luis).toMatchObject({ orders: 2, revenue: 120, commission: 6 });
    expect(luis.by_source).toEqual([
      { source: "instagram", orders: 1, revenue: 100 },
      { source: "link", orders: 1, revenue: 20 },
    ]);
    expect(rows.find((r) => r.code === "SOFIA")).toMatchObject({ orders: 0, revenue: 0 });
  });

  it("a sale that matches the same seller by user AND by code is counted once", () => {
    const { sellers: rows, unattributed, sources } = groupSellerStats([pos()], sellers);
    expect(rows.find((r) => r.code === "SOFIA")).toMatchObject({ orders: 1, revenue: 71.33 });
    expect(rows.reduce((n, r) => n + r.orders, 0) + unattributed.orders).toBe(1);
    expect(sources).toEqual([{ source: "counter", orders: 1, revenue: 71.33 }]);
  });

  it("the till user wins over the code: a sale rung up by one seller with another's code goes to the user", () => {
    const { sellers: rows } = groupSellerStats([pos({ seller_code: "LUIS" })], sellers);
    expect(rows.find((r) => r.code === "SOFIA")!.orders).toBe(1);
    expect(rows.find((r) => r.code === "LUIS")!.orders).toBe(0);
  });

  it("a till sale of a user with no record falls back to the code, then to unattributed", () => {
    const byCode = groupSellerStats([pos({ seller_id: "u_owner", seller_code: "LUIS" })], sellers);
    expect(byCode.sellers.find((r) => r.code === "LUIS")!.orders).toBe(1);
    const nobody = groupSellerStats([pos({ seller_id: "u_owner", seller_code: "ME01" })], sellers);
    expect(nobody.unattributed).toEqual({ orders: 1, revenue: 71.33 });
    expect(nobody.sellers.every((r) => r.orders === 0)).toBe(true);
  });

  it("attributeSale is the single rule: user first, code second, null for nobody", () => {
    const byUser = new Map([["u_sofia", "SOFIA"]]);
    const byCode = new Map([["SOFIA", 1], ["LUIS", 1]]);
    expect(attributeSale({ seller_id: "u_sofia", seller_code: "LUIS" }, byUser, byCode)).toBe("SOFIA");
    expect(attributeSale({ seller_id: null, seller_code: "luis" }, byUser, byCode)).toBe("LUIS");
    expect(attributeSale({ seller_id: "u_x", seller_code: "GHOST" }, byUser, byCode)).toBeNull();
    expect(attributeSale({ seller_id: null, seller_code: null }, byUser, byCode)).toBeNull();
  });

  it("voided sales count for nobody and the counter source is not a referral network", () => {
    const { sellers: rows, unattributed } = groupSellerStats([pos({ terminal: "canceled" })], sellers);
    expect(rows.every((r) => r.orders === 0)).toBe(true);
    expect(unattributed).toEqual({ orders: 0, revenue: 0 });
    expect(sellerSourceOf({ channel: "pos", seller_source: "instagram" })).toBe(COUNTER_SOURCE);
    expect((SELLER_SOURCES as readonly string[]).includes(COUNTER_SOURCE)).toBe(false);
  });
});

describe("statsDayFilter", () => {
  it("turns the board window into local days for the economics, tomorrow when open-ended", () => {
    const now = new Date("2026-11-01T23:30:00Z");
    expect(statsDayFilter({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-31T23:59:59.999Z", store: "est_1" }, now)).toEqual({ from: "2026-10-01", to: "2026-10-31", stores: ["est_1"] });
    expect(statsDayFilter({ from: null, to: null, store: "all" }, now)).toEqual({ from: "2000-01-01", to: "2026-11-02", stores: null });
    expect(statsDayFilter({ store: "web" }, now).stores).toEqual(["web"]);
  });
});

describe("customerInitials", () => {
  it("reduces a name to initials and never leaks the rest", () => {
    expect(customerInitials("Ana García Pérez")).toBe("A. G. P.");
    expect(customerInitials("  luis ")).toBe("L.");
    expect(customerInitials(null)).toBe("—");
  });
});

describe("sellerPlacementProblem", () => {
  const stores = [{ id: "est_1", is_active: true }, { id: "est_2", is_active: true }, { id: "est_off", is_active: false }];
  const terminals = [
    { id: "t1", establishment_id: "est_1", is_active: true },
    { id: "t1off", establishment_id: "est_1", is_active: false },
    { id: "t2", establishment_id: "est_2", is_active: true },
  ];
  const check = (active: boolean, establishment_id: string | null, terminal_id: string | null) =>
    sellerPlacementProblem({ active, establishment_id, terminal_id }, stores, terminals);

  it("an active seller needs a live store and a live till of that store", () => {
    expect(check(true, "est_1", "t1")).toBeNull();
    expect(check(true, null, null)).toBe("store_required");
    expect(check(true, "est_1", null)).toBe("terminal_required");
    expect(check(true, "est_off", null)).toBe("store_inactive");
    expect(check(true, "est_1", "t1off")).toBe("terminal_inactive");
  });

  it("an inactive seller may have neither, or just the store", () => {
    expect(check(false, null, null)).toBeNull();
    expect(check(false, "est_1", null)).toBeNull();
    expect(check(false, "est_off", "t1off")).toBe("terminal_wrong_store");
    expect(check(false, "est_1", "t1off")).toBeNull();
  });

  it("whatever is set must be coherent, active or not", () => {
    expect(check(false, null, "t1")).toBe("store_required");
    expect(check(false, "est_9", null)).toBe("store_unknown");
    expect(check(false, "est_1", "t9")).toBe("terminal_unknown");
    expect(check(true, "est_1", "t2")).toBe("terminal_wrong_store");
  });
});

describe("parseSellerLink (Equipo → seller record)", () => {
  it("takes an existing record by id", () => {
    expect(parseSellerLink({ seller_id: " sel_1 " })).toEqual({ seller_id: "sel_1" });
  });

  it("a new record needs store and till", () => {
    expect(parseSellerLink(undefined)).toEqual({ reason: "seller_link_required" });
    expect(parseSellerLink({ create: {} })).toEqual({ reason: "store_required" });
    expect(parseSellerLink({ create: { establishment_id: "est_1" } })).toEqual({ reason: "terminal_required" });
    expect(parseSellerLink({ create: { establishment_id: "est_1", terminal_id: "t1", commission_pct: 140 } })).toEqual({ reason: "commission_invalid" });
    expect(parseSellerLink({ create: { establishment_id: "est_1", terminal_id: "t1", commission_pct: "7.5", code: "" } })).toEqual({
      create: { establishment_id: "est_1", terminal_id: "t1", commission_pct: 7.5, code: null },
    });
  });
});

describe("sellerLinkProblem", () => {
  it("only a free (or own), active record can be linked", () => {
    expect(sellerLinkProblem(null, "u1")).toBe("seller_not_found");
    expect(sellerLinkProblem({ user_id: "u2", active: true }, "u1")).toBe("seller_taken");
    expect(sellerLinkProblem({ user_id: null, active: false }, "u1")).toBe("seller_inactive");
    expect(sellerLinkProblem({ user_id: null, active: true }, "u1")).toBeNull();
    expect(sellerLinkProblem({ user_id: "u1", active: true }, "u1")).toBeNull();
  });
});

describe("sellerTillProblem (counter seller → their one till)", () => {
  const seller = { id: "sel_1", code: "ANA", active: true, establishment_id: "est_1", terminal_id: "t1" };
  const as = (over: Record<string, unknown> = {}) => ({ is_admin: false, role: "seller", seller, ...over });

  it("binds only the seller role", () => {
    expect(sellerTillProblem({ is_admin: false, role: "manager" }, "est_2", "t9")).toBeNull();
    expect(sellerTillProblem({ is_admin: true, role: "owner" }, "est_2", "t9")).toBeNull();
  });

  it("the same rule guards another till's register in the seller's own store", () => {
    // Moving or closing a register goes through sellerTillProblem with the session's store and till.
    expect(sellerTillProblem(as(), "est_1", "t2")).toBe("seller_wrong_till");
    expect(sellerTillProblem({ is_admin: false, role: "manager" }, "est_1", "t2")).toBeNull();
  });

  it("a seller sells only from the store and till of an active record", () => {
    expect(sellerTillProblem(as(), "est_1", "t1")).toBeNull();
    expect(sellerTillProblem(as(), "est_1", "t2")).toBe("seller_wrong_till");
    expect(sellerTillProblem(as(), "est_2", "t1")).toBe("seller_wrong_till");
    expect(sellerTillProblem(as({ seller: null }), "est_1", "t1")).toBe("seller_not_linked");
    expect(sellerTillProblem(as({ seller: { ...seller, active: false } }), "est_1", "t1")).toBe("seller_inactive");
  });
});

describe("terminal delete / deactivate rules", () => {
  const usage = (over: Partial<TerminalUsage> = {}): TerminalUsage => ({ ...EMPTY_TERMINAL_USAGE, ...over });
  const store = [{ id: "t1", is_active: true }, { id: "t2", is_active: true }, { id: "t3", is_active: false }];

  it("deletes only an unused till that is not the store's last", () => {
    expect(terminalDeleteProblem({ id: "t2" }, store, usage())).toBeNull();
    expect(terminalDeleteProblem({ id: "t1" }, [{ id: "t1", is_active: true }], usage())).toBe("last_terminal");
    expect(terminalDeleteProblem({ id: "t2" }, store, usage({ sales: 1 }))).toBe("terminal_in_use");
    expect(terminalDeleteProblem({ id: "t2" }, store, usage({ cash_sessions: 1 }))).toBe("terminal_in_use");
    expect(terminalDeleteProblem({ id: "t2" }, store, usage({ approvals: 2 }))).toBe("terminal_in_use");
    expect(terminalDeleteProblem({ id: "t2" }, store, usage({ sellers: 1 }))).toBe("terminal_has_sellers");
  });

  it("deactivates unless it is the last active one, an active seller uses it, or its register is open", () => {
    expect(terminalDeactivateProblem({ id: "t2" }, store, usage({ sales: 40, sellers: 1 }))).toBeNull();
    expect(terminalDeactivateProblem({ id: "t1" }, [{ id: "t1", is_active: true }, { id: "t3", is_active: false }], usage())).toBe("last_terminal");
    expect(terminalDeactivateProblem({ id: "t2" }, store, usage({ active_sellers: 1 }))).toBe("terminal_has_sellers");
    expect(terminalDeactivateProblem({ id: "t2" }, store, usage({ open_cash: 1 }))).toBe("terminal_cash_open");
  });
});

describe("seller address", () => {
  it("is part of the admin's record", () => {
    expect(projectSeller({ id: "s", name: "A", code: "ANA", address: "1 Main St, Katy, TX 77449" }).address).toBe("1 Main St, Katy, TX 77449");
    expect(projectSeller({ id: "s", name: "A", code: "ANA" }).address).toBeNull();
  });

  it("never reaches the seller's public dashboard, which picks its fields by name", () => {
    const route = readFileSync(join(__dirname, "..", "src", "api", "store", "seller-dashboard", "route.ts"), "utf8");
    expect(route).not.toMatch(/\baddress\s*:/);
    expect(route).not.toMatch(/\.\.\.seller\b/);
  });
});

describe("goalProgress (HU-40)", () => {
  it("measures this month's NET against the goal: dollars out, capped at 100 %", () => {
    expect(goalProgress(2000, 150000)).toEqual({ amount: 2000, done: 1500, left: 500, pct: 75 });
    expect(goalProgress(2000, 250050)).toEqual({ amount: 2000, done: 2500.5, left: 0, pct: 100 });
    expect(goalProgress(300, 10001)).toEqual({ amount: 300, done: 100.01, left: 199.99, pct: 33.3 });
    expect(goalProgress(1000, 0)).toEqual({ amount: 1000, done: 0, left: 1000, pct: 0 });
  });

  it("no goal (null, 0 or garbage) → null; a seller row starts without one", () => {
    expect(goalProgress(null, 5000)).toBeNull();
    expect(goalProgress(0, 5000)).toBeNull();
    expect(goalProgress(Number.NaN, 5000)).toBeNull();
    const { sellers } = groupSellerStats([], [{ id: "sel_1", code: "V1", name: "Ana", commission_pct: 10, active: true, user_id: "user_1" }]);
    expect(sellers[0]).toMatchObject({ user_id: "user_1", goal: null });
  });
});

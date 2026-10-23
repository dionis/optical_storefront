/**
 * Sellers: referral codes, dashboard-link tokens and stats grouping. Pure
 * functions only — no database, no HTTP.
 */
import {
  customerInitials,
  deriveSellerCode,
  groupSellerStats,
  normalizeSellerCode,
  parseCommissionPct,
  sellerLinks,
  signSellerToken,
  verifySellerToken,
} from "../src/lib/sellers";
import { normalizeSellerCodeLoose } from "../src/lib/order-board";

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
    { seller_code: "ANA", total: 100, terminal: null, created_at: "2026-10-01T10:00:00Z" },
    { seller_code: "ana", total: 50.5, terminal: null, created_at: "2026-10-05T10:00:00Z" },
    { seller_code: "ANA", total: 999, terminal: "canceled" as const, created_at: "2026-10-06T10:00:00Z" },
    { seller_code: null, total: 30, terminal: null, created_at: "2026-10-02T10:00:00Z" },
    { seller_code: "GHOST", total: 20, terminal: null, created_at: "2026-10-03T10:00:00Z" },
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
});

describe("customerInitials", () => {
  it("reduces a name to initials and never leaks the rest", () => {
    expect(customerInitials("Ana García Pérez")).toBe("A. G. P.");
    expect(customerInitials("  luis ")).toBe("L.");
    expect(customerInitials(null)).toBe("—");
  });
});

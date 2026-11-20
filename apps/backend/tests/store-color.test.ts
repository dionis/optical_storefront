import { colorCircle, inkOn, nextStoreColor, normalizeColor, storeBanner, storeSubjectTag, STORE_COLORS } from "../src/lib/store-color";
import { renderApprovalRequestEmail } from "../src/lib/email/pos-emails";
import { renderAlertEmail, renderDigestEmail } from "../src/lib/email/alert-emails";
import { renderAdminOrderNotification } from "../src/lib/email/order-confirmation";

describe("store colors", () => {
  it("gives every new store a color no other store has", () => {
    const used: string[] = [];
    for (let i = 0; i < 60; i++) used.push(nextStoreColor(used));
    expect(new Set(used).size).toBe(60);
    expect(used.slice(0, STORE_COLORS.length)).toEqual(STORE_COLORS);
    for (const c of used) expect(normalizeColor(c)).toBe(c);
  });

  it("skips a color the owner chose by hand", () => {
    expect(nextStoreColor(["#2563eb"])).toBe(STORE_COLORS[1]);
  });

  it("accepts only #RRGGBB", () => {
    expect(normalizeColor(" #abcdef ")).toBe("#ABCDEF");
    for (const bad of ["red", "#abc", "#abcdeg", "url(x)", "#ABCDEF;}", null, undefined, 5]) expect(normalizeColor(bad)).toBeNull();
  });

  it("picks readable text on light and dark colors", () => {
    expect(inkOn("#111111")).toBe("#FFFFFF");
    expect(inkOn("#FFFF00")).toBe("#111827");
  });

  it("gives the first stores different circles in the subject", () => {
    const circles = STORE_COLORS.slice(0, 5).map(colorCircle);
    expect(new Set(circles).size).toBe(5);
    expect(storeSubjectTag({ code: "Op2", color: "#DC2626" })).toBe("🔴 Op2");
  });

  it("escapes the store's name and never trusts a bad color", () => {
    const html = storeBanner({ code: "Op1", name: "<b>x</b>", color: "red;background:url(x)" });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("url(x)");
  });
});

describe("emails identify the store by color", () => {
  it("discount request", () => {
    const e = renderApprovalRequestEmail(
      { storeCode: "Op2", storeName: "Norte", storeColor: "#DC2626", seller: "AN", pct: 20, limitPct: 10, belowMinimum: false, list: 100, total: 80, lines: [], reason: null, link: "https://x" },
      "es"
    );
    expect(e.subject.startsWith("🔴 ")).toBe(true);
    expect(e.html).toContain("#DC2626");
  });

  it("alert, with the color of the store of each event", () => {
    const e = renderAlertEmail({ name: "R" }, [{ event: "sale.created", data: { store_code: "Op1", store_name: "N", store_color: "#2563EB", total: 10 } }], "es", "https://x");
    expect(e.subject.startsWith("🔵 ")).toBe(true);
    expect(e.html).toContain("#2563EB");
    const plain = renderAlertEmail({ name: "R" }, [{ event: "sale.created", data: { is_web: true, total: 10 } }], "es", "https://x");
    expect(plain.subject.startsWith("Nueva venta")).toBe(true);
  });

  it("wears the color across the email: stripe, title edge and footer line", () => {
    const e = renderApprovalRequestEmail(
      { storeCode: "Op2", storeName: "Norte", storeColor: "#DC2626", seller: "AN", pct: 20, limitPct: 10, belowMinimum: false, list: 100, total: 80, lines: [], reason: null, link: "https://x" },
      "es"
    );
    expect(e.html).toContain('bgcolor="#DC2626"');
    expect(e.html).toContain("border-left:10px solid #DC2626");
    expect(e.html).toContain("border-top:6px solid #DC2626");
  });

  it("an email with no store keeps the house style", () => {
    const e = renderAlertEmail({ name: "R" }, [{ event: "sale.created", data: { is_web: true, total: 10 } }], "es", "https://x");
    expect(e.html).toContain("border-left:6px solid");
    expect(e.html).not.toContain("border-left:10px");
  });

  it("several alerts: the color only when they are all from one store", () => {
    const ev = (code: string, color: string) => ({ event: "sale.created", data: { store_code: code, store_name: "N", store_color: color, total: 10 } });
    const same = renderAlertEmail({ name: "R" }, [ev("Op1", "#2563EB"), ev("Op1", "#2563EB")], "es", "https://x");
    expect(same.subject.startsWith("🔵 ")).toBe(true);
    expect(same.html).toContain("border-left:10px solid #2563EB");
    const mixed = renderAlertEmail({ name: "R" }, [ev("Op1", "#2563EB"), ev("Op2", "#DC2626")], "es", "https://x");
    expect(mixed.subject.startsWith("🔵 ")).toBe(false);
    expect(mixed.html).not.toContain("border-left:10px");
    expect(mixed.html).toContain("#2563EB");
    expect(mixed.html).toContain("#DC2626");
  });

  it("digest", () => {
    const e = renderDigestEmail({ name: "R" }, { since: "a", date: "b", stores: [{ label: "Op1 · N", color: "#16A34A", count: 1, total: 5, voided: 0 }], sellers: [], count: 1, total: 5 }, "es", "https://x");
    expect(e.html).toContain("#16A34A");
  });

  it("the store's copy of a till sale, and not of a web order", () => {
    const order = { id: "o", display_id: 7, email: "a@example.com", currency_code: "usd", total: 10, created_at: "2026-10-01T10:00:00Z", items: [] } as never;
    const till = renderAdminOrderNotification(order, "es", undefined, { store: { code: "Op3", name: "Sur", color: "#7C3AED" } });
    expect(till.subject.startsWith("🟣 Op3")).toBe(true);
    expect(till.html).toContain("#7C3AED");
    expect(renderAdminOrderNotification(order, "es").subject.startsWith("🟣")).toBe(false);
  });
});

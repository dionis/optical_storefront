import { webChannelChecks, type WebChannelFacts } from "../src/lib/web-channel";

const FACTS: WebChannelFacts = {
  publishableKeys: 1,
  webProducts: 550,
  regionProviders: ["pp_stripe_stripe", "pp_system_default"],
  shippingOptions: 2,
  lastWebOrder: { display_id: 35, created_at: "2026-11-10T20:38:31.592Z", origin: "https://www.rubilens.com" },
  webOrders30d: 5,
};
const ENV = {
  NODE_ENV: "production",
  STOREFRONT_URL: "https://opticaelrancho.com",
  STOREFRONT_URLS: "https://www.rubilens.com,https://rubilens.com",
  STOREFRONT_BRANDS: "https://www.rubilens.com|RUBI LENS;https://rubilens.com|RUBI LENS",
} as NodeJS.ProcessEnv;
const byKey = (checks: ReturnType<typeof webChannelChecks>) => Object.fromEntries(checks.map((c) => [c.key, c]));

describe("webChannelChecks — the online store on this backend", () => {
  it("a wired web shop passes every item and says when its last order arrived", () => {
    const c = byKey(webChannelChecks(FACTS, ENV));
    expect(Object.values(c).every((x) => x.ok)).toBe(true);
    expect(c["web.origins"].detail).toBe("opticaelrancho.com, www.rubilens.com, rubilens.com");
    expect(c["web.brand"].detail).toBe("www.rubilens.com → RUBI LENS, rubilens.com → RUBI LENS");
    expect(c["web.last_order"].detail).toBe("#35 · 2026-11-10 · www.rubilens.com · 5/30d");
  });

  it("a domain that is not a URL, or plain http in production, fails the origins", () => {
    expect(byKey(webChannelChecks(FACTS, { ...ENV, STOREFRONT_URLS: "www.rubilens.com" }))["web.origins"].ok).toBe(false);
    expect(byKey(webChannelChecks(FACTS, { ...ENV, STOREFRONT_URLS: "http://www.rubilens.com" }))["web.origins"].ok).toBe(false);
    expect(byKey(webChannelChecks(FACTS, { ...ENV, NODE_ENV: "development", STOREFRONT_URLS: "http://localhost:5198" }))["web.origins"].ok).toBe(true);
  });

  it("a brand with a typo, or for a domain this backend does not serve, fails the brand", () => {
    const typo = byKey(webChannelChecks(FACTS, { ...ENV, STOREFRONT_BRANDS: "https://www.rubilens.com|RUBI LENS|blue" }))["web.brand"];
    expect(typo).toMatchObject({ ok: false, detail: "bad_primary:https://www.rubilens.com" });
    const orphan = byKey(webChannelChecks(FACTS, { ...ENV, STOREFRONT_URLS: "", STOREFRONT_BRANDS: "https://www.rubilens.com|RUBI LENS" }))["web.brand"];
    expect(orphan).toMatchObject({ ok: false, detail: "not_listed:https://www.rubilens.com" });
  });

  it("a single-domain store has no brand item at all", () => {
    expect(byKey(webChannelChecks(FACTS, { NODE_ENV: "production", STOREFRONT_URL: "https://www.rubilens.com" } as NodeJS.ProcessEnv))["web.brand"]).toBeUndefined();
  });

  it("no key, no card provider or no shipping option each fail on their own", () => {
    const c = byKey(webChannelChecks({ ...FACTS, publishableKeys: 0, webProducts: 0, regionProviders: ["pp_system_default"], shippingOptions: 0 }, ENV));
    expect([c["web.publishable_key"].ok, c["web.catalog"].ok, c["web.payment_provider"].ok, c["web.shipping"].ok]).toEqual([false, false, false, false]);
    // Outside production the manual provider is how test orders are paid.
    expect(byKey(webChannelChecks({ ...FACTS, regionProviders: ["pp_system_default"] }, { ...ENV, NODE_ENV: "development" }))["web.payment_provider"].ok).toBe(true);
  });

  it("what could not be read is left out, never shown as failing", () => {
    const c = byKey(webChannelChecks({ publishableKeys: null, webProducts: null, regionProviders: null, shippingOptions: null, lastWebOrder: undefined, webOrders30d: null }, ENV));
    expect(Object.keys(c).sort()).toEqual(["web.brand", "web.origins"]);
  });

  it("no web order yet is information, not a failure", () => {
    expect(byKey(webChannelChecks({ ...FACTS, lastWebOrder: null, webOrders30d: 0 }, ENV))["web.last_order"]).toEqual({ key: "web.last_order", ok: true, detail: "0" });
  });
});

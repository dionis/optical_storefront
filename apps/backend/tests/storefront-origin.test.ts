import {
  allowedStorefrontOrigin,
  defaultStorefrontOrigin,
  normalizeOrigin,
  orderStorefrontOrigin,
  requestStorefrontOrigin,
  storefrontOrigin,
  storefrontOrigins,
  withStorefrontOrigin,
} from "../src/lib/storefront-origin";
import { captureCartOrigin, storefrontOriginScope } from "../src/lib/storefront-origin-http";

const ENV = { STOREFRONT_URL: "https://opticaelrancho.com/", STOREFRONT_URLS: "https://www.rubilens.com, https://rubilens.com/ ,not a url" } as NodeJS.ProcessEnv;

describe("storefront origins — the list", () => {
  it("default first, extras normalized, junk dropped", () => {
    expect(defaultStorefrontOrigin(ENV)).toBe("https://opticaelrancho.com");
    expect(storefrontOrigins(ENV)).toEqual(["https://opticaelrancho.com", "https://www.rubilens.com", "https://rubilens.com"]);
  });
  it("only listed origins are accepted, whatever their path or case", () => {
    expect(allowedStorefrontOrigin("https://WWW.rubilens.com/checkout?x=1", ENV)).toBe("https://www.rubilens.com");
    expect(allowedStorefrontOrigin("https://evil.example", ENV)).toBeNull();
    expect(allowedStorefrontOrigin("javascript:alert(1)", ENV)).toBeNull();
    expect(normalizeOrigin(undefined)).toBeNull();
  });
  it("without STOREFRONT_URLS there is only the default", () => {
    expect(storefrontOrigins({ STOREFRONT_URL: "https://a.example" } as NodeJS.ProcessEnv)).toEqual(["https://a.example"]);
  });
});

describe("storefront origins — scoped links", () => {
  const saved = { ...process.env };
  beforeEach(() => Object.assign(process.env, ENV));
  afterEach(() => {
    process.env = { ...saved };
  });

  it("inside a scope links use that storefront; outside, the default", async () => {
    expect(storefrontOrigin()).toBe("https://opticaelrancho.com");
    const inside = await withStorefrontOrigin("https://www.rubilens.com", async () => {
      await new Promise((r) => setTimeout(r, 1));
      return storefrontOrigin();
    });
    expect(inside).toBe("https://www.rubilens.com");
    expect(storefrontOrigin()).toBe("https://opticaelrancho.com");
  });
  it("an unknown origin never becomes a link", () => {
    expect(withStorefrontOrigin("https://evil.example", () => storefrontOrigin())).toBe("https://opticaelrancho.com");
  });
  it("request headers: Origin first, Referer as fallback", () => {
    expect(requestStorefrontOrigin({ origin: "https://www.rubilens.com" })).toBe("https://www.rubilens.com");
    expect(requestStorefrontOrigin({ referer: "https://www.rubilens.com/my-orders" })).toBe("https://www.rubilens.com");
    expect(requestStorefrontOrigin({ origin: "https://evil.example" })).toBeNull();
  });
  it("an order's storefront comes from its metadata", () => {
    expect(orderStorefrontOrigin({ storefront_origin: "https://www.rubilens.com" })).toBe("https://www.rubilens.com");
    expect(orderStorefrontOrigin({ storefront_origin: "https://evil.example" })).toBeNull();
    expect(orderStorefrontOrigin(null)).toBeNull();
  });
  it("the /store middleware scopes the rest of the request", () => {
    let seen = "";
    storefrontOriginScope({ headers: { origin: "https://www.rubilens.com" } } as never, {} as never, () => {
      seen = storefrontOrigin();
    });
    expect(seen).toBe("https://www.rubilens.com");
  });
});

describe("captureCartOrigin — the cart remembers its storefront", () => {
  const saved = { ...process.env };
  beforeEach(() => Object.assign(process.env, ENV));
  afterEach(() => {
    process.env = { ...saved };
  });

  const cartModule = (metadata: Record<string, unknown> | null = { notify_email: true }, completed_at: string | null = null) => ({
    retrieveCart: jest.fn(async () => ({ id: "cart_1", metadata, completed_at })),
    updateCarts: jest.fn(async () => []),
  });
  const run = async (url: string, body: unknown, carts = cartModule(), origin = "https://www.rubilens.com") => {
    const req = {
      originalUrl: url,
      headers: { origin },
      body,
      scope: { resolve: (k: string) => (k === "logger" ? { warn: jest.fn() } : carts) },
    };
    const next = jest.fn();
    await captureCartOrigin(req as never, {} as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    return { req, carts };
  };

  it("cart creation: into the body", async () => {
    const { req, carts } = await run("/store/carts", { region_id: "reg_1" });
    expect((req.body as { metadata: unknown }).metadata).toEqual({ storefront_origin: "https://www.rubilens.com" });
    expect(carts.retrieveCart).not.toHaveBeenCalled();
  });
  it("update that replaces metadata: the key travels with it", async () => {
    const { req, carts } = await run("/store/carts/cart_1", { metadata: { notify_email: true } });
    expect((req.body as { metadata: unknown }).metadata).toEqual({ notify_email: true, storefront_origin: "https://www.rubilens.com" });
    expect(carts.updateCarts).not.toHaveBeenCalled();
  });
  it("complete: merged into the cart's metadata before the order is created", async () => {
    const { carts } = await run("/store/carts/cart_1/complete", undefined);
    expect(carts.updateCarts).toHaveBeenCalledWith("cart_1", { metadata: { notify_email: true, storefront_origin: "https://www.rubilens.com" } });
  });
  it("line items: the line's own metadata is left alone", async () => {
    const body = { variant_id: "v", quantity: 1, metadata: { x: 1 } };
    const { carts } = await run("/store/carts/cart_1/line-items", body);
    expect(body.metadata).toEqual({ x: 1 });
    expect(carts.updateCarts).toHaveBeenCalled();
  });
  it("no write when already recorded, when completed, or for a foreign origin", async () => {
    expect((await run("/store/carts/cart_1/complete", undefined, cartModule({ storefront_origin: "https://www.rubilens.com" }))).carts.updateCarts).not.toHaveBeenCalled();
    expect((await run("/store/carts/cart_1/complete", undefined, cartModule({}, "2026-11-08"))).carts.updateCarts).not.toHaveBeenCalled();
    const foreign = await run("/store/carts/cart_1/complete", undefined, cartModule(), "https://evil.example");
    expect(foreign.carts.retrieveCart).not.toHaveBeenCalled();
  });
  it("a failure never blocks the purchase", async () => {
    const broken = { retrieveCart: jest.fn(async () => { throw new Error("db down"); }), updateCarts: jest.fn() };
    await run("/store/carts/cart_1/complete", undefined, broken as never);
  });
});

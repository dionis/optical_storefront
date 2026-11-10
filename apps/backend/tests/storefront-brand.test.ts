import { withStorefrontOrigin } from "../src/lib/storefront-origin";
import { ownerBrand, parseStorefrontBrands, setTenantOverlay, storefrontBrand, storefrontBrandName, tenant } from "../src/lib/tenant";
import { publicTenantProfile, type TenantProfileView } from "../src/lib/tenant-profile";

// One backend, two faces (docs/TIENDA-ONLINE-UNIFICADA.md): the stores and
// their panel carry the deployment's brand; the web shop on another domain
// carries its own in the emails and SMS of ITS orders, and nowhere else.
const ENV = {
  STORE_NAME: "Óptica El Rancho",
  STOREFRONT_URL: "https://opticaelrancho.com",
  STOREFRONT_URLS: "https://www.rubilens.com,https://rubilens.com",
  STOREFRONT_BRANDS: "https://www.rubilens.com|RUBI LENS|#0B2F66|#b8921e||RUBI LENS <pedidos@opticaelrancho.com>; https://rubilens.com/ | RUBI LENS",
} as NodeJS.ProcessEnv;

describe("parseStorefrontBrands", () => {
  it("reads origin, name, colours, logo and sender; empty fields keep the default", () => {
    const { brands, problems } = parseStorefrontBrands(ENV.STOREFRONT_BRANDS);
    expect(problems).toEqual([]);
    expect(brands).toEqual([
      { origin: "https://www.rubilens.com", name: "RUBI LENS", primary: "#0b2f66", accent: "#b8921e", logoUrl: null, from: "RUBI LENS <pedidos@opticaelrancho.com>" },
      { origin: "https://rubilens.com", name: "RUBI LENS", primary: null, accent: null, logoUrl: null, from: null },
    ]);
  });
  it("drops an entry without a usable origin or a name, and reports it", () => {
    const { brands, problems } = parseStorefrontBrands("not a url|X; https://a.example| ; https://b.example|B|red||http://b.example/logo.png; https://b.example|Again");
    expect(brands.map((b) => b.origin)).toEqual(["https://b.example"]);
    expect(brands[0]).toMatchObject({ name: "B", primary: null, logoUrl: null });
    expect(problems).toEqual(["bad_origin:not a url", "no_name:https://a.example", "bad_primary:https://b.example", "bad_logo:https://b.example", "duplicate:https://b.example"]);
  });
  it("nothing configured is nothing", () => {
    expect(parseStorefrontBrands(undefined)).toEqual({ brands: [], problems: [] });
    expect(parseStorefrontBrands(" ; ")).toEqual({ brands: [], problems: [] });
  });
});

describe("tenant() inside another storefront's scope", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    Object.assign(process.env, ENV);
    setTenantOverlay({ display_name: "Óptica El Rancho", brand: { primary: "#116633", accent: "#aa2200", logo_url: "https://cdn.example/rancho.png" } });
  });
  afterEach(() => {
    process.env = { ...saved };
    setTenantOverlay({});
  });

  it("outside any scope everything is the deployment's (the till, receipts, staff emails)", () => {
    expect(storefrontBrand()).toBeNull();
    expect(tenant().name).toBe("Óptica El Rancho");
    expect(ownerBrand()).toEqual({ primary: "#116633", accent: "#aa2200", logo_url: "https://cdn.example/rancho.png" });
  });

  it("a web order's emails and SMS carry the web shop's name, colours and logo", () => {
    withStorefrontOrigin("https://www.rubilens.com", () => {
      const t = tenant();
      expect(t.name).toBe("RUBI LENS");
      expect(t.smsPrefix).toBe("RUBI LENS");
      expect(t.storefrontUrl).toBe("https://www.rubilens.com");
      expect(t.brand).toEqual({ emailPrimary: "#0b2f66", emailAccent: "#b8921e" });
      // Never the stores' panel brand: its own colours and the logo its site serves.
      expect(ownerBrand()).toEqual({ primary: "#0b2f66", accent: "#b8921e", logo_url: "https://www.rubilens.com/logo-oficial.png" });
      expect(storefrontBrand()?.from).toBe("RUBI LENS <pedidos@opticaelrancho.com>");
    });
  });

  it("a domain that is listed but has no brand keeps the deployment's", () => {
    process.env.STOREFRONT_URLS = "https://www.rubilens.com,https://otra.example";
    withStorefrontOrigin("https://otra.example", () => {
      expect(storefrontBrand()).toBeNull();
      expect(tenant().name).toBe("Óptica El Rancho");
    });
  });

  it("a brand for a domain that is not in STOREFRONT_URLS is never reached", () => {
    process.env.STOREFRONT_URLS = "";
    withStorefrontOrigin("https://www.rubilens.com", () => expect(tenant().name).toBe("Óptica El Rancho"));
  });

  it("names the shop of an order's origin for the panel", () => {
    expect(storefrontBrandName("https://www.rubilens.com/checkout")).toBe("RUBI LENS");
    expect(storefrontBrandName("https://opticaelrancho.com")).toBeNull();
    expect(storefrontBrandName(null)).toBeNull();
  });

  it("the public profile does not repaint the web shop with the stores' brand", () => {
    const view = { support_phone: null, whatsapp: null, social: {}, pickup: null, brand: { primary: "#116633", accent: "#aa2200", logo_url: null, logo_mark_url: null } } as unknown as TenantProfileView;
    expect(publicTenantProfile(view).brand).not.toBeNull();
    withStorefrontOrigin("https://www.rubilens.com", () => {
      const pub = publicTenantProfile(view);
      expect(pub.brand).toBeNull();
      expect(pub.name).toBe("RUBI LENS");
    });
  });
});

// The whole point, end to end on the real template: the same order renders as
// the web shop inside its scope and as the stores outside it.
describe("order confirmation email per storefront", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    Object.assign(process.env, ENV);
    setTenantOverlay({ display_name: "Óptica El Rancho", brand: { primary: "#116633", accent: "#aa2200", logo_url: "https://cdn.example/rancho.png" } });
  });
  afterEach(() => {
    process.env = { ...saved };
    setTenantOverlay({});
  });

  const order = {
    id: "order_01",
    display_id: 42,
    email: "shopper@example.com",
    currency_code: "usd",
    created_at: "2026-08-05T15:00:00.000Z",
    subtotal: 129,
    shipping_total: 28,
    tax_total: 0,
    discount_total: 0,
    total: 157,
    items: [{ title: "GR 826", product_title: "GR 826", variant_title: "Gold", quantity: 1, unit_price: 129, total: 129, metadata: { lens_config: { design_code: "sv" } } }],
    shipping_address: { first_name: "Ana", last_name: "Pérez", address_1: "Calle 1", city: "Katy" },
  };

  it("bought on the web shop: its name, its logo, its links — nothing of the stores", async () => {
    const { renderCustomerOrderConfirmation } = await import("../src/lib/email/order-confirmation");
    const mail = withStorefrontOrigin("https://www.rubilens.com", () => renderCustomerOrderConfirmation(order as never, "es"));
    expect(mail.html).toContain("RUBI LENS");
    expect(mail.html).toContain("https://www.rubilens.com/logo-oficial.png");
    expect(mail.html).toContain("https://www.rubilens.com");
    expect(mail.subject + mail.html).not.toContain("El Rancho");
    expect(mail.html).not.toContain("cdn.example/rancho.png");
    expect(mail.html.toLowerCase()).not.toContain("#116633");
  });

  it("sold by the stores: the deployment's brand, with the owner's logo and colours", async () => {
    const { renderCustomerOrderConfirmation } = await import("../src/lib/email/order-confirmation");
    const mail = renderCustomerOrderConfirmation(order as never, "es");
    expect(mail.html).toContain("Óptica El Rancho");
    expect(mail.html).toContain("https://cdn.example/rancho.png");
    expect(mail.html.toLowerCase()).toContain("#116633");
    expect(mail.subject + mail.html).not.toContain("RUBI LENS");
  });
});

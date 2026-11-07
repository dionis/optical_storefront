/**
 * The owner-edited tenant profile: what the panel may send, how it overrides
 * the deployment's identity, and the brand-dependent bits of emails and SMS.
 * No database: the pure parts only.
 */
import { cleanTenantProfileInput, publicTenantProfile, toView } from "../src/lib/tenant-profile";
import { setTenantOverlay, tenant, tenantHost } from "../src/lib/tenant";
import { renderAdminOrderSms, renderCustomerOrderSms } from "../src/lib/sms/order-sms";

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
  setTenantOverlay({});
});

describe("cleanTenantProfileInput", () => {
  it("keeps only the keys sent, trimmed, and clears with an empty string", () => {
    const r = cleanTenantProfileInput({ display_name: "  Óptica El Rancho ", legal_name: "" });
    expect(r).toEqual({ ok: true, patch: { display_name: "Óptica El Rancho", legal_name: null } });
  });

  it("refuses text that is too long instead of cutting it", () => {
    expect(cleanTenantProfileInput({ display_name: "x".repeat(81) })).toEqual({ ok: false, field: "display_name", reason: "too_long" });
  });

  it("checks phones with the shared field rules", () => {
    expect(cleanTenantProfileInput({ whatsapp: "abc" })).toMatchObject({ ok: false, field: "whatsapp", reason: "invalid_phone" });
    expect(cleanTenantProfileInput({ support_phone: "+1 832 555 0100" })).toMatchObject({ ok: true });
  });

  it("accepts known social networks with https links only", () => {
    expect(cleanTenantProfileInput({ social: { instagram: "https://instagram.com/opticaelrancho" } })).toMatchObject({ ok: true });
    expect(cleanTenantProfileInput({ social: { myspace: "https://myspace.com/x" } })).toMatchObject({ ok: false, reason: "unknown_network" });
    expect(cleanTenantProfileInput({ social: { facebook: "http://facebook.com/x" } })).toMatchObject({ ok: false, reason: "invalid_url" });
  });

  it("needs an address for an active pickup and accepts hours in the three languages", () => {
    expect(cleanTenantProfileInput({ pickup: { enabled: true } })).toMatchObject({ ok: false, field: "pickup.address", reason: "required" });
    const r = cleanTenantProfileInput({
      pickup: { address: "Fry Rd, Katy, TX 77449", hours: { es: "Lun–Sáb 9–19", en: "Mon–Sat 9–7", fr: "Lun–sam 9h–19h" } },
    });
    expect(r).toMatchObject({ ok: true, patch: { pickup: { enabled: true, address: "Fry Rd, Katy, TX 77449" } } });
    expect(cleanTenantProfileInput({ pickup: { address: "x", hours: { de: "Mo–Sa" } } })).toMatchObject({ ok: false, reason: "unknown_language" });
  });

  it("never lets the panel set the owner through the profile", () => {
    const r = cleanTenantProfileInput({ owner_user_id: "user_attacker", display_name: "X" });
    expect(r).toEqual({ ok: true, patch: { display_name: "X" } });
  });
});

describe("tenant identity layers", () => {
  it("uses the deployment's name until the owner saves one", () => {
    process.env.STORE_NAME = "Óptica El Rancho";
    expect(tenant().name).toBe("Óptica El Rancho");
    setTenantOverlay({ display_name: "El Rancho Optical" });
    expect(tenant().name).toBe("El Rancho Optical");
    expect(tenant().smsPrefix).toBe("El Rancho Optical");
    setTenantOverlay({ display_name: "   " });
    expect(tenant().name).toBe("Óptica El Rancho");
  });

  it("keeps today's email palette by default and ignores a malformed colour", () => {
    expect(tenant().brand).toEqual({ emailPrimary: "#0b2f66", emailAccent: "#b8921e" });
    process.env.TENANT_BRAND_PRIMARY = "#1D4D3A";
    process.env.TENANT_BRAND_ACCENT = "orange";
    expect(tenant().brand).toEqual({ emailPrimary: "#1d4d3a", emailAccent: "#b8921e" });
  });

  it("names email image ids after the storefront's host", () => {
    process.env.STOREFRONT_URL = "https://www.opticaelrancho.example";
    expect(tenantHost()).toBe("www.opticaelrancho.example");
  });

  it("public profile shows contact and pickup, never the owner", () => {
    const view = toView({ support_phone: "+1 832 555 0100", owner_user_id: "user_1", pickup: { enabled: false, address: "x" } });
    const pub = publicTenantProfile(view);
    expect(pub).not.toHaveProperty("owner_user_id");
    expect(pub.pickup).toBeNull();
    expect(pub.support_phone).toBe("+1 832 555 0100");
  });
});

describe("order SMS", () => {
  const order = { display_id: 42, total: 189, currency_code: "usd", email: "ana@example.com" } as never;

  it("signs with the configured optician, not a hardcoded name", () => {
    process.env.STORE_NAME = "RUBI LENS";
    expect(renderCustomerOrderSms(order, "es")).toMatch(/^RUBI LENS: /);
    process.env.STORE_NAME = "Óptica El Rancho";
    expect(renderAdminOrderSms(order, "en")).toMatch(/^Óptica El Rancho: /);
    process.env.TENANT_SMS_PREFIX = "El Rancho";
    expect(renderCustomerOrderSms(order, "es")).toMatch(/^El Rancho: /);
  });
});

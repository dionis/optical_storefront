/**
 * Tenant manifests (tenants/<slug>/tenant.json) and the rules that check them
 * (packages/shared/src/tenant.ts). Every manifest in the repo must pass, and the
 * validator must refuse what would break a build or an email.
 */
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { contrastRatio, validateTenantManifest } from "@eyewear/shared";

const TENANTS = join(__dirname, "..", "..", "..", "tenants");
const slugs = readdirSync(TENANTS).filter((d) => existsSync(join(TENANTS, d, "tenant.json")));
const load = (slug: string) => JSON.parse(readFileSync(join(TENANTS, slug, "tenant.json"), "utf8"));

describe("tenant manifests in the repo", () => {
  it("include the live store and this line's store", () => {
    expect(slugs).toEqual(expect.arrayContaining(["rubi-lens", "el-rancho"]));
  });

  it.each(slugs)("%s is valid and its slug matches its folder", (slug) => {
    const m = load(slug);
    expect(validateTenantManifest(m)).toEqual([]);
    expect(m.slug).toBe(slug);
  });
});

describe("validateTenantManifest", () => {
  const base = () => load("rubi-lens");

  it("refuses an http storefront, a path in the origin and a bad slug", () => {
    const m = base();
    m.slug = "Rubi Lens";
    m.domains.storefront = "http://www.example.com";
    m.domains.api = "https://api.example.com/v1";
    const errors = validateTenantManifest(m).join("\n");
    expect(errors).toMatch(/^slug:/m);
    expect(errors).toMatch(/^domains\.storefront:/m);
    expect(errors).toMatch(/^domains\.api:/m);
  });

  it("asks for every text in every language the store shows", () => {
    const m = base();
    m.locale.languages = ["es", "en", "fr"];
    expect(validateTenantManifest(m)).toEqual(expect.arrayContaining(["identity.tagline.fr: missing text", "seo.title.fr: missing text"]));
  });

  it("refuses a primary colour white text cannot be read on", () => {
    const m = base();
    m.brand.primary = "#f5d76e";
    expect(validateTenantManifest(m).some((e) => e.startsWith("brand.primary:") && e.includes("contrast"))).toBe(true);
  });

  it("checks time zone, currency and country codes", () => {
    const m = base();
    m.locale.timezone = "Mars/Olympus";
    m.locale.currency = "USD";
    m.locale.country = "usa";
    const fields = validateTenantManifest(m).map((e) => e.split(":")[0]);
    expect(fields).toEqual(expect.arrayContaining(["locale.timezone", "locale.currency", "locale.country"]));
  });

  it("measures contrast the WCAG way", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#01326b", "#ffffff")).toBeGreaterThan(10);
  });
});

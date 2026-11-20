/**
 * The brand registry (`catalog_brand`, docs/PRICE-MATRIX.md v2 «Marcas») —
 * PURE: the seed, the logo map, validation and the merge of the registry with
 * the catalogue. Reads and writes are in lib/catalog-brand-data.ts.
 */
import { brandSlugOf } from "./catalog-frame";
import { absoluteImageUrl } from "./image-url";

export const BRAND_KINDS = ["frame", "case"] as const;
export type BrandKind = (typeof BRAND_KINDS)[number];
export const BRAND_SOURCES = ["capri", "manual"] as const;
export type BrandSource = (typeof BRAND_SOURCES)[number];

/**
 * Catalogue slug → logo file in `apps/capri-storefront/public/brands/`
 * (`logo-<file>.png`, the flat «logoWide» logos of the owner's brand sheet).
 * EXPLICIT because the slugs differ from the files (four-you ↔ 4u, cases ↔
 * case). A slug not listed here has no logo (null) until the owner uploads one.
 */
export const BRAND_LOGO_FILES: Readonly<Record<string, string>> = {
  "di-caprio": "di-caprio",
  flexure: "flexure",
  grande: "grande",
  millennial: "millennial",
  peachtree: "peachtree",
  prorx: "prorx",
  trendy: "trendy",
  "4u": "4u",
  "four-you": "4u",
  case: "case",
  cases: "case",
};

/**
 * The logo of a catalogue slug, as the panel loads it: a path on the panel's
 * own origin (the storefront serves `/brands/…`), so nothing is prefixed.
 */
export function capriLogoOf(slug: string): string | null {
  const file = BRAND_LOGO_FILES[slug];
  return file ? `/brands/logo-${file}.png` : null;
}

/** The Capri brands seeded by the migration (CreateCatalogBrand8): name, kind, logo. */
export const CAPRI_BRAND_SEED: ReadonlyArray<{ slug: string; name: string; kind: BrandKind }> = [
  { slug: "di-caprio", name: "Di Caprio", kind: "frame" },
  { slug: "flexure", name: "Flexure", kind: "frame" },
  { slug: "millennial", name: "Millennial", kind: "frame" },
  { slug: "peachtree", name: "Peachtree", kind: "frame" },
  { slug: "4u", name: "Four You", kind: "frame" },
  { slug: "trendy", name: "Trendy", kind: "frame" },
  { slug: "simply-lite", name: "Simplylite", kind: "frame" },
  { slug: "grande", name: "Grande", kind: "frame" },
  { slug: "prorx", name: "ProRx", kind: "frame" },
  { slug: "case", name: "Cases (estuches)", kind: "case" },
];

/** `sort` of a brand nobody ordered: after the seeded Capri brands (10…100). */
export const DEFAULT_BRAND_SORT = 1000;

/** A registry row as the API returns it. */
export interface BrandRow {
  slug: string;
  name: string;
  /** Absolute URL or a path on the panel's origin (`/brands/…`); null = no logo. */
  logo_url: string | null;
  kind: BrandKind;
  source: BrandSource;
  active: boolean;
  sort: number;
}

/** A brand as the catalogue shows it: products carrying the slug. */
export interface CatalogBrandCount {
  slug: string;
  /** `metadata.brand` of one of its models; "" when none says. */
  name: string;
  /** Listed models (published + draft). */
  models: number;
  /** Models the catalogue calls cases (brand case / `metadata.kind` case). */
  cases: number;
  /** Every model was added by hand (`metadata.source = "manual"`). */
  manual: boolean;
}

export interface BrandView extends BrandRow {
  models: number;
  /** False for a brand the catalogue carries that is not in the registry yet (it is registered on read). */
  registered: boolean;
}

/** The brand a catalogue slug becomes when it is registered on read. Pure. */
export function derivedBrandRow(c: CatalogBrandCount): BrandRow {
  const seed = CAPRI_BRAND_SEED.find((b) => b.slug === c.slug);
  return {
    slug: c.slug,
    name: c.name.trim() || seed?.name || c.slug,
    logo_url: capriLogoOf(c.slug),
    kind: c.slug === "case" || c.slug === "cases" || (c.models > 0 && c.cases === c.models) ? "case" : seed?.kind ?? "frame",
    source: c.manual ? "manual" : "capri",
    active: true,
    // After the seeded Capri brands (10…100), which keep the storefront's order.
    sort: DEFAULT_BRAND_SORT,
  };
}

/**
 * The registry with the catalogue's counts: every registry row (with its
 * models), plus every catalogue slug the registry lacks (`registered: false`
 * — the loader inserts them). Logos as absolute URLs (uploads) or origin
 * paths. Sorted by `sort`, then name. Pure.
 */
export function mergeBrands(registry: readonly BrandRow[], catalogue: readonly CatalogBrandCount[]): BrandView[] {
  const counts = new Map(catalogue.map((c) => [c.slug, c]));
  const out = new Map<string, BrandView>();
  for (const r of registry) out.set(r.slug, { ...r, logo_url: absoluteImageUrl(r.logo_url), models: counts.get(r.slug)?.models ?? 0, registered: true });
  for (const c of catalogue) {
    if (!c.slug || out.has(c.slug)) continue;
    const row = derivedBrandRow(c);
    out.set(c.slug, { ...row, models: c.models, registered: false });
  }
  return [...out.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
}

const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** A logo as the panel sends it: an http(s) URL (an upload) or an origin path (`/brands/…`); "" / null clears it. */
export function cleanLogo(v: unknown): { logo: string | null } | { reason: string } {
  if (blank(v)) return { logo: null };
  if (typeof v !== "string" || v.length > 1000) return { reason: "bad_logo" };
  const s = v.trim();
  if (/^\/[A-Za-z0-9._~\-/]+$/.test(s) && !s.startsWith("//")) return { logo: s };
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? { logo: s } : { reason: "bad_logo" };
  } catch {
    return { reason: "bad_logo" };
  }
}

/**
 * `POST /admin/catalog/brands` { name, kind?, logo_url?, slug? }. The slug is
 * derived from the name when absent. Reasons: `bad_name`, `bad_kind`,
 * `bad_slug`, `bad_logo`. Pure.
 */
export function cleanNewBrand(body: Record<string, unknown>): { brand: Omit<BrandRow, "source" | "active" | "sort"> & { sort: number } } | { reason: string } {
  const name = typeof body["name"] === "string" ? body["name"].trim() : "";
  if (!name || name.length > 80) return { reason: "bad_name" };
  const kind = blank(body["kind"]) ? "frame" : body["kind"];
  if (kind !== "frame" && kind !== "case") return { reason: "bad_kind" };
  const slug = blank(body["slug"]) ? brandSlugOf(name) : String(body["slug"]).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(slug)) return { reason: "bad_slug" };
  const logo = cleanLogo(body["logo_url"]);
  if ("reason" in logo) return logo;
  const sort = blank(body["sort"]) ? DEFAULT_BRAND_SORT : Number(body["sort"]);
  if (!Number.isInteger(sort) || Math.abs(sort) > 100000) return { reason: "bad_value" };
  return { brand: { slug, name, kind, logo_url: logo.logo, sort } };
}

/**
 * `POST /admin/catalog/brands/:slug` { name?, logo_url?, active?, sort?, kind? }:
 * only the fields sent change. Reasons: `bad_name`, `bad_logo`, `bad_kind`,
 * `bad_value`, `nothing_to_change`. Pure.
 */
export function cleanBrandPatch(body: Record<string, unknown>): { patch: Partial<Pick<BrandRow, "name" | "logo_url" | "active" | "sort" | "kind">> } | { reason: string } {
  const patch: Partial<Pick<BrandRow, "name" | "logo_url" | "active" | "sort" | "kind">> = {};
  if ("name" in body) {
    const name = typeof body["name"] === "string" ? body["name"].trim() : "";
    if (!name || name.length > 80) return { reason: "bad_name" };
    patch.name = name;
  }
  if ("logo_url" in body) {
    const logo = cleanLogo(body["logo_url"]);
    if ("reason" in logo) return logo;
    patch.logo_url = logo.logo;
  }
  if ("active" in body) {
    if (typeof body["active"] !== "boolean") return { reason: "bad_value" };
    patch.active = body["active"];
  }
  if ("sort" in body) {
    const n = Number(body["sort"]);
    if (blank(body["sort"]) || !Number.isInteger(n) || Math.abs(n) > 100000) return { reason: "bad_value" };
    patch.sort = n;
  }
  if ("kind" in body) {
    if (body["kind"] !== "frame" && body["kind"] !== "case") return { reason: "bad_kind" };
    patch.kind = body["kind"];
  }
  if (!Object.keys(patch).length) return { reason: "nothing_to_change" };
  return { patch };
}

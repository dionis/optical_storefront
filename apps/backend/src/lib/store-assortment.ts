/**
 * Per-store assortment: which catalog models a store exposes for sale.
 *
 * A new store sells the whole catalog (owner's decision: opt-out). The owner
 * or a superadmin narrows it with rules (src/modules/store-assortment):
 *
 *   1. a rule on the MODEL wins;
 *   2. otherwise the rule on its BRAND (so a hidden brand also hides the models
 *      the scraper adds later);
 *   3. otherwise the model is exposed.
 *
 * Above all three sits the brand's GENERAL switch (catalog_brand.active, «Activa
 * en todas las tiendas» in Productos y precios): a brand switched off there is
 * hidden in every store, whatever its store or model rules say. The loaders
 * hand it to these pure functions as a synthetic rule of scope `chain_brand`
 * (`chainBrandRules`), so every caller that already reads the store's rules
 * — POS search, the till's `not_exposed` check, the matrix, the store catalogue
 * — enforces it without a second lookup.
 *
 * Pure functions only — reads and writes live in store-assortment-data.ts.
 */

export const ASSORTMENT_SCOPES = ["brand", "product"] as const;
/** Scope of the synthetic rule that carries a brand switched off for the whole chain (never stored in store_assortment_rule). */
export const CHAIN_BRAND_SCOPE = "chain_brand";
export type AssortmentScope = (typeof ASSORTMENT_SCOPES)[number];

export interface AssortmentRuleLike {
  scope: string;
  target: string;
  exposed: boolean;
}

/** The pseudo-brand every case belongs to when it carries no brand of its own (the scraper's own slug for Capri cases). */
export const CASE_BRAND = "case";

/**
 * Brand of a product as the scraper writes it (metadata.brand_slug, else
 * collection_slug). A case without a brand is the «case» brand's: the matrix
 * files it under «Estuches» (docs/PRICE-MATRIX.md), so its brand price, brand
 * discount and «Visible» switch must reach it too (QA v2, 7-nov-2026: a
 * brandless case sat under the header but ignored its price).
 */
export function brandOf(metadata: Record<string, unknown> | null | undefined): string {
  const m = metadata ?? {};
  const slug = String(m["brand_slug"] ?? m["collection_slug"] ?? "").trim().toLowerCase();
  return slug || (m["kind"] === "case" ? CASE_BRAND : "");
}

/** `brandOf` in SQL, for a `product` row under `alias` (filters and counts must agree with the code). */
export const brandSqlOf = (alias = "product"): string =>
  `coalesce(nullif(lower(trim(coalesce(${alias}.metadata->>'brand_slug', ${alias}.metadata->>'collection_slug', ''))), ''), case when ${alias}.metadata->>'kind' = 'case' then '${CASE_BRAND}' else '' end)`;

/** What the brand alone decides for its models (true when there is no brand rule). */
export function brandExposed(rules: AssortmentRuleLike[], brand: string): boolean {
  if (brandOffInChain(rules, brand)) return false;
  const r = brand ? rules.find((x) => x.scope === "brand" && x.target === brand) : undefined;
  return r ? r.exposed : true;
}

/** True when the brand is switched off for every store (catalog_brand.active = false). */
export function brandOffInChain(rules: AssortmentRuleLike[], brand: string): boolean {
  return Boolean(brand) && rules.some((x) => x.scope === CHAIN_BRAND_SCOPE && x.target === brand && !x.exposed);
}

/** The synthetic `chain_brand` rules for the brands switched off in the registry. Pure. */
export function chainBrandRules(inactiveSlugs: Iterable<string>): AssortmentRuleLike[] {
  return [...new Set([...inactiveSlugs].map((s) => String(s).trim().toLowerCase()).filter(Boolean))].map((target) => ({
    scope: CHAIN_BRAND_SCOPE,
    target,
    exposed: false,
  }));
}

export function isExposed(rules: AssortmentRuleLike[], product: { id: string; brand: string }): boolean {
  if (brandOffInChain(rules, product.brand)) return false;
  const own = rules.find((x) => x.scope === "product" && x.target === product.id);
  return own ? own.exposed : brandExposed(rules, product.brand);
}

/** Which rule decides a model: its own, its brand's, or none (exposed by default). */
export function exposureSource(rules: AssortmentRuleLike[], product: { id: string; brand: string }): "chain" | "product" | "brand" | "default" {
  if (brandOffInChain(rules, product.brand)) return "chain";
  if (rules.some((x) => x.scope === "product" && x.target === product.id)) return "product";
  if (product.brand && rules.some((x) => x.scope === "brand" && x.target === product.brand)) return "brand";
  return "default";
}

/** Validation of a rule write; `exposed: null` means "remove the rule". Returns a reason or null. */
export function assortmentRuleDenied(scope: unknown, target: unknown, exposed: unknown): string | null {
  if (!ASSORTMENT_SCOPES.includes(scope as AssortmentScope)) return "bad_scope";
  if (typeof target !== "string" || !target.trim() || target.length > 120) return "bad_target";
  if (exposed !== null && typeof exposed !== "boolean") return "bad_exposed";
  return null;
}

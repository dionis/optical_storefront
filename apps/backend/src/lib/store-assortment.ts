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
 * Pure functions only — reads and writes live in store-assortment-data.ts.
 */

export const ASSORTMENT_SCOPES = ["brand", "product"] as const;
export type AssortmentScope = (typeof ASSORTMENT_SCOPES)[number];

export interface AssortmentRuleLike {
  scope: string;
  target: string;
  exposed: boolean;
}

/** Brand of a product as the scraper writes it (metadata.brand_slug, else collection_slug). */
export function brandOf(metadata: Record<string, unknown> | null | undefined): string {
  const m = metadata ?? {};
  return String(m["brand_slug"] ?? m["collection_slug"] ?? "").trim().toLowerCase();
}

/** What the brand alone decides for its models (true when there is no brand rule). */
export function brandExposed(rules: AssortmentRuleLike[], brand: string): boolean {
  const r = brand ? rules.find((x) => x.scope === "brand" && x.target === brand) : undefined;
  return r ? r.exposed : true;
}

export function isExposed(rules: AssortmentRuleLike[], product: { id: string; brand: string }): boolean {
  const own = rules.find((x) => x.scope === "product" && x.target === product.id);
  return own ? own.exposed : brandExposed(rules, product.brand);
}

/** Which rule decides a model: its own, its brand's, or none (exposed by default). */
export function exposureSource(rules: AssortmentRuleLike[], product: { id: string; brand: string }): "product" | "brand" | "default" {
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

import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { upsertVariantPricesWorkflow } from "@medusajs/medusa/core-flows";
import { STORE_PRICING_MODULE } from "../modules/store-pricing";
import { recordAudit } from "./audit";
import { brandOf } from "./store-assortment";
import type StorePricingModuleService from "../modules/store-pricing/service";
import type { PriceRuleLike, RuleMode, RuleScope } from "./store-pricing";

/**
 * Reads and writes of price rules. Every write closes the open rule it replaces
 * and adds a new one — never an UPDATE of a price — so the table is the history.
 */

export interface PriceRuleRow extends PriceRuleLike {
  id: string;
  source: string | null;
  created_by: string | null;
  closed_by: string | null;
}

const svc = (c: MedusaContainer) => c.resolve<StorePricingModuleService>(STORE_PRICING_MODULE);

function toRow(r: Record<string, unknown>): PriceRuleRow {
  return {
    id: String(r.id),
    establishment_id: (r.establishment_id as string | null) ?? null,
    scope: String(r.scope),
    target: (r.target as string | null) ?? null,
    mode: String(r.mode),
    value: Number(r.value),
    valid_from: r.valid_from as string,
    valid_to: (r.valid_to as string | null) ?? null,
    source: (r.source as string | null) ?? null,
    created_by: (r.created_by as string | null) ?? null,
    closed_by: (r.closed_by as string | null) ?? null,
  };
}

/** Open rules (valid_to null) of the given stores plus every global price. */
export async function openRules(container: MedusaContainer, establishmentIds: string[]): Promise<PriceRuleRow[]> {
  // SQL `IN (…, NULL)` never matches NULL rows, so the global prices need their
  // own branch of the OR.
  const which = establishmentIds.length
    ? { $or: [{ establishment_id: establishmentIds }, { establishment_id: null }] }
    : { establishment_id: null };
  const rows = await svc(container).listStorePriceRules(
    { valid_to: null, ...which } as never,
    { take: 10000 }
  );
  return rows.map((r) => toRow(r as unknown as Record<string, unknown>));
}

/** Every rule of one store, newest first: the store's price history. */
export async function ruleHistory(container: MedusaContainer, establishmentId: string, take = 200): Promise<PriceRuleRow[]> {
  const rows = await svc(container).listStorePriceRules(
    { establishment_id: establishmentId },
    { take, order: { created_at: "DESC" } }
  );
  return rows.map((r) => toRow(r as unknown as Record<string, unknown>));
}

/**
 * Which rules replace each other: a general adjustment (percent or fixed
 * amount), a price (exact or the owner's global one) and a minimum are
 * independent. Setting a store's adjustment must never close its minimum.
 */
export const MODE_FAMILIES = {
  adjustment: ["percent", "delta"],
  price: ["override"],
  minimum: ["min"],
  /**
   * Regla de marca: una sola regla viva por (tienda, marca), sea un precio fijo
   * para la marca o un ajuste. Cambiar de una a otra cierra la anterior — si no
   * compartieran familia, quedarían las dos abiertas y la más reciente ganaría
   * en silencio.
   */
  brand: ["percent", "delta", "override"],
} as const satisfies Record<string, readonly RuleMode[]>;
export type ModeFamily = keyof typeof MODE_FAMILIES;

/**
 * Closes the open rules matching (store, scope, target, family) and, unless `next` is
 * null, opens a new one. One transaction-free sequence is fine here: the only
 * writers are owner/superadmin acting from the panel, and the worst outcome of
 * a race is two rules where the latest by valid_from wins (storeLinePrice).
 */
export async function replaceRule(
  container: MedusaContainer,
  key: { establishmentId: string | null; scope: RuleScope; target: string | null; family: ModeFamily },
  next: { mode: RuleMode; value: number; source: string } | null,
  actorId: string | null
): Promise<void> {
  const service = svc(container);
  const now = new Date();
  const open = await service.listStorePriceRules(
    { establishment_id: key.establishmentId, scope: key.scope, target: key.target, mode: [...MODE_FAMILIES[key.family]], valid_to: null } as never,
    { take: 100 }
  );
  if (open.length) {
    await service.updateStorePriceRules(open.map((r) => ({ id: r.id, valid_to: now, closed_by: actorId })) as never);
  }
  // Every price change is in the audit log (HU-15, HU-72) as well as in the
  // rule history itself, so "who changed what" has one place to look.
  await recordAudit(container, {
    actorId,
    action: "price.change",
    entity: "price_rule",
    entityId: key.target,
    establishmentId: key.establishmentId,
    before: open.length ? { scope: key.scope, rules: open.map((r) => ({ mode: r.mode, value: Number(r.value) })) } : null,
    after: next ? { scope: key.scope, mode: next.mode, value: next.value } : null,
  });
  if (next && !(MODE_FAMILIES[key.family] as readonly string[]).includes(next.mode)) {
    throw new Error(`rule mode ${next.mode} is not in the ${key.family} family`);
  }
  if (next) {
    await service.createStorePriceRules({
      establishment_id: key.establishmentId,
      scope: key.scope,
      target: key.target,
      mode: next.mode,
      value: next.value,
      valid_from: now,
      source: next.source,
      created_by: actorId,
    } as never);
  }
}

export interface ProductPrice {
  product_id: string;
  title: string;
  handle: string;
  /** Brand slug (`metadata.brand_slug`), for the per-brand price rules. */
  brand?: string;
  /**
   * USD price of the model. Prices here are per MODEL, not per colour:
   * price-sync writes the same amount on every variant of a product, and the
   * storefront and the owner's price list key prices by model too. Taken from
   * the first variant that has one; null if none does.
   */
  price: number | null;
}

export interface VariantPriceUpdate {
  variant_id: string;
  product_id: string;
  prices: Array<{ amount: number; currency_code: string }>;
}

/**
 * Writes variants' prices, creating the price set and its link for a variant
 * that has none. updateProductVariantsWorkflow cannot do that: it throws on the
 * whole batch if a single variant has no link.
 */
export async function setVariantPrices(container: MedusaContainer, updates: VariantPriceUpdate[]): Promise<void> {
  if (!updates.length) return;
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data: links } = await query.graph({
    entity: "product_variant_price_set",
    fields: ["variant_id"],
    filters: { variant_id: updates.map((u) => u.variant_id) },
  });
  await upsertVariantPricesWorkflow(container).run({
    input: {
      variantPrices: updates,
      previousVariantIds: (links as Array<{ variant_id: string }>).map((l) => l.variant_id),
    },
  });
}

/** Medusa price of products by id, for previews and (phase 2) the point of sale. */
export async function productPrices(container: MedusaContainer, productIds: string[]): Promise<ProductPrice[]> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (!ids.length) return [];
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "metadata", "variants.prices.amount", "variants.prices.currency_code"],
    filters: { id: ids },
  });
  return (data as Array<Record<string, any>>).map((p) => {
    let price: number | null = null;
    for (const v of p.variants || []) {
      const usd = (v.prices || []).find((x: { currency_code?: string }) => x.currency_code === "usd");
      if (usd) { price = Number(usd.amount); break; }
    }
    // La marca viaja con el precio porque hay reglas por marca (store-pricing.ts).
    return { product_id: p.id, title: p.title ?? "", handle: p.handle ?? "", price, brand: brandOf(p.metadata) };
  });
}

import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { STORE_PRICING_MODULE } from "../modules/store-pricing";
import { recordAudit } from "./audit";
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
  const rows = await svc(container).listPriceRules(
    { valid_to: null, ...which } as never,
    { take: 10000 }
  );
  return rows.map((r) => toRow(r as unknown as Record<string, unknown>));
}

/** Every rule of one store, newest first: the store's price history. */
export async function ruleHistory(container: MedusaContainer, establishmentId: string, take = 200): Promise<PriceRuleRow[]> {
  const rows = await svc(container).listPriceRules(
    { establishment_id: establishmentId },
    { take, order: { created_at: "DESC" } }
  );
  return rows.map((r) => toRow(r as unknown as Record<string, unknown>));
}

/**
 * Closes the open rules matching (store, scope, target) and, unless `next` is
 * null, opens a new one. One transaction-free sequence is fine here: the only
 * writers are owner/superadmin acting from the panel, and the worst outcome of
 * a race is two rules where the latest by valid_from wins (storeLinePrice).
 */
export async function replaceRule(
  container: MedusaContainer,
  key: { establishmentId: string | null; scope: RuleScope; target: string | null },
  next: { mode: RuleMode; value: number; source: string } | null,
  actorId: string | null
): Promise<void> {
  const service = svc(container);
  const now = new Date();
  const open = await service.listPriceRules(
    { establishment_id: key.establishmentId, scope: key.scope, target: key.target, valid_to: null } as never,
    { take: 100 }
  );
  if (open.length) {
    await service.updatePriceRules(open.map((r) => ({ id: r.id, valid_to: now, closed_by: actorId })) as never);
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
  if (next) {
    await service.createPriceRules({
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
  /**
   * USD price of the model. Prices here are per MODEL, not per colour:
   * price-sync writes the same amount on every variant of a product, and the
   * storefront and the owner's price list key prices by model too. Taken from
   * the first variant that has one; null if none does.
   */
  price: number | null;
}

/** Medusa price of products by id, for previews and (phase 2) the point of sale. */
export async function productPrices(container: MedusaContainer, productIds: string[]): Promise<ProductPrice[]> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (!ids.length) return [];
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "variants.prices.amount", "variants.prices.currency_code"],
    filters: { id: ids },
  });
  return (data as Array<Record<string, any>>).map((p) => {
    let price: number | null = null;
    for (const v of p.variants || []) {
      const usd = (v.prices || []).find((x: { currency_code?: string }) => x.currency_code === "usd");
      if (usd) { price = Number(usd.amount); break; }
    }
    return { product_id: p.id, title: p.title ?? "", handle: p.handle ?? "", price };
  });
}

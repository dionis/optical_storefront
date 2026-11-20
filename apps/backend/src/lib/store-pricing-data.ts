import type { IUserModuleService, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { upsertVariantPricesWorkflow } from "@medusajs/medusa/core-flows";
import { STORE_PRICING_MODULE } from "../modules/store-pricing";
import { recordAudit } from "./audit";
import { profilesByUser } from "./staff-profile-data";
import type StorePricingModuleService from "../modules/store-pricing/service";
import { globalPriceOverrides, type PriceRuleLike, type RuleMode, type RuleScope } from "./store-pricing";
import {
  clearPriceBandCache,
  normalizeModel,
  priceBandCacheStale,
  setPriceBandCache,
  toPriceBand,
  type PriceBand,
} from "./pricing";

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

/**
 * Open rules (valid_to null) of the given stores plus every global price.
 *
 * It also warms the PRICE BAND cache (see `ensurePriceBandCache`), because this
 * is the one gateway every price computation goes through — the point of sale,
 * the store catalogue, the panel's preview and price-sync all load the rules
 * before they compute anything — and `storeLinePrice` has to stay synchronous.
 */
export async function openRules(container: MedusaContainer, establishmentIds: string[]): Promise<PriceRuleRow[]> {
  // Only when it is actually stale: a warm cache must not add two queries to
  // every quote. Never throws — see `ensurePriceBandCache`.
  if (priceBandCacheStale()) await ensurePriceBandCache(container);
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

/**
 * Every rule of one store, newest first: the store's price history. With
 * `establishmentId` null, the CHAIN's rules (the master every store inherits:
 * `/admin/pricing/frames/rule` and the owner's global prices).
 */
export async function ruleHistory(container: MedusaContainer, establishmentId: string | null, take = 200): Promise<PriceRuleRow[]> {
  const rows = await svc(container).listStorePriceRules(
    { establishment_id: establishmentId },
    { take, order: { created_at: "DESC" } }
  );
  return rows.map((r) => toRow(r as unknown as Record<string, unknown>));
}

// ── History with "who, what, before → after" (HU-15) ─────────────────────────

/** Which family a stored mode belongs to; null for a mode this code does not know. */
export function familyOfMode(mode: string): ModeFamily | null {
  for (const [family, modes] of Object.entries(MODE_FAMILIES) as Array<[ModeFamily, readonly string[]]>) {
    if (modes.includes(mode)) return family;
  }
  return null;
}

export interface PriceRuleHistoryEntry extends PriceRuleRow {
  family: ModeFamily | null;
  /** The rule this one replaced (same store, scope, target and family, closed when this one opened); null = first of its kind. */
  previous_rule_id: string | null;
  previous_value: number | null;
  previous_mode: string | null;
  /** The rule that replaced this one; null while it is open, or when it was simply removed. */
  replaced_by: string | null;
}

/**
 * `replaceRule` closes the open rule and opens the next one with the SAME
 * instant, so "closed at the new rule's valid_from" is the pairing. A small
 * tolerance absorbs a clock that rounds to the millisecond on one side.
 */
export const PAIRING_TOLERANCE_MS = 2000;

const histKey = (r: PriceRuleLike) => `${r.establishment_id ?? ""}|${r.scope}|${r.target ?? ""}|${familyOfMode(r.mode) ?? r.mode}`;
const ms = (v: string | Date | null | undefined): number | null => {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

/**
 * For every rule, the one it replaced — the "before" of "before → after". PURE.
 *
 * Within one key (store, scope, target, family) a rule's predecessor is the
 * closed rule whose `valid_to` falls at its `valid_from` (±tolerance); the
 * closest one when a race left two. A closed rule with no successor was
 * removed, not replaced: `replaced_by` stays null and its `closed_by` /
 * `valid_to` say who removed it and when. Order of the input is kept.
 */
export function pairPreviousValues<T extends PriceRuleRow>(rows: readonly T[]): Array<T & PriceRuleHistoryEntry> {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = histKey(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const previousOf = new Map<string, T>();
  const successorOf = new Map<string, T>();
  for (const group of groups.values()) {
    for (const r of group) {
      const from = ms(r.valid_from);
      if (from == null) continue;
      let best: T | null = null;
      let bestGap = Infinity;
      for (const c of group) {
        if (c.id === r.id) continue;
        const to = ms(c.valid_to);
        if (to == null) continue;
        const gap = Math.abs(to - from);
        if (gap <= PAIRING_TOLERANCE_MS && gap < bestGap && !successorOf.has(c.id)) {
          best = c;
          bestGap = gap;
        }
      }
      if (best) {
        previousOf.set(r.id, best);
        successorOf.set(best.id, r);
      }
    }
  }
  return rows.map((r) => {
    const prev = previousOf.get(r.id) ?? null;
    return {
      ...r,
      family: familyOfMode(r.mode),
      previous_rule_id: prev ? prev.id : null,
      previous_value: prev ? Number(prev.value) : null,
      previous_mode: prev ? prev.mode : null,
      replaced_by: successorOf.get(r.id)?.id ?? null,
    };
  });
}

export interface PriceRuleHistoryView extends PriceRuleHistoryEntry {
  /** Who opened / closed the rule, by name (display name, else first + last, else the email's local part). */
  created_by_name: string | null;
  closed_by_name: string | null;
  /** The model a product-scoped rule is about; null for a rule on every frame / case. */
  product_title: string | null;
  product_sku: string | null;
  /** True for a chain rule (no store): the master this store inherits. */
  chain: boolean;
}

/** Display names of panel users, one query for the users and one for their profiles. */
async function peopleNames(container: MedusaContainer, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, string>();
  if (!unique.length) return out;
  const users = container.resolve<IUserModuleService>(Modules.USER);
  const [rows, profiles] = await Promise.all([
    users.listUsers({ id: unique }, { take: unique.length }).catch(() => []),
    profilesByUser(container, unique).catch(() => new Map<string, { display_name?: string | null }>()),
  ]);
  const byId = new Map(rows.map((u) => [u.id, u]));
  for (const id of unique) {
    const u = byId.get(id);
    const display = profiles.get(id)?.display_name;
    const name =
      (display && String(display).trim()) ||
      (u ? [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || String(u.email ?? "").split("@")[0] : "");
    if (name) out.set(id, name);
  }
  return out;
}

/** Title and SKU (the first colour's) of the given products, one query; empty on failure. */
async function productLabels(container: MedusaContainer, ids: string[]): Promise<Map<string, { title: string; sku: string | null }>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, { title: string; sku: string | null }>();
  if (!unique.length) return out;
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data } = await query.graph({
      entity: "product",
      fields: ["id", "title", "variants.sku"],
      filters: { id: unique },
    });
    for (const p of (data ?? []) as Array<Record<string, any>>) {
      const sku = ((p.variants ?? []) as Array<{ sku?: string | null }>).find((v) => v.sku)?.sku ?? null;
      out.set(String(p.id), { title: String(p.title ?? ""), sku });
    }
  } catch {
    return out;
  }
  return out;
}

/**
 * The history as the panel shows it: who, what and before → after, resolved
 * in THREE queries for the whole list (users, profiles, products), never one
 * per row. A name or a product that cannot be resolved stays null and the
 * panel falls back to the id.
 */
export async function enrichRuleHistory(
  container: MedusaContainer,
  rows: readonly PriceRuleRow[]
): Promise<PriceRuleHistoryView[]> {
  const paired = pairPreviousValues(rows);
  const [names, products] = await Promise.all([
    peopleNames(container, paired.flatMap((r) => [r.created_by ?? "", r.closed_by ?? ""])),
    productLabels(container, paired.map((r) => r.target ?? "")),
  ]);
  return paired.map((r) => {
    const product = r.target ? products.get(r.target) ?? null : null;
    return {
      ...r,
      created_by_name: r.created_by ? names.get(r.created_by) ?? null : null,
      closed_by_name: r.closed_by ? names.get(r.closed_by) ?? null : null,
      product_title: product ? product.title : null,
      product_sku: product ? product.sku : null,
      chain: r.establishment_id == null,
    };
  });
}

/**
 * One store's history WITH the chain's (the rules it inherits), newest first,
 * enriched. Two list queries plus the three of `enrichRuleHistory`.
 */
export async function storeRuleHistoryView(
  container: MedusaContainer,
  establishmentId: string,
  take = 200
): Promise<PriceRuleHistoryView[]> {
  const [own, chain] = await Promise.all([
    ruleHistory(container, establishmentId, take),
    ruleHistory(container, null, take).catch(() => [] as PriceRuleRow[]),
  ]);
  const all = [...own, ...chain].sort((a, b) => (ms(b.valid_from) ?? 0) - (ms(a.valid_from) ?? 0));
  return enrichRuleHistory(container, all);
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
  cost_multiple: ["cost_multiple"],
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

// ── The price band: the floor and ceiling of a converted price ──────────────

/**
 * Reads and writes of `store_price_band` (the chain's) and
 * `store_price_band_variation` (one store's own). The pure math — the
 * precedence, the adjustment itself and the validation — is in lib/pricing.ts;
 * this file only moves the rows and keeps the process cache that lets
 * `storeLinePrice` stay synchronous.
 *
 * Unlike a price rule, a band is UPDATED in place rather than closed and
 * reopened: there is one live band per scope and its history is the audit log
 * (`price.band`), which is where "who moved the floor" is actually looked up.
 */

/** A band plus who last moved it — the API's shape. */
export interface PriceBandRow extends PriceBand {
  /** The store, or null for the chain's master. */
  establishment_id: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

/** Always "chain": the master table holds exactly one live row (see its migration). */
const CHAIN_SCOPE = "chain";

function toBandRow(r: Record<string, unknown>, establishmentId: string | null): PriceBandRow {
  const band = toPriceBand(r as Partial<PriceBand>) as PriceBand;
  const at = r["updated_at"];
  return {
    ...band,
    establishment_id: establishmentId,
    updated_at: at ? new Date(String(at)).toISOString() : null,
    updated_by: (r["updated_by"] as string | null) ?? null,
  };
}

/** The chain's band, or null when the owner has not set one. Throws. */
export async function loadChainPriceBand(container: MedusaContainer): Promise<PriceBandRow | null> {
  const rows = (await svc(container).listStorePriceBands({ scope: CHAIN_SCOPE } as never, {
    take: 1,
  })) as unknown as Record<string, unknown>[];
  const live = rows.find((r) => !r["deleted_at"]);
  return live ? toBandRow(live, null) : null;
}

/**
 * Every store's own band, or one store's. Throws — the routes report it,
 * `ensurePriceBandCache` swallows it on purpose.
 *
 * One row per store at most (six stores), so reading them all is one small
 * query and the cache can answer for any store without a query per store.
 */
export async function loadStorePriceBands(
  container: MedusaContainer,
  storeId?: string | null
): Promise<PriceBandRow[]> {
  const filter = storeId ? ({ establishment_id: storeId } as never) : ({} as never);
  const rows = (await svc(container).listStorePriceBandVariations(filter, {
    take: 1000,
  })) as unknown as Record<string, unknown>[];
  return rows
    .filter((r) => !r["deleted_at"] && r["establishment_id"])
    .map((r) => toBandRow(r, String(r["establishment_id"])));
}

/** Group a flat list of variations the way the cache (and `resolvePriceBand`) reads it. */
export function indexPriceBands(rows: readonly PriceBandRow[]): Map<string, PriceBand> {
  const out = new Map<string, PriceBand>();
  for (const r of rows) {
    if (r.establishment_id) out.set(r.establishment_id, r);
  }
  return out;
}

/**
 * Warm the band cache if it is older than its TTL — the master AND every
 * store's variation, in one pass. NEVER THROWS: an un-migrated table must not
 * take a sale or a dashboard down, and the degraded answer is "no band", which
 * is the price the shop sold at before this layer existed.
 */
export async function ensurePriceBandCache(container: MedusaContainer): Promise<void> {
  try {
    const [master, variations] = await Promise.all([
      loadChainPriceBand(container),
      loadStorePriceBands(container).catch(() => [] as PriceBandRow[]),
    ]);
    setPriceBandCache(master, indexPriceBands(variations));
  } catch {
    // Leave whatever the cache had (possibly nothing) and try again after the
    // TTL. A failure never marks it loaded, so prices stay un-banded.
  }
}

/**
 * The price-book keys of the models the owner priced BY HAND, so the impact
 * preview can leave them out of the counts: the band never moves them.
 *
 * His global prices are keyed by Medusa product id and the price book by
 * normalised model name, so the bridge is the product title — the very same
 * one `price-sync` matches on, which is what keeps the preview's "285 models"
 * and the job's actual writes talking about the same 285 models.
 *
 * Best effort: with no catalogue behind it the set is empty and the preview
 * simply counts those models too, which over-states the impact rather than
 * under-stating it.
 */
export async function ownerPricedKeys(container: MedusaContainer): Promise<Set<string>> {
  try {
    const overrides = globalPriceOverrides(await openRules(container, []));
    if (!overrides.size) return new Set();
    const products = await productPrices(container, [...overrides.keys()]);
    return new Set(products.map((p) => normalizeModel(p.title)).filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Audit payload of a band — the four numbers and the two switches, nothing else. */
export function priceBandAudit(band: PriceBand | null): Record<string, unknown> | null {
  if (!band) return null;
  return {
    floor_below_cents: band.floor_below_cents,
    floor_to_cents: band.floor_to_cents,
    cap_above_cents: band.cap_above_cents,
    cap_to_cents: band.cap_to_cents,
    apply_to_cases: band.apply_to_cases,
    enabled: band.enabled,
  };
}

const bandFields = (band: PriceBand) => ({
  floor_below_cents: band.floor_below_cents,
  floor_to_cents: band.floor_to_cents,
  cap_above_cents: band.cap_above_cents,
  cap_to_cents: band.cap_to_cents,
  apply_to_cases: band.apply_to_cases,
  enabled: band.enabled,
});

/**
 * Set THE CHAIN's band, or (with `band` null) remove it so no price is
 * adjusted anywhere. Every store without a band of its own follows this one.
 *
 * A store's own variation is NOT touched either way: the owner moving the
 * chain's floor is not the owner moving a store's. Audited by the caller's
 * route with `price.band`; returns the band before and after.
 */
export async function setChainPriceBand(
  container: MedusaContainer,
  band: PriceBand | null,
  actorId: string | null
): Promise<{ row: PriceBandRow | null; before: PriceBandRow | null }> {
  const service = svc(container);
  const existing = (await service.listStorePriceBands({ scope: CHAIN_SCOPE } as never, {
    take: 1,
  })) as unknown as Record<string, unknown>[];
  const current = existing.find((r) => !r["deleted_at"]);
  const before = current ? toBandRow(current, null) : null;

  if (band === null) {
    if (current) await service.softDeleteStorePriceBands([String(current["id"])]);
    clearPriceBandCache();
    return { row: null, before };
  }
  if (current) {
    await service.updateStorePriceBands([{ id: current["id"], ...bandFields(band), updated_by: actorId }] as never);
  } else {
    await service.createStorePriceBands({ scope: CHAIN_SCOPE, ...bandFields(band), updated_by: actorId } as never);
  }
  clearPriceBandCache();
  return {
    row: { ...band, establishment_id: null, updated_at: new Date().toISOString(), updated_by: actorId },
    before,
  };
}

/**
 * Set ONE STORE's band, or (with `band` null) remove the variation so the store
 * inherits the chain's again.
 *
 * Removing is a real delete, not a band of nulls: the absence of a row IS "this
 * store follows the chain", the same thing a removed lens cell or a removed
 * cost variation means, and it is why reading back after a removal gives the
 * master's floor instead of no floor at all.
 */
export async function setStorePriceBand(
  container: MedusaContainer,
  storeId: string,
  band: PriceBand | null,
  actorId: string | null
): Promise<{ row: PriceBandRow | null; before: PriceBandRow | null }> {
  const service = svc(container);
  const existing = (await service.listStorePriceBandVariations({ establishment_id: storeId } as never, {
    take: 1,
  })) as unknown as Record<string, unknown>[];
  const current = existing.find((r) => !r["deleted_at"]);
  const before = current ? toBandRow(current, storeId) : null;

  if (band === null) {
    if (current) await service.deleteStorePriceBandVariations([String(current["id"])]);
    clearPriceBandCache();
    return { row: null, before };
  }
  if (current) {
    await service.updateStorePriceBandVariations([
      { id: current["id"], ...bandFields(band), updated_by: actorId },
    ] as never);
  } else {
    await service.createStorePriceBandVariations({
      establishment_id: storeId,
      ...bandFields(band),
      updated_by: actorId,
    } as never);
  }
  clearPriceBandCache();
  return {
    row: { ...band, establishment_id: storeId, updated_at: new Date().toISOString(), updated_by: actorId },
    before,
  };
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

/**
 * «N VECES EL COSTO» — a store's frame rule (owner, 13-nov-2026: the online
 * store sells every frame at 3 × its cost).
 *
 * The rule is ONE row (`store_price_rule`: the store, scope "frame", no
 * target, mode `cost_multiple`, value N). What it produces is written as the
 * EXACT price of each model in that store, tagged `source = "cost_multiple"`:
 * the till, the matrix, the web shop and the reports already read a store's
 * exact price, so nothing else has to learn a new kind of rule.
 *
 *   - a model with a known cost  → its price in the store is cost × N;
 *   - a model with NO cost       → no derived price: it keeps the price it
 *     would have without the rule (and is counted, so the panel can say so);
 *   - a price the owner TYPED for a model in that store is his decision and
 *     is never touched;
 *   - cases are not frames: the rule leaves them alone.
 *
 * The prices are re-derived when the rule is saved, when a frame's cost
 * changes and on the 4-hourly price sync (a new model, a new supplier list).
 */
import type { MedusaContainer } from "@medusajs/framework/types";
import { STORE_PRICING_MODULE } from "../modules/store-pricing";
import type StorePricingModuleService from "../modules/store-pricing/service";
import { recordAudit } from "./audit";
import { costRefOf, ensureFrameCostCache, frameCostCentsFor, frameCostRows, frameCostVariations, loadCatalogModels } from "./frame-cost";

export const COST_MULTIPLE_MODE = "cost_multiple";
export const COST_MULTIPLE_SOURCE = "cost_multiple";
export const MIN_COST_MULTIPLE = 1;
export const MAX_COST_MULTIPLE = 20;

/** Validation of the multiple; a reason code or null. */
export function costMultipleDenied(value: unknown): string | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= MIN_COST_MULTIPLE && n <= MAX_COST_MULTIPLE ? null : "bad_value";
}

/** cost × N, in dollars, to the cent. Pure. */
export const costMultiplePrice = (costCents: number, multiple: number): number => Math.round(costCents * multiple) / 100;

export interface CostMultipleModel {
  product_id: string;
  is_case: boolean;
  /** The model's cost in this store, in cents; null = unknown. */
  cost_cents: number | null;
}
export interface OpenOverride {
  id: string;
  target: string;
  value: number;
  source: string | null;
}
export interface CostMultiplePlan {
  /** Derived prices to write (new, or a different figure). */
  set: Array<{ product_id: string; price: number }>;
  /** Derived rows to close (replaced, or no longer derivable). */
  close: string[];
  /** Models that end up at cost × N. */
  applied: number;
  /** Frames with no known cost: left at the price they had. */
  no_cost: number;
  /** Frames whose price the owner typed: left alone. */
  kept_own: number;
}

/**
 * What to write so every frame with a cost sells at cost × `multiple`
 * (`multiple` null = the rule is gone: every derived price is closed). Pure.
 */
export function planCostMultiple(multiple: number | null, models: readonly CostMultipleModel[], overrides: readonly OpenOverride[]): CostMultiplePlan {
  const plan: CostMultiplePlan = { set: [], close: [], applied: 0, no_cost: 0, kept_own: 0 };
  const derived = new Map<string, OpenOverride[]>();
  const own = new Set<string>();
  for (const o of overrides) {
    if (o.source === COST_MULTIPLE_SOURCE) derived.set(o.target, [...(derived.get(o.target) ?? []), o]);
    else own.add(o.target);
  }
  const wanted = new Set<string>();
  if (multiple !== null) {
    for (const m of models) {
      if (m.is_case) continue;
      if (own.has(m.product_id)) { plan.kept_own += 1; continue; }
      if (m.cost_cents == null || !(m.cost_cents > 0)) { plan.no_cost += 1; continue; }
      const price = costMultiplePrice(m.cost_cents, multiple);
      wanted.add(m.product_id);
      plan.applied += 1;
      const rows = derived.get(m.product_id) ?? [];
      if (rows.length === 1 && Math.round(rows[0].value * 100) === Math.round(price * 100)) continue;
      plan.close.push(...rows.map((r) => r.id));
      plan.set.push({ product_id: m.product_id, price });
    }
  }
  // A derived price whose model lost its cost, left the catalogue, became a case or got a typed price.
  for (const [target, rows] of derived) if (!wanted.has(target)) plan.close.push(...rows.map((r) => r.id));
  return plan;
}

const svc = (c: MedusaContainer) => c.resolve<StorePricingModuleService>(STORE_PRICING_MODULE);
type Row = Record<string, unknown>;

/** The stores with a live «N × costo» rule, and their N. */
export async function costMultipleRules(container: MedusaContainer): Promise<Map<string, number>> {
  const rows = (await svc(container).listStorePriceRules({ mode: COST_MULTIPLE_MODE, scope: "frame", target: null, valid_to: null } as never, { take: 500, order: { valid_from: "ASC" } })) as unknown as Row[];
  const out = new Map<string, number>();
  for (const r of rows) if (r["establishment_id"]) out.set(String(r["establishment_id"]), Number(r["value"]));
  return out;
}

export interface CostMultipleResult {
  multiple: number | null;
  applied: number;
  no_cost: number;
  kept_own: number;
  changed: number;
}

/** Brings one store's derived prices in line with its rule (`multiple` null = remove them). */
export async function applyCostMultiple(container: MedusaContainer, storeId: string, multiple: number | null, actorId: string | null): Promise<CostMultipleResult> {
  const service = svc(container);
  await ensureFrameCostCache(container);
  const [catalog, open] = await Promise.all([
    multiple === null ? Promise.resolve([]) : loadCatalogModels(container, { drafts: true }),
    service.listStorePriceRules({ establishment_id: storeId, scope: "frame", mode: "override", valid_to: null } as never, { take: 20000 }) as unknown as Promise<Row[]>,
  ]);
  const rows = frameCostRows();
  const variations = frameCostVariations();
  const models: CostMultipleModel[] = catalog.map((m) => ({ product_id: m.product_id, is_case: m.is_case, cost_cents: frameCostCentsFor(rows, variations, costRefOf(m), storeId) }));
  const overrides: OpenOverride[] = open.filter((r) => r["target"]).map((r) => ({ id: String(r["id"]), target: String(r["target"]), value: Number(r["value"]), source: (r["source"] as string | null) ?? null }));
  const plan = planCostMultiple(multiple, models, overrides);
  const now = new Date();
  if (plan.close.length) await service.updateStorePriceRules(plan.close.map((id) => ({ id, valid_to: now, closed_by: actorId })) as never);
  if (plan.set.length) {
    await service.createStorePriceRules(
      plan.set.map((p) => ({ establishment_id: storeId, scope: "frame", target: p.product_id, mode: "override", value: p.price, valid_from: now, source: COST_MULTIPLE_SOURCE, created_by: actorId })) as never
    );
  }
  const changed = plan.set.length + plan.close.length;
  if (changed) {
    await recordAudit(container, {
      actorId,
      action: "price.change",
      entity: "price_rule",
      entityId: null,
      establishmentId: storeId,
      before: null,
      after: { mode: COST_MULTIPLE_MODE, value: multiple, prices_written: plan.set.length, prices_removed: plan.close.length - plan.set.length < 0 ? 0 : plan.close.length, no_cost: plan.no_cost, kept_own: plan.kept_own },
    });
  }
  return { multiple, applied: plan.applied, no_cost: plan.no_cost, kept_own: plan.kept_own, changed };
}

/**
 * One store, when it has the rule: after the owner CLEARS a price he had typed
 * for a frame there, the model goes back to cost × N at once instead of
 * waiting for the next pass. Never throws.
 */
export async function followCostMultiple(container: MedusaContainer, storeId: string | null, actorId: string | null): Promise<void> {
  if (!storeId) return;
  try {
    const multiple = (await costMultipleRules(container)).get(storeId);
    if (multiple !== undefined) await applyCostMultiple(container, storeId, multiple, actorId);
  } catch {
    /* the next cost write or the 4-hourly sync tries again */
  }
}

/**
 * Re-derives the prices of every store that has the rule: after a cost
 * changed, a model was added, or on the price sync. Never throws — a failure
 * here must not fail the write that triggered it.
 */
export async function reapplyCostMultiples(container: MedusaContainer): Promise<void> {
  try {
    for (const [storeId, multiple] of await costMultipleRules(container)) await applyCostMultiple(container, storeId, multiple, null);
  } catch {
    /* the next cost write or the 4-hourly sync tries again */
  }
}

let queued: ReturnType<typeof setTimeout> | null = null;

/**
 * The same, once, a moment later: a workbook import changes hundreds of costs
 * in a row and one pass at the end is what is wanted. Never blocks the write.
 */
export function queueCostMultiples(container: MedusaContainer, delayMs = 1500): void {
  if (queued) return;
  queued = setTimeout(() => {
    queued = null;
    void reapplyCostMultiples(container);
  }, delayMs);
  queued.unref?.();
}

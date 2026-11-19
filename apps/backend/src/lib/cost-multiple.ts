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
 *   - a model with a known cost  → its price in the store is cost × N + A,
 *     where A is the rule's optional fixed amount in dollars (`addend`,
 *     owner 19-nov-2026: «costo × 2.9 + $1.00»; 0 when not set);
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
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { STORE_PRICING_MODULE } from "../modules/store-pricing";
import type StorePricingModuleService from "../modules/store-pricing/service";
import { recordAudit } from "./audit";
import { costRefOf, ensureFrameCostCache, frameCostCentsFor, frameCostRows, frameCostVariations, loadCatalogModels } from "./frame-cost";

export const COST_MULTIPLE_MODE = "cost_multiple";
export const COST_MULTIPLE_SOURCE = "cost_multiple";
export const MIN_COST_MULTIPLE = 1;
export const MAX_COST_MULTIPLE = 20;

/** The fixed amount added after the multiple, in dollars (owner, 19-nov-2026: «costo × 2.9 + $1.00»). */
export const MAX_COST_ADDEND = 500;

/** Validation of the multiple; a reason code or null. */
export function costMultipleDenied(value: unknown): string | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= MIN_COST_MULTIPLE && n <= MAX_COST_MULTIPLE ? null : "bad_value";
}

/**
 * The fixed amount: empty = 0; otherwise 0…MAX_COST_ADDEND dollars with at
 * most two decimals. Anything else is rejected, never trimmed. Pure.
 */
export function costAddendDenied(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return "bad_addend";
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_COST_ADDEND) return "bad_addend";
  return Math.abs(Math.round(n * 100) - n * 100) < 1e-6 ? null : "bad_addend";
}

/** The fixed amount as a number of dollars (empty = 0). Call after `costAddendDenied`. Pure. */
export const costAddendOf = (value: unknown): number => (value === undefined || value === null || value === "" ? 0 : Math.round(Number(value) * 100) / 100);

/** cost × N + fixed amount, in dollars, to the cent. Pure. */
export const costMultiplePrice = (costCents: number, multiple: number, addend = 0): number =>
  Math.round(costCents * multiple + Math.round(addend * 100)) / 100;

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
 * What to write so every frame with a cost sells at cost × `multiple` +
 * `addend` (`multiple` null = the rule is gone: every derived price is
 * closed). Pure.
 */
export function planCostMultiple(multiple: number | null, models: readonly CostMultipleModel[], overrides: readonly OpenOverride[], addend = 0): CostMultiplePlan {
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
      const price = costMultiplePrice(m.cost_cents, multiple, addend);
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

/** A store's live rule: price = cost × multiple + addend (dollars). */
export interface CostMultipleRule {
  multiple: number;
  addend: number;
}

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

/**
 * The fixed amount of the given rule rows, by id. The column is not in the
 * ORM model (a failed `db:migrate` must not break every price read), so it is
 * read here by SQL; a database without it answers 0 for every rule, which is
 * exactly the price the rule produced before the column existed.
 */
export async function costRuleAddends(container: MedusaContainer, ruleIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!ruleIds.length) return out;
  try {
    const rows = (await pgOf(container)("store_price_rule").whereIn("id", [...ruleIds]).select("id", "addend")) as Array<{ id: string; addend: unknown }>;
    for (const r of rows) out.set(String(r.id), costAddendOf(Number(r.addend) || 0));
  } catch {
    /* un-migrated database: no fixed amounts */
  }
  return out;
}

/**
 * Writes the fixed amount on a store's OPEN «N × costo» rule (just created by
 * `replaceRule`). Throws when it cannot be written and is not 0: saving a rule
 * whose prices silently lack the dollar the owner typed is worse than a
 * visible failure.
 */
export async function setCostRuleAddend(container: MedusaContainer, storeId: string, addend: number): Promise<void> {
  try {
    await pgOf(container)("store_price_rule")
      .where({ establishment_id: storeId, scope: "frame", mode: COST_MULTIPLE_MODE })
      .whereNull("valid_to")
      .whereNull("target")
      .whereNull("deleted_at")
      .update({ addend });
  } catch (error) {
    if (addend !== 0) throw error;
  }
}

/** The stores with a live «N × costo» rule, with their N and fixed amount. */
export async function costMultipleRules(container: MedusaContainer): Promise<Map<string, CostMultipleRule>> {
  const rows = (await svc(container).listStorePriceRules({ mode: COST_MULTIPLE_MODE, scope: "frame", target: null, valid_to: null } as never, { take: 500, order: { valid_from: "ASC" } })) as unknown as Row[];
  const addends = await costRuleAddends(container, rows.map((r) => String(r["id"])));
  const out = new Map<string, CostMultipleRule>();
  for (const r of rows) {
    if (r["establishment_id"]) out.set(String(r["establishment_id"]), { multiple: Number(r["value"]), addend: addends.get(String(r["id"])) ?? 0 });
  }
  return out;
}

export interface CostMultipleResult {
  multiple: number | null;
  addend: number;
  applied: number;
  no_cost: number;
  kept_own: number;
  changed: number;
}

/** Brings one store's derived prices in line with its rule (`rule` null = remove them). */
export async function applyCostMultiple(container: MedusaContainer, storeId: string, rule: CostMultipleRule | null, actorId: string | null): Promise<CostMultipleResult> {
  const multiple = rule ? rule.multiple : null;
  const addend = rule ? rule.addend : 0;
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
  const plan = planCostMultiple(multiple, models, overrides, addend);
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
      after: { mode: COST_MULTIPLE_MODE, value: multiple, addend, prices_written: plan.set.length, prices_removed: plan.close.length - plan.set.length < 0 ? 0 : plan.close.length, no_cost: plan.no_cost, kept_own: plan.kept_own },
    });
  }
  return { multiple, addend, applied: plan.applied, no_cost: plan.no_cost, kept_own: plan.kept_own, changed };
}

/**
 * One store, when it has the rule: after the owner CLEARS a price he had typed
 * for a frame there, the model goes back to cost × N at once instead of
 * waiting for the next pass. Never throws.
 */
export async function followCostMultiple(container: MedusaContainer, storeId: string | null, actorId: string | null): Promise<void> {
  if (!storeId) return;
  try {
    const rule = (await costMultipleRules(container)).get(storeId);
    if (rule !== undefined) await applyCostMultiple(container, storeId, rule, actorId);
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
    for (const [storeId, rule] of await costMultipleRules(container)) await applyCostMultiple(container, storeId, rule, null);
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

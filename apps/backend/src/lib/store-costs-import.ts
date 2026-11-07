import { CostRuleError, isProfitTargetRule, validateCostRules, type CostRule } from "./costing";
import { parseCommissionPct } from "./sellers";
import { cleanCostItem, type CleanCostItem } from "./store-costs";

/**
 * Import of the whole «Reglas y comisiones» workbook (store costs with their
 * frequency, tax category and flags; per-sale cost rules; seller commissions
 * and the default commission). The browser reads the Excel and sends rows;
 * this file compares them with what is stored and answers a PLAN — what would
 * be created, what changes field by field (before → after), what is equal,
 * what is wrong — and the route applies exactly that plan with `apply: true`.
 * The same pattern as the price matrix import (lib/price-matrix*.ts).
 *
 * Rules of the plan, all pure and tested:
 *  - a cost row WITH an id that exists is an update (only if a field changed);
 *    WITHOUT an id (a row the owner typed into the sheet) it is a creation;
 *    an id that does not exist is an error (`cost_not_found`), never a silent
 *    creation of a duplicate;
 *  - nothing is deleted by an import: a row missing from the sheet stays as it
 *    is. To retire a cost, mark it inactive (`Activo = No`) — kept, excluded;
 *  - a store is named by its CODE in the sheet (Op1…), «—» or empty = shared;
 *  - per-sale rules are matched by id, then by (kind, match_key); the profit
 *    target is not a cost and is not imported here;
 *  - a commission row is matched by seller id, then by code; the default is
 *    one number. Any row with an error blocks the whole apply (the route
 *    answers 422 `import_has_errors`), like the matrix.
 */

export interface StoredCostItem extends CleanCostItem {
  id: string;
}

export interface ImportError {
  sheet: "costs" | "rules" | "commissions";
  row: number | null;
  reason: string;
  detail?: string;
}

export interface ImportChange {
  sheet: "costs" | "rules" | "commissions";
  op: "create" | "update";
  /** Id of the stored row (update) or null (create). */
  id: string | null;
  label: string;
  /** Changed fields: name → [before, after]. A creation lists every field with before null. */
  fields: Record<string, [unknown, unknown]>;
}

export interface ImportPlan {
  changes: ImportChange[];
  errors: ImportError[];
  unchanged: number;
  counts: { create: number; update: number; costs: number; rules: number; commissions: number };
  /** What the route writes, already validated. */
  writes: {
    costCreates: CleanCostItem[];
    costUpdates: Array<{ id: string; item: CleanCostItem }>;
    rules: CostRule[];
    defaultPct: number | null | undefined;
    sellers: Array<{ id: string; pct: number }>;
  };
}

export interface ImportInput {
  costs?: Array<Record<string, unknown>>;
  rules?: Array<Record<string, unknown>>;
  commissions?: { default_pct?: unknown; sellers?: Array<Record<string, unknown>> } | null;
}

export interface ImportContext {
  items: StoredCostItem[];
  rules: CostRule[];
  sellers: Array<{ id: string; code: string; name: string; commission_pct: number }>;
  defaultPct: number | null;
  /** Every store: code → id. */
  storeByCode: Map<string, string>;
  /** Stores the person may write (ids); shared items need null = everything. */
  writableStores: string[] | null;
}

const COST_FIELDS = ["establishment_id", "kind", "category", "tax_category", "description", "amount_cents", "frequency", "amortize_months", "starts_on", "ends_on", "vendor", "notes", "active", "per_sale", "allocation"] as const;
const RULE_FIELDS = ["label", "amount", "unit", "active", "notes"] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && !v.trim());

/** The store of a sheet row: an id, a code, or empty / «—» / "shared" for a shared cost. */
function storeOfRow(raw: unknown, ctx: ImportContext): { id: string | null } | { reason: string } {
  if (blank(raw)) return { id: null };
  const v = String(raw).trim();
  if (v === "—" || v === "-" || /^(shared|compartido|todas|all)$/i.test(v)) return { id: null };
  if ([...ctx.storeByCode.values()].includes(v)) return { id: v };
  const id = ctx.storeByCode.get(v) ?? ctx.storeByCode.get(v.toUpperCase()) ?? [...ctx.storeByCode.entries()].find(([code]) => code.toLowerCase() === v.toLowerCase())?.[1];
  return id ? { id } : { reason: "bad_store" };
}

/** The plan of an import. Pure. */
export function planRulesImport(input: ImportInput, ctx: ImportContext): ImportPlan {
  const changes: ImportChange[] = [];
  const errors: ImportError[] = [];
  let unchanged = 0;
  const writes: ImportPlan["writes"] = { costCreates: [], costUpdates: [], rules: [], defaultPct: undefined, sellers: [] };
  const known = [...ctx.storeByCode.values()];

  // ── Store costs ──
  const byId = new Map(ctx.items.map((i) => [i.id, i]));
  (input.costs ?? []).forEach((row, idx) => {
    const n = Number(row.row ?? idx + 2);
    const store = storeOfRow(row.store ?? row.establishment_id, ctx);
    if ("reason" in store) return errors.push({ sheet: "costs", row: n, reason: store.reason, detail: String(row.store ?? "") });
    if (ctx.writableStores !== null && (store.id === null || !ctx.writableStores.includes(store.id))) return errors.push({ sheet: "costs", row: n, reason: "forbidden_store" });
    const id = blank(row.id) ? null : String(row.id).trim();
    const current = id ? byId.get(id) : undefined;
    if (id && !current) return errors.push({ sheet: "costs", row: n, reason: "cost_not_found", detail: id });
    // A row keeps the stored allocation of a shared item unless the sheet says "percent" with shares.
    const allocation = row.allocation !== undefined ? row.allocation : current?.allocation ?? (store.id === null ? { method: "sales" } : null);
    // Fields the sheet leaves out (undefined) keep their stored value.
    const base: Record<string, unknown> = current
      ? { kind: current.kind, category: current.category, tax_category: current.tax_category, description: current.description, amount: current.amount_cents / 100, frequency: current.frequency, amortize_months: current.amortize_months, starts_on: current.starts_on, ends_on: current.ends_on, vendor: current.vendor, notes: current.notes, active: current.active, per_sale: current.per_sale }
      : {};
    const given = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
    const cleaned = cleanCostItem({ ...base, ...given, establishment_id: store.id, allocation }, known);
    if ("reason" in cleaned) return errors.push({ sheet: "costs", row: n, reason: cleaned.reason });
    const item = cleaned.item;
    const label = item.description || item.category;
    if (!current) {
      writes.costCreates.push(item);
      changes.push({ sheet: "costs", op: "create", id: null, label, fields: Object.fromEntries(COST_FIELDS.map((f) => [f, [null, item[f]]])) });
      return;
    }
    const fields: Record<string, [unknown, unknown]> = {};
    for (const f of COST_FIELDS) {
      const before = (current as unknown as Record<string, unknown>)[f];
      const after = (item as unknown as Record<string, unknown>)[f];
      if (!same(before, after)) fields[f] = [before ?? null, after ?? null];
    }
    if (!Object.keys(fields).length) return void unchanged++;
    writes.costUpdates.push({ id: current.id, item });
    changes.push({ sheet: "costs", op: "update", id: current.id, label, fields });
  });

  // ── Per-sale cost rules ──
  const ruleById = new Map(ctx.rules.filter((r) => r.id).map((r) => [r.id as string, r]));
  const ruleByKey = new Map(ctx.rules.map((r) => [`${r.kind}:${r.match_key}`, r]));
  (input.rules ?? []).forEach((row, idx) => {
    const n = Number(row.row ?? idx + 2);
    let rule: CostRule;
    try {
      [rule] = validateCostRules([row]);
    } catch (e) {
      return errors.push({ sheet: "rules", row: n, reason: e instanceof CostRuleError ? e.reason : "bad_rule" });
    }
    if (isProfitTargetRule(rule)) return errors.push({ sheet: "rules", row: n, reason: "not_a_cost" });
    const id = blank(row.id) ? null : String(row.id).trim();
    const current = (id && ruleById.get(id)) || ruleByKey.get(`${rule.kind}:${rule.match_key}`);
    if (id && !ruleById.get(id) && !current) return errors.push({ sheet: "rules", row: n, reason: "rule_not_found", detail: id });
    if (!current) {
      writes.rules.push({ ...rule, id: undefined });
      changes.push({ sheet: "rules", op: "create", id: null, label: rule.label, fields: Object.fromEntries(RULE_FIELDS.map((f) => [f, [null, rule[f] ?? null]])) });
      return;
    }
    const merged: CostRule = { ...rule, id: current.id, sort_order: current.sort_order, notes: row.notes === undefined ? current.notes ?? null : rule.notes };
    const fields: Record<string, [unknown, unknown]> = {};
    for (const f of RULE_FIELDS) if (!same(current[f], merged[f])) fields[f] = [current[f] ?? null, merged[f] ?? null];
    if (!Object.keys(fields).length) return void unchanged++;
    writes.rules.push(merged);
    changes.push({ sheet: "rules", op: "update", id: current.id ?? null, label: merged.label, fields });
  });

  // ── Commissions ──
  const c = input.commissions ?? null;
  if (c && c.default_pct !== undefined && !blank(c.default_pct)) {
    const pct = parseCommissionPct(c.default_pct);
    if (pct === null) errors.push({ sheet: "commissions", row: null, reason: "commission_invalid", detail: String(c.default_pct) });
    else if (pct !== ctx.defaultPct) {
      writes.defaultPct = pct;
      changes.push({ sheet: "commissions", op: "update", id: "default_commission_pct", label: "default", fields: { pct: [ctx.defaultPct, pct] } });
    } else unchanged++;
  }
  const sById = new Map(ctx.sellers.map((s) => [s.id, s]));
  const sByCode = new Map(ctx.sellers.map((s) => [s.code.toUpperCase(), s]));
  (c?.sellers ?? []).forEach((row, idx) => {
    const n = Number(row.row ?? idx + 2);
    const seller = (!blank(row.id) && sById.get(String(row.id).trim())) || (!blank(row.code) && sByCode.get(String(row.code).trim().toUpperCase())) || null;
    if (!seller) return errors.push({ sheet: "commissions", row: n, reason: "seller_not_found", detail: String(row.code ?? row.id ?? "") });
    if (blank(row.pct)) return void unchanged++;
    const pct = parseCommissionPct(row.pct);
    if (pct === null) return errors.push({ sheet: "commissions", row: n, reason: "commission_invalid" });
    if (pct === Number(seller.commission_pct)) return void unchanged++;
    writes.sellers.push({ id: seller.id, pct });
    changes.push({ sheet: "commissions", op: "update", id: seller.id, label: `${seller.name} (${seller.code})`, fields: { pct: [Number(seller.commission_pct), pct] } });
  });

  return {
    changes,
    errors,
    unchanged,
    counts: {
      create: changes.filter((x) => x.op === "create").length,
      update: changes.filter((x) => x.op === "update").length,
      costs: changes.filter((x) => x.sheet === "costs").length,
      rules: changes.filter((x) => x.sheet === "rules").length,
      commissions: changes.filter((x) => x.sheet === "commissions").length,
    },
    writes,
  };
}

/** The per-sale cost rules of the view (what is charged on each sale, not a material cost). */
export const PER_SALE_RULE_KINDS = ["order_fixed", "order_percent", "payment_fixed", "shipping"] as const;

export function isPerSaleRule(r: Pick<CostRule, "kind" | "match_key">): boolean {
  return (PER_SALE_RULE_KINDS as readonly string[]).includes(r.kind) && !isProfitTargetRule(r);
}

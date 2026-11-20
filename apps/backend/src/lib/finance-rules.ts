import type { MedusaContainer } from "@medusajs/framework/types";
import { STORE_COST_MODULE } from "../modules/store-cost";
import type StoreCostModuleService from "../modules/store-cost/service";
import { localParts } from "./alerts";
import { listCostRules, profitTargetPct } from "./costing";
import { listEstablishments } from "./establishments";
import { listSellers } from "./sellers";
import { disabledIds, loadCostToggles, loadDefaultCommissionPct } from "./store-cost-toggle";
import { isPerSaleRule, type StoredCostItem } from "./store-costs-import";
import { normalizedMonthly, taxCategoryOf, type CostItemLike } from "./store-costs";
import { monthPnl } from "./store-pnl";
import { resolveStoreSettings } from "./store-settings";
import { tenant } from "./tenant";

/**
 * The ONE read of «Productos y precios → Reglas y comisiones» (7-nov-2026):
 * store costs (fixed, variable, shared, taxes) with their monthly
 * normalisation, the per-sale cost rules with the store's «Se cobra» switch,
 * the commissions with the default, the sales-tax rate, and this month's store
 * result (contribution margin, break-even) for the indicators of the headers.
 */

/** A cost item row as stored, normalised to the shape the import plan compares (lib/store-costs-import.ts). */
export function storedItemOf(r: Record<string, unknown>): StoredCostItem {
  return {
    id: String(r.id),
    establishment_id: (r.establishment_id as string | null) ?? null,
    kind: r.kind === "variable" ? "variable" : "fixed",
    category: String(r.category ?? "other"),
    tax_category: taxCategoryOf({ tax_category: r.tax_category as string | null, category: r.category as string | null }),
    description: (r.description as string | null) ?? null,
    amount_cents: Math.round(Number(r.amount_cents) || 0),
    frequency: (String(r.frequency ?? "monthly") as CostItemLike["frequency"]),
    amortize_months: r.amortize_months == null ? null : Number(r.amortize_months),
    starts_on: String(r.starts_on ?? ""),
    ends_on: (r.ends_on as string | null) ?? null,
    vendor: (r.vendor as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    active: r.active !== false,
    per_sale: r.per_sale === true,
    allocation: (r.allocation as CostItemLike["allocation"]) ?? null,
  };
}

export async function loadStoredItems(container: MedusaContainer): Promise<StoredCostItem[]> {
  const rows = (await container.resolve<StoreCostModuleService>(STORE_COST_MODULE).listCostItems({}, { take: 5000, order: { starts_on: "DESC" } })) as unknown as Array<Record<string, unknown>>;
  return rows.filter((r) => !r.deleted_at).map(storedItemOf);
}

export async function financeRules(container: MedusaContainer, storeId: string | null, storeIds: string[] | null) {
  const month = localParts(new Date(), tenant().timezone).date.slice(0, 7);
  const [stores, items, rules, toggles, sellers, defaultPct, settings, pnl] = await Promise.all([
    listEstablishments(container),
    loadStoredItems(container),
    listCostRules(container),
    loadCostToggles(container, storeId),
    listSellers(container).catch(() => []),
    loadDefaultCommissionPct(container),
    resolveStoreSettings(container),
    monthPnl(container, month, storeIds),
  ]);
  const salesCount: Record<string, number> = Object.fromEntries(pnl.stores.map((s) => [s.establishment_id, s.sales_count]));
  const chainSales = pnl.stores.reduce((a, s) => a + s.sales_count, 0);
  const visible = items.filter((it) => (storeIds === null ? true : it.establishment_id !== null && storeIds.includes(it.establishment_id)));
  const off = new Set(disabledIds(storeId, toggles, "rule"));
  return {
    month,
    stores: stores.map((s) => ({ id: s.id, code: s.code, name: s.name, color: s.color ?? null, is_active: s.is_active, kind: s.kind })),
    sales_count: salesCount,
    items: visible.map((it) => ({
      ...it,
      amount: it.amount_cents / 100,
      // The «Mensual» column: what the frequency is worth in an average month;
      // a per-sale item × this month's sales of its store (of the chain when shared).
      monthly: normalizedMonthly(it, it.per_sale ? (it.establishment_id ? salesCount[it.establishment_id] ?? 0 : chainSales) : null) / 100,
      // Who it charged THIS month and how much (the ledger's split of a shared
      // item; a per-sale item × each store's sales). Empty = nothing this month
      // (off, outside its dates, or no sales yet).
      charged: pnl.item_charges[it.id] ?? [],
    })),
    rules: rules.filter(isPerSaleRule).map((r) => {
      const id = r.id ?? `${r.kind}:${r.match_key}`;
      return { ...r, id, enabled: r.active && !off.has(id) && !off.has(`${r.kind}:${r.match_key}`) };
    }),
    commissions: {
      default_pct: defaultPct,
      sellers: sellers.map((s) => ({ id: s.id, code: s.code, name: s.name, pct: Number(s.commission_pct) || 0, active: s.active !== false, establishment_id: s.establishment_id ?? null })),
    },
    taxes: { rate_pct: Math.round(settings.frame_tax_rate * 10000) / 100, source: settings.source },
    profit_target_pct: profitTargetPct(rules),
    pnl: { month, total: pnl.total, stores: pnl.stores },
  };
}

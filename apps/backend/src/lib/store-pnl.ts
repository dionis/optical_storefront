import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { STORE_COST_MODULE } from "../modules/store-cost";
import type StoreCostModuleService from "../modules/store-cost/service";
import { localParts } from "./alerts";
import { computeCostSheet, listCostRules, lineGroup, type CostOrderLike } from "./costing";
import { listEstablishments } from "./establishments";
import { loadProductMetadata } from "./frame-specs";
import { profilesByUser } from "./staff-profile-data";
import { allocateShared, computePnl, monthlyCharge, type CostItemLike, type Pnl } from "./store-costs";
import { tenant } from "./tenant";

/**
 * The monthly result of each store (HU-96) and what goes with it: seller
 * commissions (HU-34) and the settlement with family, partner or consignment
 * stores (HU-33). Till sales only; the web has its own cost sheets in Costs.
 *
 *  net sales      sale_fact totals minus sales tax
 *  cost of goods  the owner's cost rules (Costs tab: frame by brand, lens
 *                 design/material/treatments), "material" lines only
 *  payment fees   the fee recorded with each payment at the time
 *  commissions    each seller's net sales × their commission % (profile)
 *  costs          the store's fixed and variable items of the month, plus
 *                 its share of the shared ones
 */

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

export interface StorePnl extends Pnl {
  establishment_id: string;
  code: string;
  name: string;
  kind: string;
  sales_count: number;
  settlement: { pct: number; store_share: number; owner_share: number } | null;
}

export interface MonthPnl {
  month: string;
  stores: StorePnl[];
  total: Pnl;
  sellers: Array<{ seller_id: string | null; seller_code: string | null; net_sales: number; pct: number | null; commission: number }>;
  cost_rules_missing: boolean;
}

export async function monthPnl(container: MedusaContainer, month: string, storeIds: string[] | null): Promise<MonthPnl> {
  const pg = pgOf(container);
  const tz = tenant().timezone;
  const allStores = (await listEstablishments(container)).filter((s) => storeIds === null || storeIds.includes(s.id));
  const ids = allStores.map((s) => s.id);

  const facts = (await pg("sale_fact")
    .whereNull("deleted_at")
    .where("status", "active")
    .where("channel", "pos")
    .whereIn("establishment_id", ids.length ? ids : ["-"])
    .where("sold_date_local", "like", `${month}-%`)
    .select("order_id", "establishment_id", "seller_id", "seller_code", "product_id", "sku", "qty", "total_cents", "tax_cents", "lens_design", "lens_material", "lens_photo", "lens_ar")) as Array<Record<string, unknown>>;

  // Cost of goods with the owner's rules, one sheet per sale.
  const rules = await listCostRules(container);
  const meta = await loadProductMetadata(pg, [...new Set(facts.map((f) => String(f.product_id ?? "")).filter(Boolean))]);
  const byOrder = new Map<string, Array<Record<string, unknown>>>();
  for (const f of facts) byOrder.set(String(f.order_id), [...(byOrder.get(String(f.order_id)) ?? []), f]);
  const cogsByStore = new Map<string, number>();
  for (const lines of byOrder.values()) {
    const order: CostOrderLike = {
      total: lines.reduce((s, l) => s + Number(l.total_cents), 0) / 100,
      tax_total: lines.reduce((s, l) => s + Number(l.tax_cents), 0) / 100,
      paid: true,
      items: lines.map((l) => {
        const m = meta.get(String(l.product_id ?? "")) ?? {};
        return {
          quantity: Number(l.qty),
          sku: (l.sku as string | null) ?? null,
          brand_slug: (m.brand_slug as string | undefined) ?? (m.collection_slug as string | undefined) ?? null,
          lens: l.lens_design ? { design_code: l.lens_design as string, material_code: (l.lens_material as string | null) ?? null, photo_code: (l.lens_photo as string | null) ?? null, ar_code: (l.lens_ar as string | null) ?? null } : null,
        };
      }),
    };
    const sheet = computeCostSheet(order, rules, null, null, null);
    const materials = sheet.lines.filter((l) => lineGroup(l) === "material").reduce((s, l) => s + Math.round(Number(l.subtotal) * 100), 0);
    const store = String(lines[0].establishment_id);
    cogsByStore.set(store, (cogsByStore.get(store) ?? 0) + materials);
  }

  const netByStore = new Map<string, number>();
  const countByStore = new Map<string, Set<string>>();
  const sellerNet = new Map<string, { seller_id: string | null; seller_code: string | null; net: number; store: string }[]>();
  for (const f of facts) {
    const store = String(f.establishment_id);
    const net = Number(f.total_cents) - Number(f.tax_cents);
    netByStore.set(store, (netByStore.get(store) ?? 0) + net);
    countByStore.set(store, (countByStore.get(store) ?? new Set()).add(String(f.order_id)));
    const key = String(f.seller_id ?? "-");
    sellerNet.set(key, [...(sellerNet.get(key) ?? []), { seller_id: (f.seller_id as string | null) ?? null, seller_code: (f.seller_code as string | null) ?? null, net, store }]);
  }

  // Payment fees recorded in the month (local), by store.
  const monthStart = new Date(`${month}-01T00:00:00Z`);
  const from = new Date(monthStart.getTime() - 2 * 86400_000);
  const to = new Date(monthStart.getTime() + 33 * 86400_000);
  const pays = (await pg("pos_sale_payment").whereNull("deleted_at").whereIn("establishment_id", ids.length ? ids : ["-"]).whereBetween("created_at", [from, to]).select("establishment_id", "fee_cents", "created_at")) as Array<Record<string, unknown>>;
  const feesByStore = new Map<string, number>();
  for (const p of pays) {
    if (!localParts(new Date(p.created_at as string), tz).date.startsWith(month)) continue;
    const s = String(p.establishment_id);
    feesByStore.set(s, (feesByStore.get(s) ?? 0) + Number(p.fee_cents ?? 0));
  }

  // Seller commissions from each profile's %.
  const sellerIds = [...sellerNet.keys()].filter((k) => k !== "-");
  const profiles = await profilesByUser(container, sellerIds);
  const commissionByStore = new Map<string, number>();
  const sellers = [...sellerNet.entries()].map(([key, rows]) => {
    const pct = key === "-" ? null : profiles.get(key)?.commission_pct ?? null;
    let commission = 0;
    for (const r of rows) {
      const c = pct ? Math.round((r.net * pct) / 100) : 0;
      commission += c;
      commissionByStore.set(r.store, (commissionByStore.get(r.store) ?? 0) + c);
    }
    const net = rows.reduce((s, r) => s + r.net, 0);
    return { seller_id: rows[0].seller_id, seller_code: rows[0].seller_code, net_sales: net / 100, pct, commission: commission / 100 };
  });

  // Cost items: the store's own, and its share of the shared ones.
  const items = (await container.resolve<StoreCostModuleService>(STORE_COST_MODULE).listCostItems({}, { take: 5000 })) as unknown as Array<CostItemLike & { kind: "fixed" | "variable" }>;
  const fixed = new Map<string, number>();
  const variable = new Map<string, number>();
  const shared = new Map<string, number>();
  for (const it of items) {
    const charge = monthlyCharge(it, month);
    if (!charge) continue;
    if (it.establishment_id) {
      if (!ids.includes(it.establishment_id)) continue;
      const m = it.kind === "fixed" ? fixed : variable;
      m.set(it.establishment_id, (m.get(it.establishment_id) ?? 0) + charge);
    } else {
      // Shared among every active store (not only those in view), so a filtered view shows the same share.
      const active = (await listEstablishments(container)).filter((s) => s.is_active).map((s) => s.id);
      for (const [store, part] of allocateShared(charge, it.allocation, active, netByStore)) {
        if (ids.includes(store)) shared.set(store, (shared.get(store) ?? 0) + part);
      }
    }
  }

  const c = (v: number) => v / 100;
  const stores: StorePnl[] = allStores.map((s) => {
    const p = computePnl({
      net_sales: netByStore.get(s.id) ?? 0,
      cogs: cogsByStore.get(s.id) ?? 0,
      payment_fees: feesByStore.get(s.id) ?? 0,
      commissions: commissionByStore.get(s.id) ?? 0,
      variable_manual: variable.get(s.id) ?? 0,
      fixed: fixed.get(s.id) ?? 0,
      shared: shared.get(s.id) ?? 0,
    });
    const pct = (s as { settlement_pct?: number | null }).settlement_pct ?? null;
    const net = netByStore.get(s.id) ?? 0;
    return {
      ...toDollars(p),
      establishment_id: s.id,
      code: s.code,
      name: s.name,
      kind: s.kind,
      sales_count: countByStore.get(s.id)?.size ?? 0,
      settlement: s.kind !== "own" && pct !== null ? { pct, store_share: c(Math.round((net * pct) / 100)), owner_share: c(net - Math.round((net * pct) / 100)) } : null,
    };
  });
  const sum = (k: keyof Pnl) => stores.reduce((s, x) => s + Math.round(Number(x[k]) * 100), 0);
  const total = toDollars(
    computePnl({
      net_sales: sum("net_sales"),
      cogs: sum("cogs"),
      payment_fees: sum("payment_fees"),
      commissions: sum("commissions"),
      variable_manual: sum("variable_manual"),
      fixed: sum("fixed"),
      shared: sum("shared"),
    })
  );
  return { month, stores, total, sellers, cost_rules_missing: rules.every((r) => !r.amount) };
}

function toDollars(p: Pnl): Pnl {
  const d = (v: number | null) => (v === null ? null : v / 100);
  return {
    net_sales: p.net_sales / 100,
    cogs: p.cogs / 100,
    payment_fees: p.payment_fees / 100,
    commissions: p.commissions / 100,
    variable_manual: p.variable_manual / 100,
    fixed: p.fixed / 100,
    shared: p.shared / 100,
    variable_total: p.variable_total / 100,
    contribution: p.contribution / 100,
    contribution_pct: p.contribution_pct,
    fixed_total: p.fixed_total / 100,
    result: p.result / 100,
    break_even: d(p.break_even),
  };
}

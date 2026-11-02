import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { STORE_COST_MODULE } from "../modules/store-cost";
import type StoreCostModuleService from "../modules/store-cost/service";
import { localParts } from "./alerts";
import { computeCostSheet, listCostRules, lineGroup, type CostOrderLike } from "./costing";
import { listEstablishments } from "./establishments";
import { loadProductMetadata } from "./frame-specs";
import { listSellers } from "./sellers";
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

/** Material cost rules: the only ones that are cost of goods (the rest are deductions, percentages or the profit target). */
const MATERIAL_KINDS = new Set(["frame_brand", "frame_sku", "lens_design", "lens_material", "lens_photo", "lens_ar"]);

/** A recorded payment as the fee total reads it. */
export interface FeeRowLike {
  establishment_id: string | null;
  fee_cents: number | string | null;
  created_at: string | Date;
  /** Status of the sale the payment belongs to: a voided sale's fee is not a cost of the month. */
  sale_status?: string | null;
}

/**
 * Payment fees of a month, by store, in cents. Pure.
 *
 * Two rules, and both matter:
 *  - the month is the LOCAL calendar month of the payment (the SQL window is
 *    wider on purpose, so a payment at 23:00 of the last day is not lost);
 *  - a VOIDED sale's fees are left out. Its sales are already out (sale_fact
 *    keeps the rows marked `voided` and every report filters them), so
 *    charging the fee would book a cost against revenue that was reversed —
 *    lib/sales-insights.ts leaves them out too, and the two screens have to
 *    answer the same number.
 */
export function sumFeesByStore(pays: readonly FeeRowLike[], month: string, tz: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of pays) {
    if (p.sale_status === "voided") continue;
    if (!localParts(new Date(p.created_at as string), tz).date.startsWith(month)) continue;
    const store = String(p.establishment_id ?? "");
    if (!store) continue;
    out.set(store, (out.get(store) ?? 0) + Math.round(Number(p.fee_cents ?? 0) || 0));
  }
  return out;
}

/** A sold line as the commission split reads it (cents). */
export interface CommissionFactLike {
  establishment_id: string | null;
  seller_id: string | null;
  seller_code: string | null;
  net: number;
}

export interface SellerCommission {
  seller_id: string | null;
  seller_code: string | null;
  net_sales: number;
  pct: number | null;
  commission: number;
}

/**
 * Seller commissions of the month from the net of each line. Pure.
 *
 * `pctOf` is the SAME precedence lib/sales-insights.ts uses — the person's
 * profile first, then their seller record — so a referral-only seller with no
 * panel user still earns in the store result, instead of earning in Ejecutivo
 * and nowhere else. Amounts in cents; the base is the NET (total − sales tax),
 * never the gross.
 */
export function commissionsOf(
  facts: readonly CommissionFactLike[],
  pctOf: (f: CommissionFactLike) => number | null
): { sellers: SellerCommission[]; byStore: Map<string, number> } {
  type Group = { seller_id: string | null; seller_code: string | null; net: number; commission: number };
  const groups = new Map<string, Group>();
  const byStore = new Map<string, number>();
  for (const f of facts) {
    // A seller is the panel user who sold; a web referral has only a code.
    const key = f.seller_id ?? (f.seller_code ? `code:${f.seller_code}` : "-");
    const group = groups.get(key) ?? { seller_id: f.seller_id ?? null, seller_code: f.seller_code ?? null, net: 0, commission: 0 };
    const pct = key === "-" ? null : pctOf(f);
    const commission = pct ? Math.round((f.net * pct) / 100) : 0;
    group.net += f.net;
    group.commission += commission;
    groups.set(key, group);
    if (commission) {
      const store = String(f.establishment_id ?? "");
      if (store) byStore.set(store, (byStore.get(store) ?? 0) + commission);
    }
  }
  const sellers = [...groups.entries()].map(([key, g]) => ({
    seller_id: g.seller_id,
    seller_code: g.seller_code,
    net_sales: g.net / 100,
    pct: key === "-" ? null : pctOf({ establishment_id: null, seller_id: g.seller_id, seller_code: g.seller_code, net: 0 }),
    commission: g.commission / 100,
  }));
  return { sellers, byStore };
}

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

/** Net till sales (total − sales tax) of a month per store, in cents — the weights of a shared cost split "by sales". */
async function netSalesByStore(pg: Knex, month: string, storeIds: string[]): Promise<Map<string, number>> {
  if (!storeIds.length) return new Map();
  const rows = (await pg("sale_fact")
    .whereNull("deleted_at")
    .where("status", "active")
    .where("channel", "pos")
    .whereIn("establishment_id", storeIds)
    .where("sold_date_local", "like", `${month}-%`)
    .groupBy("establishment_id")
    .select("establishment_id", pg.raw("SUM(total_cents - tax_cents)::bigint AS net"))) as Array<Record<string, unknown>>;
  return new Map(rows.map((r) => [String(r.establishment_id), Number(r.net)]));
}

export async function monthPnl(container: MedusaContainer, month: string, storeIds: string[] | null): Promise<MonthPnl> {
  const pg = pgOf(container);
  const tz = tenant().timezone;
  // One read of the store list per request: it is needed for the view, and
  // again for the share of every cost that is shared between stores.
  const everyStore = await listEstablishments(container);
  const activeStoreIds = everyStore.filter((s) => s.is_active).map((s) => s.id);
  const allStores = everyStore.filter((s) => storeIds === null || storeIds.includes(s.id));
  const ids = allStores.map((s) => s.id);

  const facts = (await pg("sale_fact")
    .whereNull("deleted_at")
    .where("status", "active")
    .where("channel", "pos")
    .whereIn("establishment_id", ids.length ? ids : ["-"])
    .where("sold_date_local", "like", `${month}-%`)
    .select("order_id", "establishment_id", "seller_id", "seller_code", "product_id", "sku", "qty", "total_cents", "tax_cents", "lens_design", "lens_material", "lens_photo", "lens_ar")) as Array<Record<string, unknown>>;

  // Cost of goods with the owner's rules, one sheet per sale.
  const [rules, meta] = await Promise.all([
    listCostRules(container),
    loadProductMetadata(pg, [...new Set(facts.map((f) => String(f.product_id ?? "")).filter(Boolean))]),
  ]);
  const byOrder = new Map<string, Array<Record<string, unknown>>>();
  for (const f of facts) {
    const key = String(f.order_id);
    const group = byOrder.get(key);
    if (group) group.push(f);
    else byOrder.set(key, [f]);
  }
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
  const commissionFacts: CommissionFactLike[] = [];
  for (const f of facts) {
    const store = String(f.establishment_id);
    const net = Number(f.total_cents) - Number(f.tax_cents);
    netByStore.set(store, (netByStore.get(store) ?? 0) + net);
    const seen = countByStore.get(store);
    if (seen) seen.add(String(f.order_id));
    else countByStore.set(store, new Set([String(f.order_id)]));
    commissionFacts.push({ establishment_id: store, seller_id: (f.seller_id as string | null) ?? null, seller_code: (f.seller_code as string | null) ?? null, net });
  }

  // Payment fees recorded in the month (local), by store. The window is two
  // days wider on each side so no time zone cuts a payment off; `sumFeesByStore`
  // keeps the ones whose LOCAL day falls in the month, and drops the fees of
  // voided sales (their sales are out of the month too).
  const monthStart = new Date(`${month}-01T00:00:00Z`);
  const from = new Date(monthStart.getTime() - 2 * 86400_000);
  const to = new Date(monthStart.getTime() + 33 * 86400_000);
  const pays = (await pg("pos_sale_payment as p")
    .leftJoin("pos_sale as s", "s.id", "p.sale_id")
    .whereNull("p.deleted_at")
    .whereIn("p.establishment_id", ids.length ? ids : ["-"])
    .whereBetween("p.created_at", [from, to])
    .select("p.establishment_id", "p.fee_cents", "p.created_at", "s.status as sale_status")) as Array<Record<string, unknown>>;
  const feesByStore = sumFeesByStore(pays as unknown as FeeRowLike[], month, tz);

  // Seller commissions: the person's profile %, then their seller record's —
  // the same order lib/sales-insights.ts applies.
  const sellerIds = [...new Set(commissionFacts.map((f) => f.seller_id).filter((v): v is string => Boolean(v)))];
  const [profiles, sellerRows] = await Promise.all([
    profilesByUser(container, sellerIds),
    listSellers(container).catch(() => []),
  ]);
  const sellerByCode = new Map(sellerRows.map((s) => [s.code, s.commission_pct]));
  const pctOf = (f: CommissionFactLike): number | null => {
    const own = f.seller_id ? profiles.get(f.seller_id)?.commission_pct ?? null : null;
    if (own !== null) return own;
    return f.seller_code ? sellerByCode.get(f.seller_code) ?? null : null;
  };
  const { sellers, byStore: commissionByStore } = commissionsOf(commissionFacts, pctOf);

  // Cost items: the store's own, and its share of the shared ones.
  const items = (await container.resolve<StoreCostModuleService>(STORE_COST_MODULE).listCostItems({}, { take: 5000 })) as unknown as Array<CostItemLike & { kind: "fixed" | "variable" }>;
  const fixed = new Map<string, number>();
  const variable = new Map<string, number>();
  const shared = new Map<string, number>();
  const sharedItems = items.filter((it) => !it.establishment_id && monthlyCharge(it, month) !== 0);
  // Weights of a charge shared "by sales": the net of EVERY active store that
  // month, not only of the stores in view. Reading one store's result must not
  // hand it 100 % of the rent of a shared warehouse. One extra aggregate, and
  // only when the view is narrower than the chain.
  const sharedWeights =
    sharedItems.some((it) => it.allocation?.method !== "percent") && ids.length !== activeStoreIds.length
      ? await netSalesByStore(pg, month, activeStoreIds)
      : netByStore;
  for (const it of items) {
    const charge = monthlyCharge(it, month);
    if (!charge) continue;
    if (it.establishment_id) {
      if (!ids.includes(it.establishment_id)) continue;
      const m = it.kind === "fixed" ? fixed : variable;
      m.set(it.establishment_id, (m.get(it.establishment_id) ?? 0) + charge);
    } else {
      // Shared among every active store (not only those in view), so a filtered view shows the same share.
      for (const [store, part] of allocateShared(charge, it.allocation, activeStoreIds, sharedWeights)) {
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
  // "No cost of goods defined yet": only the MATERIAL rules decide it. Measuring
  // every rule hid the warning as soon as the owner set the gateway's % or the
  // profit target — exactly the same predicate lib/sales-insights.ts uses.
  const materialRules = rules.filter((r) => MATERIAL_KINDS.has(r.kind));
  return { month, stores, total, sellers, cost_rules_missing: materialRules.every((r) => !r.amount) };
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

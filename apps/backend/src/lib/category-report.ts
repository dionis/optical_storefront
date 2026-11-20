/**
 * THE ACCOUNTING REPORT BY CATEGORY (owner, 17-nov-2026: «debe salir algún
 * reporte con filtro para ver toda la contabilidad y las finanzas por
 * categorías de costo y se debe poder exportar a PDF»).
 *
 * Not a new calculation: the income statement of the same span (the same
 * ledger, `loadLedger` → `buildStatement`) plus what each category is MADE of:
 *
 *  - cost of goods by concept (a frame model or brand, a lens design, a
 *    material, a treatment, each per-sale rule such as «Laboratorio»), from
 *    `EntityMonth.cogs_lines`;
 *  - each cost item (rent, payroll, the cleaning-kit per sale…) with what it
 *    charged per period and per store, from `EntityMonth.costs`;
 *  - the commission of each seller per period, from `LedgerMonth.sellers`.
 *
 * Every detail adds up to its statement line to the cent, by construction
 * (the statement sums the very same charges) — `tests/category-report.test.ts`
 * holds it. Cents inside, dollars out (the route divides once).
 */
import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import {
  buildStatement,
  lastDayOf,
  loadLedger,
  MAX_STATEMENT_MONTHS,
  monthsBetween,
  periodKeyOf,
  statementDollars,
  TAX_LINES,
  WEB_ENTITY,
  type CogsCents,
  type FinancialStatement,
  type LedgerItem,
  type LedgerMonth,
  type StatementEntity,
  type StatementGroup,
} from "./financial-statement";
import type { TaxCategory } from "./store-costs";
import { profilesByUser } from "./staff-profile-data";
import { ownerUserId } from "./staff-scope";
import { tenant } from "./tenant";

/** Amounts of one detail line: the whole span, each period (consolidated over the view) and each entity (whole span). */
export interface Amounts {
  total: number;
  by_period: Record<string, number>;
  by_entity: Record<string, number>;
}

export interface CogsDetail extends Amounts {
  key: string;
  label: string;
  /** The statement line it belongs to. */
  line: keyof Omit<CogsCents, "total">;
}

export interface ItemDetail extends Amounts {
  id: string;
  tax_category: TaxCategory;
  bucket: "fixed" | "variable" | "shared";
  per_sale: boolean;
  description: string | null;
  vendor: string | null;
  category: string | null;
  frequency: string | null;
  /** Owner store code; null = shared among stores. */
  owner_store: string | null;
}

export interface SellerDetail extends Amounts {
  key: string;
  seller_id: string | null;
  seller_code: string | null;
  name: string | null;
  /** The owner sold it (shown as «Dueño» when the account has no name). */
  is_owner: boolean;
  net_sales: number;
}

export interface CategoryReport extends FinancialStatement {
  cogs_detail: CogsDetail[];
  items: ItemDetail[];
  sellers: SellerDetail[];
}

const emptyAmounts = (): Amounts => ({ total: 0, by_period: {}, by_entity: {} });
const add = (a: Amounts, period: string, entity: string | null, cents: number) => {
  a.total += cents;
  a.by_period[period] = (a.by_period[period] ?? 0) + cents;
  if (entity) a.by_entity[entity] = (a.by_entity[entity] ?? 0) + cents;
};

/**
 * The details of a ledger (cents), only for the entities in `entityIds`
 * (the stores in view and «web»). Pure.
 */
export function detailsOf(ledger: readonly LedgerMonth[], group: StatementGroup, entityIds: readonly string[]) {
  const cogs = new Map<string, CogsDetail>();
  const items = new Map<string, Omit<ItemDetail, "description" | "vendor" | "category" | "frequency" | "owner_store">>();
  const sellers = new Map<string, Omit<SellerDetail, "name" | "is_owner"> & { net_cents: number }>();
  for (const lm of ledger) {
    const period = periodKeyOf(lm.month, group);
    for (const id of entityIds) {
      const e = lm.entities.get(id);
      if (!e) continue;
      for (const [key, row] of Object.entries(e.cogs_lines ?? {})) {
        const d = cogs.get(key) ?? { key, label: row.label, line: row.line, ...emptyAmounts() };
        add(d, period, id, row.cents);
        cogs.set(key, d);
      }
      for (const c of e.costs) {
        if (!c.cents) continue;
        const d = items.get(c.item_id) ?? { id: c.item_id, tax_category: c.tax_category, bucket: c.bucket, per_sale: c.per_sale, ...emptyAmounts() };
        add(d, period, id, c.cents);
        items.set(c.item_id, d);
      }
    }
    // Sellers are of the month's facts, already limited to the view by the
    // ledger. `commissionsOf` hands them in DOLLARS (cents ÷ 100 of an integer): back to cents.
    for (const s of lm.sellers) {
      const commission = Math.round(s.commission * 100);
      const net = Math.round(s.net_sales * 100);
      if (!commission && !net) continue;
      const key = s.seller_id ?? (s.seller_code ? `code:${s.seller_code}` : "-");
      const d = sellers.get(key) ?? { key, seller_id: s.seller_id, seller_code: s.seller_code, net_sales: 0, net_cents: 0, ...emptyAmounts() };
      add(d, period, null, commission);
      d.net_cents += net;
      sellers.set(key, d);
    }
  }
  const byTotal = <T extends { total: number }>(a: T, b: T) => b.total - a.total;
  return {
    cogs: [...cogs.values()].sort(byTotal),
    items: [...items.values()].sort(byTotal),
    sellers: [...sellers.values()].sort(byTotal),
  };
}

const dollars = (a: Amounts): Amounts => ({
  total: a.total / 100,
  by_period: Object.fromEntries(Object.entries(a.by_period).map(([k, v]) => [k, v / 100])),
  by_entity: Object.fromEntries(Object.entries(a.by_entity).map(([k, v]) => [k, v / 100])),
});

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

/** Names of the people who sold (staff users and referral sellers); a failed read leaves the codes. */
async function sellerNames(container: MedusaContainer, ids: string[], codes: string[]): Promise<{ byId: Map<string, string>; byCode: Map<string, string> }> {
  const pg = pgOf(container);
  const byId = new Map<string, string>();
  const byCode = new Map<string, string>();
  if (ids.length) {
    // The name the person gave in «Mi perfil» first, then the account's name, then a referral seller's.
    const profiles = await profilesByUser(container, ids).catch(() => new Map());
    for (const [id, pr] of profiles) {
      const name = String((pr as { display_name?: string | null }).display_name ?? "").trim();
      if (name) byId.set(id, name);
    }
    const users = (await pg("user").whereIn("id", ids).select("id", "first_name", "last_name").catch(() => [])) as Array<Record<string, unknown>>;
    for (const u of users) {
      const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
      if (name && !byId.has(String(u.id))) byId.set(String(u.id), name);
    }
    const sellers = (await pg("seller").whereIn("id", ids).whereNull("deleted_at").select("id", "name").catch(() => [])) as Array<Record<string, unknown>>;
    for (const s of sellers) if (s.name && !byId.has(String(s.id))) byId.set(String(s.id), String(s.name));
  }
  if (codes.length) {
    const rows = (await pg("seller").whereIn("code", codes).whereNull("deleted_at").select("code", "name").catch(() => [])) as Array<Record<string, unknown>>;
    for (const s of rows) if (s.name) byCode.set(String(s.code), String(s.name));
  }
  return { byId, byCode };
}

export async function categoryReport(
  container: MedusaContainer,
  input: { from: string; to: string; group: StatementGroup; storeIds: string[] | null; web: boolean }
): Promise<CategoryReport> {
  const months = monthsBetween(input.from, input.to).slice(0, MAX_STATEMENT_MONTHS);
  const { ledger, shownStores, onlineStoreId, items: costItems } = await loadLedger(container, months, input.storeIds, { web: input.web });
  const t = tenant();
  const entities: StatementEntity[] = [
    ...shownStores.map((s) => ({ id: s.id, code: s.code, name: s.name, color: s.color ?? null, kind: "store" as const })),
    ...(input.web && !onlineStoreId ? [{ id: WEB_ENTITY, code: "WEB", name: "Online", color: null, kind: "web" as const }] : []),
    { id: "total", code: "TOTAL", name: "Consolidated", color: null, kind: "total" },
  ];
  const doc = buildStatement(ledger, input.group, entities);
  const ids = entities.filter((e) => e.kind !== "total").map((e) => e.id);
  const det = detailsOf(ledger, input.group, ids);

  const itemById = new Map<string, LedgerItem>(costItems.map((it) => [it.id, it]));
  const codeOf = new Map(shownStores.map((s) => [s.id, s.code]));
  const owner = await ownerUserId(container).catch(() => null);
  const names = await sellerNames(
    container,
    det.sellers.map((s) => s.seller_id).filter((v): v is string => Boolean(v)),
    det.sellers.map((s) => s.seller_code).filter((v): v is string => Boolean(v))
  );

  return {
    ...doc,
    statements: Object.fromEntries(Object.entries(doc.statements).map(([p, byEntity]) => [p, Object.fromEntries(Object.entries(byEntity).map(([e, s]) => [e, statementDollars(s)]))])),
    from: `${months[0]}-01`,
    to: lastDayOf(months[months.length - 1]),
    tax_lines: TAX_LINES,
    business: { name: t.name, legal_name: t.legalName, timezone: t.timezone, currency: t.currency.toUpperCase() },
    generated_at: new Date().toISOString(),
    cogs_detail: det.cogs.map((c) => ({ ...c, ...dollars(c) })),
    items: det.items.map((d) => {
      const it = itemById.get(d.id) as (LedgerItem & Record<string, unknown>) | undefined;
      const owner = (it?.establishment_id as string | null | undefined) ?? null;
      return {
        ...d,
        ...dollars(d),
        description: (it?.description as string | null | undefined) ?? null,
        vendor: (it?.vendor as string | null | undefined) ?? null,
        category: (it?.category as string | null | undefined) ?? null,
        frequency: it?.per_sale ? "per_sale" : ((it?.frequency as string | null | undefined) ?? null),
        owner_store: owner ? codeOf.get(owner) ?? null : null,
      };
    }),
    sellers: det.sellers.map(({ net_cents, ...s }) => ({
      ...s,
      ...dollars(s),
      net_sales: net_cents / 100,
      name: (s.seller_id && names.byId.get(s.seller_id)) || (s.seller_code && names.byCode.get(s.seller_code)) || null,
      is_owner: Boolean(owner && s.seller_id === owner),
    })),
  };
}

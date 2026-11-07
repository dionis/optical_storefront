import type { ICustomerModuleService, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { examDue, groupPurchases, listRow, PATIENT_RULES, summarize, type PatientFactLike, type PatientListAgg, type Purchase, type PatientSummary } from "./patient-history";
import { getCustomer, lastPrescription, opticalHistory, searchCustomers, type HistoryEntry, type PosCustomerRow, type StoredRx } from "./pos-data";
import { getPosSettings } from "./pos-settings";

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

/** Columns of sale_fact the file reads (no payments, no cost). */
const FACT_COLUMNS = [
  "order_id", "sale_id", "sale_number", "channel", "establishment_id", "title", "brand", "category",
  "lens_design", "lens_material", "lens_photo", "lens_ar", "has_prescription", "qty", "list_cents",
  "discount_cents", "total_cents", "status", "sold_at",
];

export type PatientSort = "recent" | "total" | "purchases" | "avg";
export const PATIENT_SORTS: readonly PatientSort[] = ["recent", "total", "purchases", "avg"];
export const PATIENT_LIST_MAX = 200;

export interface PatientListItem extends PosCustomerRow, ReturnType<typeof listRow> {
  /** Day of the last prescription made here (not the one they wore), or null. */
  last_rx_on: string | null;
  exam: { due_on: string; overdue: boolean } | null;
}

/** The day a prescription counts from: its own date, else when it was recorded. */
const RX_DAY = "coalesce(rx_date::date, created_at::date)";
/** Prescriptions per customer, the worn ones left out (they say nothing about the next exam). */
const lastRxQuery = (pg: Knex) =>
  pg("prescription")
    .whereNull("deleted_at")
    .whereNotNull("customer_id")
    .where((q) => q.whereNull("kind").orWhere("kind", "<>", "worn"))
    .groupBy("customer_id")
    .select("customer_id");

/**
 * «Pacientes» list. With `q` (≥ 2 characters): the customers the till's search
 * finds (name, email, phone), with their numbers even if they never bought.
 * Without it: whoever bought, most recent first (or by `sort`). `storeIds`
 * (non-admins) keeps only patients who bought in one of those stores; their
 * numbers stay business-wide (the till shows every store's purchases too).
 */
export async function listPatients(
  container: MedusaContainer,
  input: { q?: string; storeIds: string[] | null; sort?: PatientSort; limit?: number; now?: Date; examOverdue?: boolean }
): Promise<{ patients: PatientListItem[]; truncated: boolean }> {
  const pg = pgOf(container);
  const limit = Math.min(Math.max(Number(input.limit) || 100, 1), PATIENT_LIST_MAX);
  const q = String(input.q ?? "").trim();
  const searched = q.length >= 2 ? await searchCustomers(container, q) : null;
  if (searched && !searched.length) return { patients: [], truncated: false };

  const agg = pg("sale_fact")
    .whereNotNull("customer_id")
    .whereNull("deleted_at")
    .groupBy("customer_id")
    .select("customer_id")
    .select(pg.raw("count(distinct order_id) filter (where status <> 'voided')::int as purchases"))
    .select(pg.raw("coalesce(sum(total_cents) filter (where status <> 'voided'), 0)::bigint as total_cents"))
    .select(pg.raw("min(sold_at) filter (where status <> 'voided') as first_at"))
    .select(pg.raw("max(sold_at) filter (where status <> 'voided') as last_at"));
  if (searched) agg.whereIn("customer_id", searched.map((c) => c.id));
  if (input.storeIds) {
    if (!input.storeIds.length) return { patients: [], truncated: false };
    agg.whereIn(
      "customer_id",
      pg("sale_fact").distinct("customer_id").whereNull("deleted_at").whereIn("establishment_id", input.storeIds).whereNotNull("customer_id")
    );
  }
  // Recall list: whose last prescription (not the one they wore) is PATIENT_RULES.examMonths old or more.
  if (input.examOverdue) {
    agg.whereIn("customer_id", lastRxQuery(pg).havingRaw(`max(${RX_DAY}) <= (?::date - make_interval(months => ?))`, [(input.now ?? new Date()).toISOString().slice(0, 10), PATIENT_RULES.examMonths]));
  }
  const sort = PATIENT_SORTS.includes(input.sort as PatientSort) ? (input.sort as PatientSort) : "recent";
  const orderSql = {
    recent: "max(sold_at) desc nulls last",
    total: "coalesce(sum(total_cents) filter (where status <> 'voided'), 0) desc",
    purchases: "count(distinct order_id) filter (where status <> 'voided') desc",
    avg: "coalesce(sum(total_cents) filter (where status <> 'voided'), 0) / greatest(count(distinct order_id) filter (where status <> 'voided'), 1) desc",
  }[sort];
  agg.orderByRaw(orderSql).limit(limit + 1);
  const rows = (await agg) as unknown as PatientListAgg[];
  const truncated = rows.length > limit;
  const page = rows.slice(0, limit);

  const byId = new Map<string, PosCustomerRow>((searched ?? []).map((c) => [c.id, c]));
  const missing = page.map((r) => r.customer_id).filter((id) => !byId.has(id));
  if (missing.length) {
    const svc = container.resolve<ICustomerModuleService>(Modules.CUSTOMER);
    const found = await svc.listCustomers({ id: missing }, { take: missing.length });
    for (const c of found) {
      byId.set(c.id, {
        id: c.id,
        first_name: c.first_name ?? null,
        last_name: c.last_name ?? null,
        email: c.email ?? null,
        phone: c.phone ?? null,
        birth_date: ((c.metadata as Record<string, unknown> | null)?.["birth_date"] as string | undefined) ?? null,
      });
    }
  }
  const now = input.now ?? new Date();
  const aggBy = new Map(page.map((r) => [r.customer_id, r]));
  const rxIds = [...new Set([...page.map((r) => r.customer_id), ...(searched ?? []).map((c) => c.id)])];
  const lastRx = new Map<string, string>();
  if (rxIds.length) {
    const rx = (await lastRxQuery(pg).whereIn("customer_id", rxIds).select(pg.raw(`max(${RX_DAY})::text as last_rx`))) as unknown as Array<{ customer_id: string; last_rx: string | null }>;
    for (const r of rx) if (r.last_rx) lastRx.set(r.customer_id, String(r.last_rx).slice(0, 10));
  }
  // A search keeps its own order (best match first) and shows who never bought, with zeros;
  // the store filter still applies to them (a non-admin finds only their stores' patients).
  const ids = searched
    ? searched.map((c) => c.id).filter((id) => aggBy.has(id) || !input.storeIds)
    : page.map((r) => r.customer_id);
  const patients = ids
    .filter((id) => byId.has(id))
    .map((id) => {
      const rxDay = lastRx.get(id) ?? null;
      return {
        ...(byId.get(id) as PosCustomerRow),
        ...listRow(aggBy.get(id) ?? { customer_id: id, purchases: 0, total_cents: 0, first_at: null, last_at: null }, now),
        last_rx_on: rxDay,
        exam: rxDay ? examDue({ rx_date: rxDay, created_at: rxDay }, now) : null,
      };
    });
  return { patients, truncated };
}

export interface PatientFile {
  customer: PosCustomerRow & { address: { address_1: string | null; city: string | null; province: string | null; postal_code: string | null } | null; since: string | null; has_account: boolean };
  summary: PatientSummary;
  purchases: Purchase[];
  last_prescription: StoredRx | null;
  history: HistoryEntry[];
  exam: { due_on: string; overdue: boolean } | null;
}

/** Everything of one patient, or null when the customer does not exist. */
export async function patientFile(container: MedusaContainer, customerId: string, now: Date = new Date()): Promise<PatientFile | null> {
  const customer = await getCustomer(container, customerId);
  if (!customer) return null;
  const pg = pgOf(container);
  const settings = await getPosSettings(container);
  const [facts, last, history, extra, addr] = await Promise.all([
    pg("sale_fact").where({ customer_id: customerId }).whereNull("deleted_at").select(FACT_COLUMNS).orderBy("sold_at", "desc").limit(2000) as unknown as Promise<PatientFactLike[]>,
    lastPrescription(container, customerId),
    opticalHistory(container, customerId, settings.optical_thresholds),
    pg("customer").where({ id: customerId }).first("created_at", "has_account") as Promise<{ created_at?: Date | string; has_account?: boolean } | undefined>,
    (pg("customer_address").where({ customer_id: customerId }).whereNull("deleted_at").orderBy("created_at", "asc").first("address_1", "city", "province", "postal_code") as Promise<Record<string, string | null> | undefined>).catch(() => undefined),
  ]);
  const purchases = groupPurchases(facts);
  return {
    customer: {
      ...customer,
      address: addr ? { address_1: addr["address_1"] ?? null, city: addr["city"] ?? null, province: addr["province"] ?? null, postal_code: addr["postal_code"] ?? null } : null,
      since: extra?.created_at ? new Date(extra.created_at).toISOString() : null,
      has_account: Boolean(extra?.has_account),
    },
    summary: summarize(purchases, now),
    purchases,
    last_prescription: last,
    history,
    exam: examDue(last, now),
  };
}

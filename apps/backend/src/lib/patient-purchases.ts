import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { listRow, type PatientTier } from "./patient-history";

/**
 * A patient's purchases so far (owner, 18-nov-2026: «saber cuándo un cliente
 * hace más de una compra … para hacer promociones y descuentos»): valid sales
 * of every store and the web (`sale_fact`, voided and deleted out), as the
 * patient file counts them (lib/patient-history.ts). For the till (who is in
 * front of the seller) and for a promotion that starts at the N-th purchase.
 */
export interface PurchaseSummary {
  purchases: number;
  total: number;
  first_at: string | null;
  last_at: string | null;
  tier: PatientTier;
  lapsed: boolean;
}

export async function purchaseSummary(container: MedusaContainer, customerId: string | null | undefined): Promise<PurchaseSummary> {
  const empty: PurchaseSummary = { purchases: 0, total: 0, first_at: null, last_at: null, tier: "none", lapsed: false };
  if (!customerId) return empty;
  const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  const [r] = (await pg("sale_fact")
    .where({ customer_id: customerId, status: "active" })
    .whereNull("deleted_at")
    .select(pg.raw("COUNT(DISTINCT order_id)::int AS purchases"), pg.raw("COALESCE(SUM(total_cents), 0)::bigint AS total_cents"), pg.raw("MIN(sold_at) AS first_at"), pg.raw("MAX(sold_at) AS last_at"))) as Array<Record<string, unknown>>;
  if (!r) return empty;
  const row = listRow({ customer_id: customerId, purchases: Number(r.purchases) || 0, total_cents: Number(r.total_cents) || 0, first_at: (r.first_at as string | null) ?? null, last_at: (r.last_at as string | null) ?? null });
  return { purchases: row.purchases, total: row.total_cents / 100, first_at: row.first_at, last_at: row.last_at, tier: row.tier, lapsed: row.lapsed };
}

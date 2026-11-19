/**
 * Promotions in the database (`store_promotion`, migration
 * CreateStorePromotion8). The rules are in lib/promotions.ts.
 */
import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, generateEntityId } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { recordAudit } from "./audit";
import { tenant } from "./tenant";
import { localClock } from "./store-hours";
import { promoState, type Promotion, type PromotionInput } from "./promotions";

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
const ymdOf = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const intOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export const rowToPromotion = (r: Record<string, unknown>): Promotion => ({
  id: String(r.id),
  name: String(r.name),
  description: (r.description as string | null) ?? null,
  kind: r.kind as Promotion["kind"],
  establishment_ids: Array.isArray(r.establishment_ids) && r.establishment_ids.length ? (r.establishment_ids as string[]) : null,
  starts_on: ymdOf(r.starts_on),
  ends_on: ymdOf(r.ends_on),
  is_active: r.is_active === true,
  pct: intOrNull(r.pct),
  buy_qty: intOrNull(r.buy_qty),
  get_qty: intOrNull(r.get_qty),
  min_total_cents: intOrNull(r.min_total_cents),
  value_cents: intOrNull(r.value_cents),
  sort: Number(r.sort ?? 0),
});

/** Today on the store's calendar (the tenant's time zone). */
export const storeToday = (at: Date = new Date()): string => localClock(at, tenant().timezone).ymd;

/** Every promotion (not deleted), in the owner's order, with where it stands today. */
export async function listPromotions(container: MedusaContainer): Promise<Array<Promotion & { state: ReturnType<typeof promoState> }>> {
  const rows = (await pgOf(container)("store_promotion").whereNull("deleted_at").orderBy([{ column: "sort", order: "asc" }, { column: "created_at", order: "asc" }])) as Array<Record<string, unknown>>;
  const today = storeToday();
  return rows.map(rowToPromotion).map((p) => ({ ...p, state: promoState(p, today) }));
}

/** The promotions the till can offer in this store today. */
export async function livePromotions(container: MedusaContainer, establishmentId: string): Promise<Promotion[]> {
  const today = storeToday();
  const rows = (await pgOf(container)("store_promotion")
    .whereNull("deleted_at")
    .andWhere("is_active", true)
    .orderBy([{ column: "sort", order: "asc" }, { column: "created_at", order: "asc" }])) as Array<Record<string, unknown>>;
  return rows.map(rowToPromotion).filter((p) => promoState(p, today, establishmentId) === "live");
}

/** One promotion the till asked for, if it runs in this store today. */
export async function livePromotion(container: MedusaContainer, id: string, establishmentId: string): Promise<Promotion | null> {
  const [r] = (await pgOf(container)("store_promotion").where({ id }).whereNull("deleted_at")) as Array<Record<string, unknown>>;
  if (!r) return null;
  const p = rowToPromotion(r);
  return promoState(p, storeToday(), establishmentId) === "live" ? p : null;
}

const columns = (p: PromotionInput) => ({
  name: p.name,
  description: p.description,
  kind: p.kind,
  establishment_ids: p.establishment_ids,
  starts_on: p.starts_on,
  ends_on: p.ends_on,
  is_active: p.is_active,
  pct: p.pct,
  buy_qty: p.buy_qty,
  get_qty: p.get_qty,
  min_total_cents: p.min_total_cents,
  value_cents: p.value_cents,
});

export async function createPromotion(container: MedusaContainer, p: PromotionInput, actorId: string | null): Promise<Promotion> {
  const pg = pgOf(container);
  const [{ max }] = (await pg("store_promotion").whereNull("deleted_at").max({ max: "sort" })) as Array<{ max: number | null }>;
  const id = generateEntityId("", "promo");
  await pg("store_promotion").insert({ id, ...columns(p), sort: p.sort ?? Number(max ?? 0) + 1, created_by: actorId, updated_by: actorId });
  const [row] = (await pg("store_promotion").where({ id })) as Array<Record<string, unknown>>;
  const promo = rowToPromotion(row);
  await recordAudit(container, { actorId, action: "promotion.change", entity: "store_promotion", entityId: id, before: null, after: promo });
  return promo;
}

export async function updatePromotion(container: MedusaContainer, id: string, p: PromotionInput, actorId: string | null): Promise<Promotion | null> {
  const pg = pgOf(container);
  const [before] = (await pg("store_promotion").where({ id }).whereNull("deleted_at")) as Array<Record<string, unknown>>;
  if (!before) return null;
  await pg("store_promotion").where({ id }).update({ ...columns(p), ...(p.sort !== undefined ? { sort: p.sort } : {}), updated_by: actorId, updated_at: new Date() });
  const [row] = (await pg("store_promotion").where({ id })) as Array<Record<string, unknown>>;
  const promo = rowToPromotion(row);
  await recordAudit(container, { actorId, action: "promotion.change", entity: "store_promotion", entityId: id, before: rowToPromotion(before), after: promo });
  return promo;
}

/** Switch on / off without touching the rest. */
export async function setPromotionActive(container: MedusaContainer, id: string, active: boolean, actorId: string | null): Promise<Promotion | null> {
  const pg = pgOf(container);
  const n = await pg("store_promotion").where({ id }).whereNull("deleted_at").update({ is_active: active, updated_by: actorId, updated_at: new Date() });
  if (!n) return null;
  const [row] = (await pg("store_promotion").where({ id })) as Array<Record<string, unknown>>;
  const promo = rowToPromotion(row);
  await recordAudit(container, { actorId, action: "promotion.change", entity: "store_promotion", entityId: id, before: { is_active: !active }, after: { is_active: active } });
  return promo;
}

/** Soft delete: past sales keep their copy of it. */
export async function deletePromotion(container: MedusaContainer, id: string, actorId: string | null): Promise<boolean> {
  const pg = pgOf(container);
  const [before] = (await pg("store_promotion").where({ id }).whereNull("deleted_at")) as Array<Record<string, unknown>>;
  if (!before) return false;
  await pg("store_promotion").where({ id }).update({ deleted_at: new Date(), updated_by: actorId, updated_at: new Date() });
  await recordAudit(container, { actorId, action: "promotion.delete", entity: "store_promotion", entityId: id, before: rowToPromotion(before), after: null });
  return true;
}

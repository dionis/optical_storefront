/**
 * THE ONLINE STORE — the establishment the owner runs the web shop with
 * (docs/TIENDA-ONLINE-UNIFICADA.md).
 *
 * The web shop used to be a channel without a store: its prices were the
 * master list and its orders sat on a pseudo-store ("web") that had no
 * column in «Productos y precios» and no costs of its own. The owner already
 * had a store for it in the panel («Online Optical Store», Op4), so the model
 * is now the obvious one: ONE store of `kind = 'online'` IS the web shop.
 *
 *   - what the web charges is that store's price (lib/web-pricing.ts): its
 *     column in «Productos y precios», its lens list, its promotions;
 *   - what the web sells is that store's sale: the panel shows the web's
 *     orders under its code and color, and the ledger books them on it, next
 *     to the costs the owner types for it.
 *
 * With no online store, everything behaves as before (master prices, the
 * "web" pseudo-store). At most one store is online: the edit route refuses a
 * second one (`online_exists`).
 *
 * The designation is read on every /store request that prices something, so
 * it is cached for a few seconds and dropped on every write to a store.
 */
import type { Knex } from "@mikro-orm/knex";
import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { ONLINE_KIND } from "./establishments";
import { STORE_COLORS } from "./store-color";

export interface OnlineStore {
  id: string;
  code: string;
  name: string;
  color: string;
}

/** Establishment rows as the picker needs them. */
export interface OnlineCandidate {
  id: string;
  code: string;
  name: string;
  color?: string | null;
  kind?: string | null;
  is_active?: boolean | null;
}

/**
 * The online store among `rows`: the active one of kind `online` — the oldest
 * (rows come in creation order) should two ever exist. Pure.
 */
export function pickOnlineStore(rows: readonly OnlineCandidate[]): OnlineStore | null {
  const row = rows.find((r) => r.kind === ONLINE_KIND && r.is_active !== false);
  return row ? { id: row.id, code: row.code, name: row.name, color: row.color || STORE_COLORS[0] } : null;
}

const TTL_MS = 15_000;
let cached: { at: number; value: OnlineStore | null } | null = null;

/** Forget the cached designation: call after any write to a store. */
export function forgetOnlineStore(): void {
  cached = null;
}

/**
 * The online store of this deployment, or null when the owner has none.
 * Never throws: a read that fails answers null for THIS call (the caller
 * falls back to the master list, as before the online store existed) and is
 * not cached.
 */
export async function onlineStore(container: MedusaContainer, now = Date.now()): Promise<OnlineStore | null> {
  if (cached && now - cached.at < TTL_MS) return cached.value;
  try {
    const pg = container.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
    const rows = (await pg("establishment")
      .whereNull("deleted_at")
      .where({ kind: ONLINE_KIND, is_active: true })
      .orderBy("created_at", "asc")
      .limit(1)
      .select("id", "code", "name", "color", "kind", "is_active")) as OnlineCandidate[];
    const value = pickOnlineStore(rows);
    cached = { at: now, value };
    return value;
  } catch {
    return null;
  }
}

/** Only its id (the ledger and the analytics key rows by it). */
export async function onlineStoreId(container: MedusaContainer): Promise<string | null> {
  return (await onlineStore(container))?.id ?? null;
}

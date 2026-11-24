import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { recordAudit } from "./audit";
import {
  indexOneStoreToggles,
  indexStoreLensToggles,
  type StoreLensToggleKind,
  type StoreLensToggleRow,
  type StoreToggleLookup,
} from "./store-lens-toggle";

/**
 * Knex reads & writes for `store_lens_toggle` (migration CreateStoreLensToggle13).
 * Every read safely returns empty if the table has not been migrated yet, so an
 * un-migrated database behaves exactly as before (everything enabled).
 */

const pgOf = (c: MedusaContainer): Knex => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);

const toRow = (r: Record<string, unknown>): StoreLensToggleRow => ({
  establishment_id: String(r["establishment_id"] ?? ""),
  item_kind: String(r["item_kind"] ?? "") as StoreLensToggleKind,
  item_key: String(r["item_key"] ?? ""),
  enabled: Boolean(r["enabled"]),
});

/** One store's lens/treatment toggles via Knex. Never throws. */
export async function loadStoreLensTogglesPg(pg: Knex, establishmentId: string | null | undefined): Promise<StoreToggleLookup> {
  if (!establishmentId) return new Map();
  try {
    const rows = (await pg("store_lens_toggle").where({ establishment_id: establishmentId })) as Array<Record<string, unknown>>;
    return indexOneStoreToggles(rows.map(toRow));
  } catch {
    return new Map();
  }
}

/** Multiple stores' lens/treatment toggles in ONE query, indexed by store id. Never throws. */
export async function loadStoreLensTogglesMapPg(pg: Knex, storeIds: readonly string[]): Promise<Map<string, StoreToggleLookup>> {
  if (!storeIds.length) return new Map();
  try {
    const rows = (await pg("store_lens_toggle").whereIn("establishment_id", [...storeIds])) as Array<Record<string, unknown>>;
    return indexStoreLensToggles(rows.map(toRow));
  } catch {
    return new Map();
  }
}

/**
 * Enables or disables a lens design, lens cell, treatment group, photochromic,
 * or AR option for ONE store.
 *
 * When toggling a group (`design` or `treatment_group`), any per-item overrides
 * under that group in that store are cleared so the group switch immediately
 * turns every item of that group ON or OFF together. Individual items can then
 * be customized again afterwards.
 */
export async function setStoreLensToggle(
  container: MedusaContainer,
  input: { establishmentId: string; kind: StoreLensToggleKind; key: string; enabled: boolean },
  actorId: string | null
): Promise<{ before: boolean | null; after: boolean }> {
  const pg = pgOf(container);
  const { establishmentId, kind, key, enabled } = input;

  const prev = (await pg("store_lens_toggle")
    .where({ establishment_id: establishmentId, item_kind: kind, item_key: key })
    .first()) as Record<string, unknown> | undefined;
  const before = prev ? Boolean(prev["enabled"]) : null;

  await pg.transaction(async (trx) => {
    await trx("store_lens_toggle")
      .insert({
        establishment_id: establishmentId,
        item_kind: kind,
        item_key: key,
        enabled,
        updated_by: actorId,
        updated_at: trx.fn.now(),
      })
      .onConflict(["establishment_id", "item_kind", "item_key"])
      .merge({
        enabled,
        updated_by: actorId,
        updated_at: trx.fn.now(),
      });

    // Group toggle resets child overrides in that store so the group switch acts cleanly on all rows.
    if (kind === "design") {
      await trx("store_lens_toggle")
        .where({ establishment_id: establishmentId, item_kind: "lens" })
        .andWhere("item_key", "like", `${key}:%`)
        .delete();
    } else if (kind === "treatment_group") {
      const childKind = key === "photo" ? "photo" : "ar";
      await trx("store_lens_toggle")
        .where({ establishment_id: establishmentId, item_kind: childKind })
        .delete();
    }
  });

  if (before !== enabled) {
    await recordAudit(container, {
      actorId,
      action: "catalog.update",
      entity: "store_lens_toggle",
      entityId: `${kind}:${key}`,
      establishmentId,
      before: before === null ? null : { kind, key, enabled: before },
      after: { kind, key, enabled },
    });
  }

  return { before, after: enabled };
}

/**
 * The web shop's showcase in the database (`web_showcase`, one row "default",
 * migration store-pricing/CreateWebShowcase12). The rules are in
 * lib/web-showcase.ts. Read by SQL, not through an ORM model: a database
 * without the table answers the catalogue order, so a failed `db:migrate`
 * never takes the shop down.
 */
import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { recordAudit } from "./audit";
import { DEFAULT_SHOWCASE, showcaseOf, type WebShowcase } from "./web-showcase";

const pgOf = (c: MedusaContainer) => c.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
const ROW_ID = "default";

export interface StoredShowcase extends WebShowcase {
  updated_at: string | null;
  updated_by: string | null;
}

/** The showcase, or the catalogue order when there is none or it cannot be read. Never throws. */
export async function readShowcase(container: MedusaContainer): Promise<StoredShowcase> {
  try {
    const row = (await pgOf(container)("web_showcase").where({ id: ROW_ID }).first()) as Record<string, unknown> | undefined;
    if (!row) return { ...DEFAULT_SHOWCASE, brands: [], updated_at: null, updated_by: null };
    const at = row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ? String(row.updated_at) : null;
    return { ...showcaseOf(row), updated_at: at, updated_by: (row.updated_by as string | null) ?? null };
  } catch {
    return { ...DEFAULT_SHOWCASE, brands: [], updated_at: null, updated_by: null };
  }
}

/** Saves it (upsert) and leaves the before/after in the audit log. Throws on a write failure. */
export async function saveShowcase(container: MedusaContainer, next: WebShowcase, actorId: string | null): Promise<StoredShowcase> {
  const before = await readShowcase(container);
  const now = new Date();
  await pgOf(container)("web_showcase")
    .insert({ id: ROW_ID, mode: next.mode, brands: JSON.stringify(next.brands), updated_by: actorId, updated_at: now })
    .onConflict("id")
    .merge(["mode", "brands", "updated_by", "updated_at"]);
  await recordAudit(container, {
    actorId,
    action: "settings.change",
    entity: "web_showcase",
    entityId: ROW_ID,
    establishmentId: null,
    before: { mode: before.mode, brands: before.brands },
    after: { mode: next.mode, brands: next.brands },
  });
  return { ...next, updated_at: now.toISOString(), updated_by: actorId };
}

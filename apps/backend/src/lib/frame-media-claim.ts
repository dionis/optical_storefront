/**
 * The atomic claim: hand a run a batch of assets and lease them, in one statement.
 *
 * WHY RAW SQL AND NOT THE MODULE SERVICE
 * --------------------------------------
 * This is the one operation that cannot be expressed as CRUD without a race.
 * "List candidates, then update them" lets two concurrent runs read the same
 * rows and both believe they own them — and every duplicated row is a duplicated
 * charge. `SELECT … FOR UPDATE SKIP LOCKED` inside the UPDATE is what makes the
 * second run take DIFFERENT work instead of the same work, and Postgres has no
 * CRUD-shaped equivalent.
 *
 * Two runs happening at once is not hypothetical: the owner opens a second
 * terminal because the first "looks stuck".
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaContainer } from "@medusajs/framework/types";
import { CLAIMABLE, LEASE_MINUTES, MAX_ATTEMPTS, MediaKind } from "./frame-media";

export interface ClaimedAsset {
  id: string;
  product_handle: string;
  variant_sku: string;
  colorway: string | null;
  kind: MediaKind;
  slot: string | null;
  source_image_url: string | null;
  source_fingerprint: string | null;
  operation: string | null;
  attempts: number;
}

export interface ClaimInput {
  /** Identifies the run holding the lease. One per CLI invocation. */
  runId: string;
  limit: number;
  kind?: MediaKind;
  slots?: string[];
  handles?: string[];
}

/**
 * Claims up to `limit` assets and returns them already leased.
 *
 * Reclaims expired leases too: an asset stuck in `running` because somebody
 * closed the ssh session is exactly the case this has to recover, and without
 * that clause it would sit there forever with nobody looking at it.
 */
export async function claimAssets(
  container: MedusaContainer,
  input: ClaimInput
): Promise<ClaimedAsset[]> {
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);

  const filters: string[] = [];
  const bindings: Record<string, unknown> = {
    runId: input.runId,
    limit: Math.max(1, Math.min(input.limit, 100)),
    claimable: CLAIMABLE,
    maxAttempts: MAX_ATTEMPTS,
    leaseMinutes: `${LEASE_MINUTES} minutes`,
  };

  if (input.kind) {
    filters.push("AND kind = :kind");
    bindings.kind = input.kind;
  }
  if (input.slots?.length) {
    filters.push("AND slot = ANY(:slots)");
    bindings.slots = input.slots;
  }
  if (input.handles?.length) {
    filters.push("AND product_handle = ANY(:handles)");
    bindings.handles = input.handles;
  }

  // The ORDER BY is stable on purpose: progress advances brand by brand and
  // frame by frame rather than scattered, so "it is on Di Caprio" is a sentence
  // that means something and `media status` can say it.
  const { rows } = await knex.raw(
    `
    UPDATE frame_media_asset
       SET status      = 'running',
           lease_until = NOW() + :leaseMinutes::interval,
           claimed_by  = :runId,
           started_at  = NOW(),
           updated_at  = NOW()
     WHERE id IN (
       SELECT id FROM frame_media_asset
        WHERE deleted_at IS NULL
          AND (
                (status = ANY(:claimable) AND attempts < :maxAttempts)
             OR (status = 'running' AND (lease_until IS NULL OR lease_until < NOW()))
          )
          ${filters.join("\n          ")}
        ORDER BY kind, product_handle, slot
        LIMIT :limit
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, product_handle, variant_sku, colorway, kind, slot,
              source_image_url, source_fingerprint, operation, attempts;
    `,
    bindings
  );

  return (rows ?? []) as ClaimedAsset[];
}

/**
 * Releases assets a run claimed but never finished, so the next run can take
 * them immediately instead of waiting out the lease.
 *
 * Called on a clean Ctrl-C. A hard kill skips it, which is why the lease exists.
 */
export async function releaseRun(
  container: MedusaContainer,
  runId: string
): Promise<number> {
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const { rowCount } = await knex.raw(
    `
    UPDATE frame_media_asset
       SET status = 'pending', lease_until = NULL, claimed_by = NULL, updated_at = NOW()
     WHERE claimed_by = :runId AND status = 'running' AND deleted_at IS NULL;
    `,
    { runId }
  );
  return Number(rowCount ?? 0);
}

/**
 * Inserts the asset rows for a set of frames, skipping any that already exist.
 *
 * ON CONFLICT DO NOTHING against the unique (variant_sku, kind, COALESCE(slot,''))
 * index is what makes enqueueing idempotent — the panel, the CLI and the scraper
 * can all ask for the same asset and exactly one row results.
 */
export async function enqueueAssets(
  container: MedusaContainer,
  rows: Array<{
    id: string;
    product_handle: string;
    variant_sku: string;
    colorway: string | null;
    kind: MediaKind;
    slot: string | null;
    source_image_url: string | null;
    requested_by: string;
  }>
): Promise<number> {
  if (!rows.length) return 0;
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);

  const result = await knex.raw(
    `
    INSERT INTO frame_media_asset
      (id, product_handle, variant_sku, colorway, kind, slot, source_image_url,
       requested_by, status, created_at, updated_at)
    SELECT t.id, t.product_handle, t.variant_sku, t.colorway, t.kind, t.slot,
           t.source_image_url, t.requested_by, 'pending', NOW(), NOW()
      FROM UNNEST(
        :ids::text[], :handles::text[], :skus::text[], :colorways::text[],
        :kinds::text[], :slots::text[], :sources::text[], :requesters::text[]
      ) AS t(id, product_handle, variant_sku, colorway, kind, slot,
             source_image_url, requested_by)
    ON CONFLICT DO NOTHING;
    `,
    {
      ids: rows.map((r) => r.id),
      handles: rows.map((r) => r.product_handle),
      skus: rows.map((r) => r.variant_sku),
      colorways: rows.map((r) => r.colorway),
      kinds: rows.map((r) => r.kind),
      slots: rows.map((r) => r.slot),
      sources: rows.map((r) => r.source_image_url),
      requesters: rows.map((r) => r.requested_by),
    }
  );

  return Number(result.rowCount ?? 0);
}

/** Aggregate counts for the board and for `media status`, in one round trip. */
export async function progressCounts(
  container: MedusaContainer,
  handles?: string[]
): Promise<Array<{ kind: string; status: string; count: number }>> {
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const { rows } = await knex.raw(
    `
    SELECT kind, status, COUNT(*)::int AS count
      FROM frame_media_asset
     WHERE deleted_at IS NULL
       ${handles?.length ? "AND product_handle = ANY(:handles)" : ""}
     GROUP BY kind, status;
    `,
    handles?.length ? { handles } : {}
  );
  return (rows ?? []) as Array<{ kind: string; status: string; count: number }>;
}

/**
 * Writes against the frame-media tables.
 *
 * WHY RAW SQL RATHER THAN THE MODULE SERVICE
 * ------------------------------------------
 * Every write through the generated service answered 500 in production —
 * `updateFrameMediaAssets` and `updateFrameMediaBudgets`, on both tables, even
 * with a minimal payload — while `list` on the same models worked fine. The
 * container logs were not reachable to see the stack behind Medusa's generic
 * error, and these are single-row updates by primary key, so the service layer
 * was buying nothing here.
 *
 * The module already reads and claims through SQL (see frame-media-claim.ts,
 * where the claim genuinely needs `FOR UPDATE SKIP LOCKED`). Putting the writes
 * on the same mechanism leaves the module with one way of talking to its tables
 * instead of two, one of which does not work in this deployment.
 *
 * If the service ever needs to come back, the shapes here are deliberately plain
 * and the routes call nothing else.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaContainer } from "@medusajs/framework/types";

export interface ReportInput {
  id: string;
  status: string;
  attempts: number;
  output_key?: string | null;
  output_bytes?: number | null;
  output_mime?: string | null;
  source_fingerprint?: string | null;
  provider_model?: string | null;
  operation?: string | null;
  billing_unit?: string | null;
  tokens_prompt?: number | null;
  tokens_output?: number | null;
  cost_usd?: number | null;
  receipt?: Record<string, unknown> | null;
  reason?: string | null;
  note?: string | null;
}

/**
 * Records one finished asset and drops its lease.
 *
 * COALESCE on every optional column, because a report that omits a field must
 * leave it alone rather than blank it: a video persisting only its Veo operation
 * name mid-flight would otherwise wipe the fingerprint and cost of the attempt
 * that is still running.
 */
export async function applyReport(
  container: MedusaContainer,
  input: ReportInput
): Promise<number> {
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const failed = input.status === "failed";

  const result = await knex.raw(
    `
    UPDATE frame_media_asset
       SET status             = :status,
           attempts           = :attempts,
           lease_until        = NULL,
           claimed_by         = NULL,
           finished_at        = CASE WHEN :status = 'awaiting_external'
                                     THEN NULL ELSE NOW() END,
           last_error_reason  = :reason,
           last_error_note    = :note,
           output_key         = COALESCE(:output_key, output_key),
           output_bytes       = COALESCE(:output_bytes, output_bytes),
           output_mime        = COALESCE(:output_mime, output_mime),
           source_fingerprint = COALESCE(:source_fingerprint, source_fingerprint),
           provider_model     = COALESCE(:provider_model, provider_model),
           operation          = COALESCE(:operation, operation),
           billing_unit       = COALESCE(:billing_unit, billing_unit),
           tokens_prompt      = COALESCE(:tokens_prompt, tokens_prompt),
           tokens_output      = COALESCE(:tokens_output, tokens_output),
           cost_usd           = COALESCE(:cost_usd, cost_usd),
           receipt            = COALESCE(CAST(:receipt AS jsonb), receipt),
           updated_at         = NOW()
     WHERE id = :id AND deleted_at IS NULL
    `,
    {
      id: input.id,
      status: input.status,
      attempts: input.attempts,
      reason: failed ? (input.reason ?? "unknown") : null,
      note: failed ? (input.note ?? null) : null,
      output_key: input.output_key ?? null,
      output_bytes: input.output_bytes ?? null,
      output_mime: input.output_mime ?? null,
      source_fingerprint: input.source_fingerprint ?? null,
      provider_model: input.provider_model ?? null,
      operation: input.operation ?? null,
      billing_unit: input.billing_unit ?? null,
      tokens_prompt: input.tokens_prompt ?? null,
      tokens_output: input.tokens_output ?? null,
      cost_usd: input.cost_usd ?? null,
      receipt: input.receipt ? JSON.stringify(input.receipt) : null,
    }
  );

  return Number(result.rowCount ?? 0);
}

/** One asset, for the guards a route applies before writing. */
export async function getAsset(
  container: MedusaContainer,
  id: string
): Promise<Record<string, unknown> | null> {
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const { rows } = await knex.raw(
    `SELECT * FROM frame_media_asset WHERE id = :id AND deleted_at IS NULL LIMIT 1`,
    { id }
  );
  return (rows?.[0] as Record<string, unknown>) ?? null;
}

/**
 * Puts failed assets back in the queue with `attempts` reset to zero.
 *
 * Non-retryable reasons are left alone unless forced: requeueing a bad API key
 * only spends three more attempts reaching the same wall.
 */
export async function requeueAssets(
  container: MedusaContainer,
  input: {
    ids?: string[];
    handles?: string[];
    kind?: string;
    slots?: string[];
    force: boolean;
    nonRetryable: string[];
  }
): Promise<{ requeued: number; blocked: number }> {
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);

  const where = ["deleted_at IS NULL", "status = 'failed'"];
  const bindings: Record<string, unknown> = {};
  if (input.ids?.length) {
    where.push("id = ANY(:ids)");
    bindings.ids = input.ids;
  }
  if (input.handles?.length) {
    where.push("product_handle = ANY(:handles)");
    bindings.handles = input.handles;
  }
  if (input.kind) {
    where.push("kind = :kind");
    bindings.kind = input.kind;
  }
  if (input.slots?.length) {
    where.push("slot = ANY(:slots)");
    bindings.slots = input.slots;
  }
  const predicate = where.join(" AND ");

  const total = await knex.raw(
    `SELECT COUNT(*)::int AS n FROM frame_media_asset WHERE ${predicate}`,
    bindings
  );

  const guard = input.force
    ? ""
    : " AND (last_error_reason IS NULL OR NOT (last_error_reason = ANY(:nonRetryable)))";

  const result = await knex.raw(
    `
    UPDATE frame_media_asset
       SET status = 'pending', attempts = 0, lease_until = NULL, claimed_by = NULL,
           last_error_reason = NULL, last_error_note = NULL, updated_at = NOW()
     WHERE ${predicate}${guard}
    `,
    input.force ? bindings : { ...bindings, nonRetryable: input.nonRetryable }
  );

  const requeued = Number(result.rowCount ?? 0);
  return { requeued, blocked: Number(total.rows?.[0]?.n ?? 0) - requeued };
}

/** Flips `published` on assets that actually have a file behind them. */
export async function setPublished(
  container: MedusaContainer,
  input: { ids?: string[]; handles?: string[]; kind?: string; published: boolean }
): Promise<{ changed: number; eligible: number }> {
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);

  const where = ["deleted_at IS NULL", "status = 'done'"];
  const bindings: Record<string, unknown> = { published: input.published };
  if (input.ids?.length) {
    where.push("id = ANY(:ids)");
    bindings.ids = input.ids;
  }
  if (input.handles?.length) {
    where.push("product_handle = ANY(:handles)");
    bindings.handles = input.handles;
  }
  if (input.kind) {
    where.push("kind = :kind");
    bindings.kind = input.kind;
  }
  const predicate = where.join(" AND ");

  const eligible = await knex.raw(
    `SELECT COUNT(*)::int AS n FROM frame_media_asset WHERE ${predicate}`,
    bindings
  );
  const result = await knex.raw(
    `UPDATE frame_media_asset SET published = :published, updated_at = NOW()
      WHERE ${predicate} AND published IS DISTINCT FROM :published`,
    bindings
  );

  return {
    changed: Number(result.rowCount ?? 0),
    eligible: Number(eligible.rows?.[0]?.n ?? 0),
  };
}

/** JSON columns need a real JSON literal, not the driver's array rendering. */
const JSON_COLUMNS = new Set(["video_sku_list"]);

/** The single budget row, created on first write. */
export async function upsertBudget(
  container: MedusaContainer,
  id: string,
  fields: Record<string, unknown>
): Promise<void> {
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (!entries.length) return;

  const bindings: Record<string, unknown> = { id };
  const columns: string[] = [];
  const placeholders: string[] = [];

  for (const [column, value] of entries) {
    columns.push(column);
    if (JSON_COLUMNS.has(column)) {
      bindings[column] = JSON.stringify(value ?? null);
      placeholders.push(`CAST(:${column} AS jsonb)`);
    } else {
      bindings[column] = value;
      placeholders.push(`:${column}`);
    }
  }

  await knex.raw(
    `
    INSERT INTO frame_media_budget (id, ${columns.join(", ")}, created_at, updated_at)
    VALUES (:id, ${placeholders.join(", ")}, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE
       SET ${columns.map((c) => `${c} = EXCLUDED.${c}`).join(", ")},
           updated_at = NOW()
    `,
    bindings
  );
}

import { Migration } from "@mikro-orm/migrations";

/**
 * Generated media assets + the spending configuration.
 * Hand-written to match the module's models and the project's migration style
 * (see CreateOcrSetting1 / CreatePrescription1).
 */
export class CreateFrameMedia1 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS frame_media_asset (
        id                  TEXT PRIMARY KEY,
        product_handle      TEXT NOT NULL,
        variant_sku         TEXT NOT NULL,
        colorway            TEXT,
        kind                TEXT NOT NULL,
        slot                TEXT,
        status              TEXT NOT NULL DEFAULT 'pending',
        lease_until         TIMESTAMPTZ,
        claimed_by          TEXT,
        source_image_url    TEXT,
        source_fingerprint  TEXT,
        output_key          TEXT,
        output_bytes        INTEGER,
        output_mime         TEXT,
        provider_model      TEXT,
        operation           TEXT,
        billing_unit        TEXT,
        tokens_prompt       INTEGER,
        tokens_output       INTEGER,
        cost_usd            DOUBLE PRECISION,
        receipt             JSONB,
        attempts            INTEGER NOT NULL DEFAULT 0,
        last_error_reason   TEXT,
        last_error_note     TEXT,
        published           BOOLEAN NOT NULL DEFAULT FALSE,
        requested_by        TEXT,
        started_at          TIMESTAMPTZ,
        finished_at         TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at          TIMESTAMPTZ
      );
    `);

    // The idempotency guarantee. Every enqueue path (panel, CLI, scraper) relies
    // on this: ON CONFLICT DO NOTHING is what makes asking twice free.
    //
    // COALESCE(slot, '') rather than the plain column: video and model3d rows have
    // a NULL slot, and in a plain unique index every NULL is distinct from every
    // other, so one frame could accumulate unlimited duplicate video rows — each
    // one a separate $0.80. Postgres 15+ could say NULLS NOT DISTINCT instead;
    // COALESCE has the same effect and no version floor.
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS frame_media_asset_identity_uq
        ON frame_media_asset (variant_sku, kind, COALESCE(slot, ''))
        WHERE deleted_at IS NULL;
    `);

    // Claim path: WHERE status IN (...) ORDER BY kind, product_handle, slot.
    this.addSql(`
      CREATE INDEX IF NOT EXISTS frame_media_asset_claim_idx
        ON frame_media_asset (status, kind, product_handle, slot);
    `);
    // Admin board: everything for one frame.
    this.addSql(`
      CREATE INDEX IF NOT EXISTS frame_media_asset_handle_idx
        ON frame_media_asset (product_handle, kind);
    `);
    // Spend windows: "how much this month", "how much today".
    this.addSql(`
      CREATE INDEX IF NOT EXISTS frame_media_asset_spend_idx
        ON frame_media_asset (finished_at)
        WHERE cost_usd IS NOT NULL;
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS frame_media_budget (
        id                        TEXT PRIMARY KEY,
        tier                      INTEGER NOT NULL DEFAULT 0,
        monthly_ceiling_usd_views DOUBLE PRECISION NOT NULL DEFAULT 15,
        monthly_ceiling_usd_video DOUBLE PRECISION NOT NULL DEFAULT 0,
        daily_ceiling_usd         DOUBLE PRECISION NOT NULL DEFAULT 10,
        max_batch_per_run         INTEGER NOT NULL DEFAULT 8,
        max_concurrency           INTEGER NOT NULL DEFAULT 2,
        video_scope               TEXT NOT NULL DEFAULT 'list',
        video_sku_list            JSONB,
        video_unit                TEXT NOT NULL DEFAULT 'product',
        video_prompt              TEXT,
        image_model_id            TEXT,
        video_model_id            TEXT,
        updated_by                TEXT,
        created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at                TIMESTAMPTZ
      );
    `);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS frame_media_asset;`);
    this.addSql(`DROP TABLE IF EXISTS frame_media_budget;`);
  }
}

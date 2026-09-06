import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260906201424 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "frame_media_asset" ("id" text not null, "product_handle" text not null, "variant_sku" text not null, "colorway" text null, "kind" text check ("kind" in ('view', 'video', 'model3d')) not null, "slot" text check ("slot" in ('front', 'left', 'right', 'back')) null, "status" text check ("status" in ('pending', 'running', 'done', 'failed', 'stale', 'awaiting_external', 'blocked_budget', 'skipped')) not null default 'pending', "lease_until" timestamptz null, "claimed_by" text null, "source_image_url" text null, "source_fingerprint" text null, "output_key" text null, "output_bytes" integer null, "output_mime" text null, "provider_model" text null, "operation" text null, "billing_unit" text check ("billing_unit" in ('tokens', 'seconds')) null, "tokens_prompt" integer null, "tokens_output" integer null, "cost_usd" real null, "receipt" jsonb null, "attempts" integer not null default 0, "last_error_reason" text null, "last_error_note" text null, "published" boolean not null default false, "requested_by" text null, "started_at" timestamptz null, "finished_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "frame_media_asset_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_frame_media_asset_deleted_at" ON "frame_media_asset" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "frame_media_budget" ("id" text not null, "tier" integer not null default 0, "monthly_ceiling_usd_views" real not null default 15, "monthly_ceiling_usd_video" real not null default 0, "daily_ceiling_usd" real not null default 10, "max_batch_per_run" integer not null default 8, "max_concurrency" integer not null default 2, "video_scope" text check ("video_scope" in ('list', 'all')) not null default 'list', "video_sku_list" jsonb null, "video_unit" text check ("video_unit" in ('product', 'colorway')) not null default 'product', "video_prompt" text null, "image_model_id" text null, "video_model_id" text null, "updated_by" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "frame_media_budget_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_frame_media_budget_deleted_at" ON "frame_media_budget" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "frame_media_asset" cascade;`);

    this.addSql(`drop table if exists "frame_media_budget" cascade;`);
  }

}

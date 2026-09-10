import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260910014826 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "ocr_setting" ("id" text not null, "model_id" text not null, "escalation_model_id" text null, "max_image_px" integer not null, "updated_by" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ocr_setting_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ocr_setting_deleted_at" ON "ocr_setting" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ocr_setting" cascade;`);
  }

}

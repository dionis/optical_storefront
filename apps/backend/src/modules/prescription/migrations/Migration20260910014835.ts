import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260910014835 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "prescription" ("id" text not null, "od_sph" real null, "od_cyl" real null, "od_axis" integer null, "od_add" real null, "od_prism" real null, "od_base" text null, "os_sph" real null, "os_cyl" real null, "os_axis" integer null, "os_add" real null, "os_prism" real null, "os_base" text null, "pd" real null, "pd_od" real null, "pd_os" real null, "seg_height" real null, "source" text check ("source" in ('manual', 'ocr')) not null default 'manual', "verified_by_user" boolean not null default false, "file_url" text null, "tryon_image_url" text null, "patient_for" text null, "patient_name" text null, "customer_id" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "prescription_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_prescription_deleted_at" ON "prescription" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "prescription" cascade;`);
  }

}

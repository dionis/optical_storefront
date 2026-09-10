import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260910014816 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "lens_photo_option" drop constraint if exists "lens_photo_option_code_unique";`);
    this.addSql(`alter table if exists "lens_material" drop constraint if exists "lens_material_code_unique";`);
    this.addSql(`alter table if exists "lens_design" drop constraint if exists "lens_design_code_unique";`);
    this.addSql(`alter table if exists "lens_ar_option" drop constraint if exists "lens_ar_option_code_unique";`);
    this.addSql(`create table if not exists "coating_option" ("id" text not null, "type" text check ("type" in ('anti_reflective', 'blue_light', 'photochromic', 'polarized', 'tint')) not null, "label" text not null, "description" text null, "price_modifier_cents" integer not null default 0, "compatible_usage_types" text[] not null default '{}', "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "coating_option_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_coating_option_deleted_at" ON "coating_option" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "lens_ar_option" ("id" text not null, "code" text not null, "label_es" text not null, "label_en" text not null, "ar_group" text not null, "price_cents" integer not null default 0, "sort" integer not null default 0, "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "lens_ar_option_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_lens_ar_option_code_unique" ON "lens_ar_option" ("code") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_lens_ar_option_deleted_at" ON "lens_ar_option" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "lens_base_price" ("id" text not null, "design_code" text not null, "material_code" text not null, "price_cents" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "lens_base_price_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_lens_base_price_deleted_at" ON "lens_base_price" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "lens_design" ("id" text not null, "code" text not null, "category" text not null, "label_es" text not null, "label_en" text not null, "requires_rx" boolean not null default true, "requires_add" boolean not null default false, "sort" integer not null default 0, "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "lens_design_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_lens_design_code_unique" ON "lens_design" ("code") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_lens_design_deleted_at" ON "lens_design" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "lens_material" ("id" text not null, "code" text not null, "label_es" text not null, "label_en" text not null, "desc_es" text null, "desc_en" text null, "max_abs" real not null default 99, "sort" integer not null default 0, "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "lens_material_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_lens_material_code_unique" ON "lens_material" ("code") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_lens_material_deleted_at" ON "lens_material" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "lens_option" ("id" text not null, "usage_type" text check ("usage_type" in ('single_vision_distance', 'single_vision_reading', 'progressive', 'non_prescription')) not null, "index" real not null, "label" text not null, "description" text null, "price_modifier_cents" integer not null default 0, "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "lens_option_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_lens_option_deleted_at" ON "lens_option" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "lens_photo_option" ("id" text not null, "code" text not null, "label_es" text not null, "label_en" text not null, "colors" text[] not null default '{}', "price_sv_cents" integer null, "price_bifocal_cents" integer null, "price_prog_cents" integer null, "sort" integer not null default 0, "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "lens_photo_option_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_lens_photo_option_code_unique" ON "lens_photo_option" ("code") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_lens_photo_option_deleted_at" ON "lens_photo_option" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "lens_treatment_price" ("id" text not null, "design_code" text not null, "material_code" text not null, "treatment_code" text not null, "price_cents" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "lens_treatment_price_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_lens_treatment_price_deleted_at" ON "lens_treatment_price" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "coating_option" cascade;`);

    this.addSql(`drop table if exists "lens_ar_option" cascade;`);

    this.addSql(`drop table if exists "lens_base_price" cascade;`);

    this.addSql(`drop table if exists "lens_design" cascade;`);

    this.addSql(`drop table if exists "lens_material" cascade;`);

    this.addSql(`drop table if exists "lens_option" cascade;`);

    this.addSql(`drop table if exists "lens_photo_option" cascade;`);

    this.addSql(`drop table if exists "lens_treatment_price" cascade;`);
  }

}

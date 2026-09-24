import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Adds the reviewer's phone and the two marketing opt-ins collected in the
 * review confirmation dialog.
 *
 * Purely additive — every column is nullable or carries a default — so it is
 * safe to run against a table that already holds reviews: existing rows get
 * `null` phone and `false` for both opt-ins, which is exactly "no consent on
 * record". `add column if not exists` keeps the migration idempotent.
 */
export class Migration20260916120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "product_review" add column if not exists "author_phone" text null;`);
    this.addSql(`alter table if exists "product_review" add column if not exists "wants_email_updates" boolean not null default false;`);
    this.addSql(`alter table if exists "product_review" add column if not exists "wants_sms_updates" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "product_review" drop column if exists "author_phone";`);
    this.addSql(`alter table if exists "product_review" drop column if exists "wants_email_updates";`);
    this.addSql(`alter table if exists "product_review" drop column if exists "wants_sms_updates";`);
  }

}

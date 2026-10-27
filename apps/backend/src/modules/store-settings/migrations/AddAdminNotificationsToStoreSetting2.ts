import { Migration } from "@mikro-orm/migrations";

/**
 * Adds the multi-administrator notification list and the support inbox.
 *
 * A separate migration rather than an edit to CreateStoreSetting1: that one may
 * already be applied in some environments, and rewriting an applied migration
 * leaves those databases silently missing the columns. `IF NOT EXISTS` keeps it
 * safe to run against a table created either before or after this change.
 *
 * Medusa runs a module's migrations in file-name order, so on an empty database
 * this "Add…" runs BEFORE CreateStoreSetting1. The CREATE TABLE IF NOT EXISTS
 * below repeats that DDL so the table exists first; elsewhere it does nothing.
 * See tests/migration-order.test.ts.
 */
export class AddAdminNotificationsToStoreSetting2 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS store_setting (
        id                        TEXT PRIMARY KEY,
        owner_notification_email  TEXT,
        owner_notification_sms    TEXT,
        active_payment_provider   TEXT,
        frame_tax_rate            TEXT,
        updated_by                TEXT,
        created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at                TIMESTAMPTZ
      );
    `);
    this.addSql(`
      ALTER TABLE store_setting
        ADD COLUMN IF NOT EXISTS admin_notification_emails TEXT,
        ADD COLUMN IF NOT EXISTS support_email             TEXT;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE store_setting
        DROP COLUMN IF EXISTS admin_notification_emails,
        DROP COLUMN IF EXISTS support_email;
    `);
  }
}

import { Migration } from "@mikro-orm/migrations";

/**
 * Adds the multi-administrator notification list and the support inbox.
 *
 * A separate migration rather than an edit to CreateStoreSetting1: that one may
 * already be applied in some environments, and rewriting an applied migration
 * leaves those databases silently missing the columns. `IF NOT EXISTS` keeps it
 * safe to run against a table created either before or after this change.
 */
export class AddAdminNotificationsToStoreSetting2 extends Migration {
  async up(): Promise<void> {
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

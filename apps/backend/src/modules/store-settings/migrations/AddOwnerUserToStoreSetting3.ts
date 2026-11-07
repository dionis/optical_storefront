import { Migration } from "@mikro-orm/migrations";

/**
 * Adds `owner_user_id`: the panel user an ownership transfer named as the
 * store's owner (POST /admin/team/:id/owner, lib/owner-transfer.ts). NULL until
 * the first transfer, and then the owner keeps being decided as before
 * (STORE_OWNER_EMAIL, else the oldest user).
 *
 * File-name order puts this after AddAdminNotificationsToStoreSetting2, which
 * already creates the table on an empty database (tests/migration-order.test.ts).
 */
export class AddOwnerUserToStoreSetting3 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE store_setting ADD COLUMN IF NOT EXISTS owner_user_id TEXT;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE store_setting DROP COLUMN IF EXISTS owner_user_id;`);
  }
}

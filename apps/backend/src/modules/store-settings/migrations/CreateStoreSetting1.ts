import { Migration } from "@mikro-orm/migrations";

/**
 * Runtime store configuration — a single row keyed "default".
 * Hand-written to match the module's model and the project's migration style
 * (see CreateOcrSetting1).
 */
export class CreateStoreSetting1 extends Migration {
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
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS store_setting;`);
  }
}

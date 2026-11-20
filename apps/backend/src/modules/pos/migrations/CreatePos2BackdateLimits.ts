import { Migration } from "@mikro-orm/migrations";

/**
 * How many days back each role may date a sale (lib/sale-date.ts, owner
 * 19-nov-2026: «no solo una semana sino más, en el año»): `pos_setting.backdate_limits`
 * = { seller, manager, supervisor } (0–366 days). NULL = a year for everyone.
 * Named to sort after CreatePos2, which creates pos_setting
 * (tests/migration-order.test.ts). Idempotent.
 */
export class CreatePos2BackdateLimits extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE pos_setting ADD COLUMN IF NOT EXISTS backdate_limits JSONB;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE pos_setting DROP COLUMN IF EXISTS backdate_limits;`);
  }
}

import { Migration } from "@mikro-orm/migrations";

/**
 * Session revocation (lib/session-control.ts): `sessions_revoked_at` set = every
 * JWT issued before it is refused by the staff guard with 401 `session_revoked`
 * on its next /admin request. Written by "cerrar sesión en todos los equipos",
 * by a remote sign-out from Equipo and by every password change. Lives next to
 * `disabled_at` because the guard already reads this row on every request.
 * Named so it sorts after StaffProfileDisabled4 (see tests/migration-order.test.ts).
 */
export class StaffProfileSessions5 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE IF EXISTS staff_profile ADD COLUMN IF NOT EXISTS sessions_revoked_at TIMESTAMPTZ;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE IF EXISTS staff_profile DROP COLUMN IF EXISTS sessions_revoked_at;`);
  }
}

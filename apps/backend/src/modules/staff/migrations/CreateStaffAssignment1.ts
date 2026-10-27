import { Migration } from "@mikro-orm/migrations";

/**
 * Panel roles per user (and, from phase 1, per establishment). Hand-written to
 * match the module's model and the project's migration style (see CreateSeller1).
 *
 * No backfill on purpose: existing admins have no rows, which
 * src/lib/staff-roles.ts resolves to superadmin — the access they already had.
 */
export class CreateStaffAssignment1 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS staff_assignment (
        id                  TEXT PRIMARY KEY,
        user_id             TEXT NOT NULL,
        establishment_id    TEXT,
        role                TEXT NOT NULL CHECK (role IN ('owner', 'superadmin', 'supervisor', 'manager', 'seller')),
        discount_limit_pct  NUMERIC CHECK (discount_limit_pct IS NULL OR (discount_limit_pct >= 0 AND discount_limit_pct <= 100)),
        can_void            BOOLEAN NOT NULL DEFAULT FALSE,
        is_active           BOOLEAN NOT NULL DEFAULT TRUE,
        created_by          TEXT,
        updated_by          TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at          TIMESTAMPTZ
      );
    `);
    // One global row per user, and one row per (user, establishment), among live rows.
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_staff_assignment_user_global" ON "staff_assignment" ("user_id") WHERE establishment_id IS NULL AND deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_staff_assignment_user_establishment" ON "staff_assignment" ("user_id", "establishment_id") WHERE establishment_id IS NOT NULL AND deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_staff_assignment_user_id" ON "staff_assignment" ("user_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_staff_assignment_deleted_at" ON "staff_assignment" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS staff_assignment;`);
  }
}

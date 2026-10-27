import { Migration } from "@mikro-orm/migrations";

/** Insert-only audit log (HU-72). */
export class CreateAuditEvent1 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS audit_event (
        id                TEXT PRIMARY KEY,
        actor_user_id     TEXT,
        establishment_id  TEXT,
        action            TEXT NOT NULL,
        entity            TEXT NOT NULL,
        entity_id         TEXT,
        before            JSONB,
        after             JSONB,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ
      );
    `);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_audit_event_created" ON "audit_event" ("created_at");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_audit_event_entity" ON "audit_event" ("entity", "entity_id");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_audit_event_action" ON "audit_event" ("action", "created_at");`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS audit_event;`);
  }
}

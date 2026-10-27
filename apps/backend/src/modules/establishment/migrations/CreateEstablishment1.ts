import { Migration } from "@mikro-orm/migrations";

/**
 * Physical stores. Hand-written to match the module's model and the project's
 * migration style (see CreateSeller1).
 */
export class CreateEstablishment1 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS establishment (
        id                TEXT PRIMARY KEY,
        code              TEXT NOT NULL,
        name              TEXT NOT NULL,
        address           TEXT,
        phone             TEXT,
        sales_channel_id  TEXT,
        is_active         BOOLEAN NOT NULL DEFAULT TRUE,
        created_by        TEXT,
        updated_by        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ
      );
    `);
    // Codes are never reused, so unique over every row, deleted or not.
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_establishment_code_unique" ON "establishment" ("code");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_establishment_deleted_at" ON "establishment" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS establishment;`);
  }
}

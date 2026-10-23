import { Migration } from "@mikro-orm/migrations";

/**
 * Sellers with a referral code. Hand-written to match the module's model and
 * the project's migration style (see CreateStoreSetting1).
 */
export class CreateSeller1 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS seller (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        email           TEXT,
        phone           TEXT,
        code            TEXT NOT NULL,
        commission_pct  NUMERIC NOT NULL DEFAULT 0,
        active          BOOLEAN NOT NULL DEFAULT TRUE,
        notes           TEXT,
        token_version   INTEGER NOT NULL DEFAULT 1,
        social          JSONB,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at      TIMESTAMPTZ
      );
    `);
    // Unique among live rows only: a soft-deleted seller frees its code.
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_seller_code_unique" ON "seller" ("code") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_seller_deleted_at" ON "seller" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS seller;`);
  }
}

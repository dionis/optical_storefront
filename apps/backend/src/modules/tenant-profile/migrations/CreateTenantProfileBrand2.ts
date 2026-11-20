import { Migration } from "@mikro-orm/migrations";

/**
 * The brand the owner edits from the panel (docs/MULTI-TENANT-TECNICO.md §7.5) and
 * the one before it, for "back to the previous brand". Additive only. Named so it
 * sorts after CreateTenantProfile1 (Medusa runs migrations in file-name order).
 */
export class CreateTenantProfileBrand2 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE tenant_profile ADD COLUMN IF NOT EXISTS brand JSONB;`);
    this.addSql(`ALTER TABLE tenant_profile ADD COLUMN IF NOT EXISTS brand_previous JSONB;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE IF EXISTS tenant_profile DROP COLUMN IF EXISTS brand_previous;`);
    this.addSql(`ALTER TABLE IF EXISTS tenant_profile DROP COLUMN IF EXISTS brand;`);
  }
}

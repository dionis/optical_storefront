import { Migration } from "@mikro-orm/migrations";

/**
 * A store can be THE online store (`kind = 'online'`): the establishment the
 * owner manages the web shop with — its prices, promotions and costs are the
 * web's, and the web's orders are its sales (docs/TIENDA-ONLINE-UNIFICADA.md,
 * lib/online-store.ts).
 *
 *  - The CHECK on `kind` (CreateEstablishmentReceiptNote2) gets the new value.
 *  - The owner already has a store he created for this («Online Optical Store»,
 *    Op4): when exactly ONE active store has "online" in its name and no store
 *    is online yet, it becomes the online store. Any other case is left for
 *    Tiendas → Editar → Tipo, so a guess never picks between two candidates.
 * Idempotent. Sorted after CreateEstablishmentThemeColor5 by file name.
 */
export class CreateEstablishmentOnline6 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE establishment DROP CONSTRAINT IF EXISTS establishment_kind_check;`);
    this.addSql(`ALTER TABLE establishment ADD CONSTRAINT establishment_kind_check CHECK (kind IN ('own', 'family', 'partner', 'consignment', 'online'));`);
    this.addSql(`
      UPDATE establishment SET kind = 'online'
      WHERE deleted_at IS NULL AND is_active = true AND lower(name) LIKE '%online%'
        AND NOT EXISTS (SELECT 1 FROM establishment o WHERE o.deleted_at IS NULL AND o.kind = 'online')
        AND (SELECT count(*) FROM establishment c WHERE c.deleted_at IS NULL AND c.is_active = true AND lower(c.name) LIKE '%online%') = 1;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`UPDATE establishment SET kind = 'own' WHERE kind = 'online';`);
    this.addSql(`ALTER TABLE establishment DROP CONSTRAINT IF EXISTS establishment_kind_check;`);
    this.addSql(`ALTER TABLE establishment ADD CONSTRAINT establishment_kind_check CHECK (kind IN ('own', 'family', 'partner', 'consignment'));`);
  }
}

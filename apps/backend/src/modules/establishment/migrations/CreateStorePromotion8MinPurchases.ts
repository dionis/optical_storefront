import { Migration } from "@mikro-orm/migrations";

/**
 * A promotion for returning patients (owner, 18-nov-2026: «historial de compra
 * por cliente para poder hacer promociones y descuentos»): `min_purchases` =
 * the purchase it starts at («desde la 2.ª compra» = 2: the patient already
 * bought at least once). NULL = everyone. Sorts after CreateStorePromotion8,
 * which creates the table. Idempotent.
 */
export class CreateStorePromotion8MinPurchases extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE store_promotion ADD COLUMN IF NOT EXISTS min_purchases INTEGER;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE store_promotion DROP COLUMN IF EXISTS min_purchases;`);
  }
}

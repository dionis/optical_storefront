import { Migration } from "@mikro-orm/migrations";

/**
 * Store data the documents and the settlement need (functional document E1,
 * HU-104):
 *  - kind: own | family | partner | consignment — what the settlement with the
 *    store depends on (owner's decision still pending; "own" until set).
 *  - receipt_note: the warranty and exchange policy printed on that store's
 *    receipts.
 * Sorted after CreateEstablishment1, which creates the table.
 */
export class CreateEstablishmentReceiptNote2 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE establishment ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'own' CHECK (kind IN ('own', 'family', 'partner', 'consignment'));`);
    this.addSql(`ALTER TABLE establishment ADD COLUMN IF NOT EXISTS receipt_note TEXT;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE establishment DROP COLUMN IF EXISTS receipt_note;`);
    this.addSql(`ALTER TABLE establishment DROP COLUMN IF EXISTS kind;`);
  }
}

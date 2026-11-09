import { Migration } from "@mikro-orm/migrations";

/**
 * The photo of the patient wearing the chosen frame (owner, 9-nov-2026;
 * lib/pos-wearing-photo.ts): taken at the counter before the glasses are made,
 * shown at pickup so the patient can see they are the same frame.
 *  - `wearing_photo_key`: private-bucket key (`poswear/<uuid>.<ext>`), never
 *    sent to the panel, the receipts, the e-mails or the Sheet.
 *  - `wearing_photo_at` / `wearing_photo_by`: when and who took it.
 *  - `wearing_photo_consent_at`: the patient agreed to the photo.
 *
 * Idempotent: every statement tolerates having run before.
 */
export class CreatePos7 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS wearing_photo_key TEXT;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS wearing_photo_at TIMESTAMPTZ;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS wearing_photo_by TEXT;`);
    this.addSql(`ALTER TABLE pos_sale ADD COLUMN IF NOT EXISTS wearing_photo_consent_at TIMESTAMPTZ;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE pos_sale DROP COLUMN IF EXISTS wearing_photo_consent_at;`);
    this.addSql(`ALTER TABLE pos_sale DROP COLUMN IF EXISTS wearing_photo_by;`);
    this.addSql(`ALTER TABLE pos_sale DROP COLUMN IF EXISTS wearing_photo_at;`);
    this.addSql(`ALTER TABLE pos_sale DROP COLUMN IF EXISTS wearing_photo_key;`);
  }
}

import { Migration } from "@mikro-orm/migrations";

/**
 * R2 object key of the AI try-on render (the customer's face wearing the frame)
 * saved from the virtual try-on studio.
 *
 * Same private bucket as `file_url` (the uploaded Rx photo) — health-adjacent
 * personal data, stored server-side only and read back solely through presigned
 * URLs. Nullable: shoppers who don't use the try-on have no image, and rows
 * written before this migration have nothing to backfill.
 */
export class AddTryonImageToPrescription3 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE prescription ADD COLUMN IF NOT EXISTS tryon_image_url TEXT;`);
  }

  async down(): Promise<void> {
    this.addSql(`ALTER TABLE prescription DROP COLUMN IF EXISTS tryon_image_url;`);
  }
}

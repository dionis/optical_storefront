import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Knex } from "@mikro-orm/knex";
import { PRESCRIPTION_MODULE } from "../../../../modules/prescription/index";
import type PrescriptionModuleService from "../../../../modules/prescription/service";
import { loadPrescriptionRecord } from "../../../../lib/prescription-read";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import {
  createStorageClient,
  prescriptionBucket,
  presignPrescriptionUrl,
  storageConfigured,
  PRESCRIPTION_URL_TTL_SECONDS,
} from "../../../../lib/s3";

/**
 * GET /admin/prescriptions/:id
 * Retrieve a single prescription record (admin only).
 * Emits an audit log entry on every access.
 *
 * `prescription.file_url` stays the R2 object key. The scanned document is
 * returned separately as `file_download_url`: a presigned link valid for
 * PRESCRIPTION_URL_TTL_SECONDS. Because the object is fetched from R2 directly,
 * the audit entry below records that a link was *issued*, not that the file was
 * opened — a viewing record would need a proxy route instead.
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const prescriptionService = req.scope.resolve<PrescriptionModuleService>(
    PRESCRIPTION_MODULE
  );

  const { id } = req.params as { id: string };

  // Read with the shared PG connection: the module's generated `retrieve` throws
  // in this project (see lib/prescription-read.ts), which made this route answer
  // 404 for records that exist — including the ones the store's order email now
  // cites by record number.
  const pg = req.scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  const record = await loadPrescriptionRecord(pg, id);
  if (!record) {
    res.status(404).json({ error: "Prescription not found." });
    return;
  }

  const fileDownloadUrl = await presignPrescriptionUrl(
    (record["file_url"] as string | null) ?? null
  );
  // AI try-on render (face with frame) saved from the virtual try-on studio.
  const tryonDownloadUrl = await presignPrescriptionUrl(
    (record["tryon_image_url"] as string | null) ?? null
  );

  // Audit log — log who accessed which prescription record
  console.info(
    JSON.stringify({
      event: "prescription.accessed",
      prescription_id: id,
      admin_user_id: (req as unknown as { auth_context?: { actor_id?: string } }).auth_context?.actor_id ?? "unknown",
      // Never log the URL itself — it is a bearer credential for the file.
      file_url_issued: fileDownloadUrl !== null,
      timestamp: new Date().toISOString(),
    })
  );

  const rxService = req.scope.resolve<PrescriptionModuleService>(PRESCRIPTION_MODULE);
  res.json({
    prescription: rxService.recordToRx(record),
    file_download_url: fileDownloadUrl,
    file_download_expires_in: fileDownloadUrl ? PRESCRIPTION_URL_TTL_SECONDS : null,
    tryon_download_url: tryonDownloadUrl,
    tryon_download_expires_in: tryonDownloadUrl ? PRESCRIPTION_URL_TTL_SECONDS : null,
  });
}

/**
 * DELETE /admin/prescriptions/:id
 * Permanently delete a prescription and its R2 file (GDPR/CCPA compliance).
 */
export async function DELETE(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const prescriptionService = req.scope.resolve<PrescriptionModuleService>(
    PRESCRIPTION_MODULE
  );

  const { id } = req.params as { id: string };

  // Same story as GET: the module's generated methods throw here, so this route
  // answered 404 for every existing record and the erasure never happened. For a
  // GDPR/CCPA path that is not a cosmetic bug — it means "delete my health data"
  // silently did nothing.
  const pg = req.scope.resolve<Knex>(ContainerRegistrationKeys.PG_CONNECTION);
  const record = await loadPrescriptionRecord(pg, id);
  if (!record) {
    res.status(404).json({ error: "Prescription not found." });
    return;
  }

  // Delete R2 files if present — both the uploaded Rx photo and the AI try-on
  // render. Erasing the row without erasing the objects would leave health data
  // in the bucket, which is exactly what "delete my health data" must not do.
  const fileKeys = [
    record["file_url"] as string | null,
    record["tryon_image_url"] as string | null,
  ].filter((k): k is string => Boolean(k));
  if (fileKeys.length && storageConfigured()) {
    const s3 = createStorageClient();
    for (const key of fileKeys) {
      try {
        await s3.send(
          new DeleteObjectCommand({
            // MUST match the bucket the OCR / try-on upload wrote to. This used to
            // read R2_BUCKET — the public assets bucket — so once a dedicated
            // prescription bucket was configured, DeleteObject targeted a key that
            // was never there. S3 answers 204 for a missing key, so the catch
            // below never fired and the health data was silently retained forever.
            Bucket: prescriptionBucket(),
            Key: key,
          })
        );
      } catch (r2Err) {
        console.error("Failed to delete R2 prescription file:", r2Err);
        // Continue with DB deletion regardless — don't block the user's request.
      }
    }
  }

  // Hard delete, matching this route's stated contract (and what
  // `deletePrescriptionRecords` would have done): the record is erased, not
  // flagged. A soft delete would leave the health data in the table.
  await pg("prescription").where({ id }).del();

  // Audit log
  console.info(
    JSON.stringify({
      event: "prescription.deleted",
      prescription_id: id,
      admin_user_id: (req as unknown as { auth_context?: { actor_id?: string } }).auth_context?.actor_id ?? "unknown",
      timestamp: new Date().toISOString(),
    })
  );

  res.json({ id, deleted: true });
}

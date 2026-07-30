import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PRESCRIPTION_MODULE } from "../../../../modules/prescription/index";
import type PrescriptionModuleService from "../../../../modules/prescription/service";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import {
  createStorageClient,
  prescriptionBucket,
  storageConfigured,
} from "../../../../lib/s3";

/**
 * GET /admin/prescriptions/:id
 * Retrieve a single prescription record (admin only).
 * Emits an audit log entry on every access.
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const prescriptionService = req.scope.resolve<PrescriptionModuleService>(
    PRESCRIPTION_MODULE
  );

  const { id } = req.params as { id: string };

  let record: Record<string, unknown>;
  try {
    record = (await prescriptionService.retrievePrescriptionRecord(id)) as Record<string, unknown>;
  } catch {
    res.status(404).json({ error: "Prescription not found." });
    return;
  }

  // Audit log — log who accessed which prescription record
  console.info(
    JSON.stringify({
      event: "prescription.accessed",
      prescription_id: id,
      admin_user_id: (req as unknown as { auth_context?: { actor_id?: string } }).auth_context?.actor_id ?? "unknown",
      timestamp: new Date().toISOString(),
    })
  );

  const rxService = req.scope.resolve<PrescriptionModuleService>(PRESCRIPTION_MODULE);
  res.json({ prescription: rxService.recordToRx(record) });
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

  let record: Record<string, unknown>;
  try {
    record = (await prescriptionService.retrievePrescriptionRecord(id)) as Record<string, unknown>;
  } catch {
    res.status(404).json({ error: "Prescription not found." });
    return;
  }

  // Delete R2 file if present
  const fileUrl = record["file_url"] as string | null;
  if (fileUrl && storageConfigured()) {
    try {
      const s3 = createStorageClient();
      await s3.send(
        new DeleteObjectCommand({
          // MUST match the bucket the OCR route uploaded to. This used to read
          // R2_BUCKET — the public assets bucket — so once a dedicated
          // prescription bucket was configured, DeleteObject targeted a key that
          // was never there. S3 answers 204 for a missing key, so the catch below
          // never fired and the health data was silently retained forever.
          Bucket: prescriptionBucket(),
          Key: fileUrl,
        })
      );
    } catch (r2Err) {
      console.error("Failed to delete R2 prescription file:", r2Err);
      // Continue with DB deletion regardless — don't block the user's deletion request
    }
  }

  await prescriptionService.deletePrescriptionRecords(id);

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

import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import {
  createStorageClient,
  prescriptionBucket,
  storageConfigured,
} from "../../../lib/s3";

/**
 * POST /vision-measure/result
 *
 * Persist ONE finished try-on generation (the frontal render with the glasses
 * on + the measurements we computed) so the shop owner can review every try-on
 * from the admin panel — not only the ones that ended in a prescription.
 *
 * Storage, not a new DB table: the render is an image plus a small JSON blob,
 * and the store already runs an S3-compatible bucket (R2/Supabase) for
 * prescription images. Reusing it keeps this feature free of a schema migration
 * (nothing here can break the backend's boot) while still giving the admin a
 * durable, listable record. Each result is two objects under `tryon/<id>`:
 *   • `tryon/<id>.<ext>`  — the frontal render (only when the client sent bytes)
 *   • `tryon/<id>.json`   — the metadata manifest the admin list reads back
 *
 * This is a custom (non-/store) route, so it needs no publishable key — the same
 * as the rest of `/vision-measure`. It is best-effort by design: a failure here
 * must never break the customer's try-on, so the storefront fires it and forgets.
 */

const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // 6 MB — renders are JPEG, well under this.

const asStr = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** Split a `data:image/…;base64,…` URL into bytes + content type. */
function parseDataUrl(
  value: string
): { buffer: Buffer; contentType: string } | null {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(value);
  if (!m) return null;
  try {
    return { buffer: Buffer.from(m[2], "base64"), contentType: m[1] };
  } catch {
    return null;
  }
}

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const frontImage = typeof body.front_image === "string" ? body.front_image : "";

  // No storage configured → accept-and-ignore. The client treats this as a
  // best-effort call and must not surface an error to the shopper.
  if (!storageConfigured()) {
    res.json({ stored: false, reason: "storage_not_configured" });
    return;
  }

  const id = randomUUID();
  const s3 = createStorageClient();
  const bucket = prescriptionBucket();

  // The render can arrive two ways: as base64 bytes (we upload them and serve a
  // presigned link later) or as an http(s) URL already hosted elsewhere (we
  // keep the reference, no re-upload).
  let imageKey: string | null = null;
  let imageUrl: string | null = null;

  const parsed = frontImage ? parseDataUrl(frontImage) : null;
  if (parsed) {
    if (parsed.buffer.length > MAX_IMAGE_BYTES) {
      res.status(413).json({ error_code: "image_too_large", error: "Render exceeds the size limit." });
      return;
    }
    const ext = (parsed.contentType.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "") || "jpg";
    imageKey = `tryon/${id}.${ext}`;
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: imageKey,
          Body: parsed.buffer,
          ContentType: parsed.contentType,
        })
      );
    } catch {
      res.status(503).json({ error_code: "storage_error", error: "Could not store the render.", stored: false });
      return;
    }
  } else if (/^https?:\/\//i.test(frontImage)) {
    imageUrl = frontImage;
  }

  const measurements =
    body.measurements && typeof body.measurements === "object"
      ? (body.measurements as Record<string, unknown>)
      : {};

  const manifest = {
    id,
    created_at: new Date().toISOString(),
    product_id: asStr(body.product_id),
    product_name: asStr(body.product_name),
    brand: asStr(body.brand),
    sku: asStr(body.sku),
    color_name: asStr(body.color_name),
    for_whom: asStr(body.for_whom),
    patient_name: asStr(body.patient_name),
    measurements,
    image_key: imageKey, // presigned on read
    image_url: imageUrl, // external, used as-is on read
  };

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `tryon/${id}.json`,
        Body: Buffer.from(JSON.stringify(manifest)),
        ContentType: "application/json",
      })
    );
  } catch {
    res.status(503).json({ error_code: "storage_error", error: "Could not store the manifest.", stored: false });
    return;
  }

  res.json({ stored: true, id });
}

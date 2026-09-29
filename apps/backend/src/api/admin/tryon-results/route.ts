import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import {
  createStorageClient,
  prescriptionBucket,
  storageConfigured,
  presignPrescriptionUrl,
} from "../../../lib/s3";

/**
 * GET /admin/tryon-results — every AI try-on render, newest first, for the
 * shop-owner panel. Authentication is Medusa's: everything under /admin needs a
 * logged-in user.
 *
 * The records live as `tryon/<id>.json` manifests in the S3 bucket (written by
 * POST /vision-measure/result). We list the manifests, read each one, and mint a
 * short-lived presigned link for its stored render so the private bucket never
 * has to be made public. External renders (already-hosted URLs) are returned
 * as-is.
 */

async function bodyToString(body: unknown): Promise<string> {
  if (!body) return "";
  const maybe = body as { transformToString?: () => Promise<string> };
  if (typeof maybe.transformToString === "function") {
    return await maybe.transformToString();
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  if (!storageConfigured()) {
    res.json({ results: [], total: 0, storage_configured: false });
    return;
  }

  const query = req.query as Record<string, string | undefined>;
  const limit = Math.min(Math.max(Number(query.limit ?? 60) || 60, 1), 200);

  const s3 = createStorageClient();
  const bucket = prescriptionBucket();

  try {
    const list = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: "tryon/", MaxKeys: 1000 })
    );
    const manifestKeys = (list.Contents ?? [])
      .map((o) => o.Key ?? "")
      .filter((k) => k.endsWith(".json"));

    type Manifest = {
      id?: string;
      created_at?: string;
      image_key?: string | null;
      image_url?: string | null;
      [k: string]: unknown;
    };

    const results: Array<Record<string, unknown>> = [];
    for (const key of manifestKeys) {
      try {
        const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const manifest = JSON.parse(await bodyToString(obj.Body)) as Manifest;
        const image_url =
          manifest.image_url ??
          (manifest.image_key ? await presignPrescriptionUrl(manifest.image_key) : null);
        const { image_key: _drop, ...rest } = manifest;
        results.push({ ...rest, image_url });
      } catch {
        // Skip an unreadable or malformed manifest rather than failing the page.
      }
    }

    results.sort((a, b) =>
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
    );

    res.json({
      results: results.slice(0, limit),
      total: results.length,
      storage_configured: true,
    });
  } catch {
    res.status(503).json({
      error_code: "storage_error",
      error: "Could not list try-on results.",
    });
  }
}

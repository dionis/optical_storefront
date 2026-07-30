import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Shared S3 client construction for the object-storage backends we support
 * (Cloudflare R2, Supabase Storage, MinIO, Garage).
 *
 * The config was previously inlined at each call site, which let the settings
 * drift apart — one route hardcoded `region: "auto"` and ignored R2_REGION, and
 * neither route forced path-style addressing.
 */
export function createStorageClient(): S3Client {
  return new S3Client({
    // Cloudflare R2 wants the literal "auto"; Supabase Storage and most other
    // providers sign SigV4 with the real region and reject "auto".
    region: process.env.R2_REGION ?? "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    },
    // Path-style (host/bucket/key) rather than virtual-hosted (bucket.host/key).
    // Providers other than AWS rarely hold a wildcard certificate for bucket
    // subdomains — Supabase Storage fails the TLS handshake outright — while R2,
    // MinIO and Garage all accept path-style.
    forcePathStyle: true,
  });
}

/**
 * Bucket holding prescription images. These are health data, so they must never
 * share the public assets bucket; the R2_BUCKET fallback exists only so a
 * single-bucket dev setup keeps working.
 *
 * Read this from one place: the upload path and the delete path used to resolve
 * the bucket differently, so deletions silently missed the stored object.
 */
export function prescriptionBucket(): string {
  return (
    process.env.R2_PRESCRIPTION_BUCKET ??
    process.env.R2_BUCKET ??
    "eyewear-assets"
  );
}

/** True when the storage backend has everything it needs to be reachable. */
export function storageConfigured(): boolean {
  return Boolean(
    process.env.R2_ENDPOINT &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY
  );
}

/** Lifetime of a prescription download link, in seconds. */
export const PRESCRIPTION_URL_TTL_SECONDS = 15 * 60;

/**
 * Mint a short-lived download link for a stored prescription file.
 *
 * The prescription bucket is private, so this is the only way to read an object
 * back — the alternative would be making the bucket public, which would put
 * health data behind nothing but an unguessable key.
 *
 * The returned URL carries our credentials' authority for its whole lifetime:
 * anyone holding it can fetch the file with no further authentication. Treat it
 * as a bearer token — hand it straight to the requesting admin, and never log
 * it, email it, or persist it.
 *
 * Returns null when storage is not configured or the record has no file.
 */
export async function presignPrescriptionUrl(
  objectKey: string | null,
  ttlSeconds: number = PRESCRIPTION_URL_TTL_SECONDS
): Promise<string | null> {
  if (!objectKey || !storageConfigured()) return null;
  try {
    return await getSignedUrl(
      createStorageClient(),
      new GetObjectCommand({ Bucket: prescriptionBucket(), Key: objectKey }),
      { expiresIn: ttlSeconds }
    );
  } catch {
    // Signing is local (no network round-trip), so a failure here means a
    // misconfigured client rather than an unreachable object. Non-fatal: the
    // caller still gets the record, just without a download link.
    return null;
  }
}

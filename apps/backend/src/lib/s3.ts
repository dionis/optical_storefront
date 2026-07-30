import { S3Client } from "@aws-sdk/client-s3";

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

/**
 * Private-bucket helpers for the images that travel with an order: the AI try-on
 * render (face with the frame) and the uploaded prescription photo.
 *
 * Both live in the private prescription bucket. Writes come from the storefront
 * as `data:` URLs; reads happen server-side only (the order emails attach the
 * bytes), so no presigned link — a bearer token — ever leaves the backend.
 */
import { randomUUID } from "crypto";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createStorageClient, prescriptionBucket, storageConfigured } from "./s3";

/** Largest render accepted from the client. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Object keys this backend writes for try-on renders: `tryon/<uuid>.<ext>`. */
export const TRYON_KEY_PATTERN = /^tryon\/[A-Za-z0-9-]{1,64}\.[a-z0-9]{1,8}$/;

/**
 * Uploads the AI try-on render (a `data:` URL from the virtual try-on studio) to
 * the private prescription bucket and returns its key, or null when there is
 * nothing to store or storage is not configured. Best-effort: a storage hiccup
 * must never fail the write it rides along with.
 */
export async function uploadTryonImage(dataUrl: unknown): Promise<string | null> {
  return uploadPrivateImage(dataUrl, "tryon");
}

/** Object keys of the photos of frames a point-of-sale customer brings: `posframe/<uuid>.<ext>`. */
export const POS_FRAME_KEY_PATTERN = /^posframe\/[A-Za-z0-9-]{1,64}\.[a-z0-9]{1,8}$/;

/**
 * Same upload under another key prefix (`tryon`, `posframe`). Best-effort, like
 * uploadTryonImage: null when there is nothing to store or storage fails.
 */
export async function uploadPrivateImage(dataUrl: unknown, prefix: "tryon" | "posframe"): Promise<string | null> {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:") || !storageConfigured()) {
    return null;
  }
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) return null;
  const mediaType = match[1];
  const buffer = Buffer.from(match[2], "base64");
  // Guard against an oversized payload slipping past the body limit.
  if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) return null;
  const ext = (mediaType.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";
  const objectKey = `${prefix}/${randomUUID()}.${ext}`;
  try {
    await createStorageClient().send(
      new PutObjectCommand({
        Bucket: prescriptionBucket(),
        Key: objectKey,
        Body: buffer,
        ContentType: mediaType,
        // No ACL — private bucket, read back only server-side or via presigned URLs.
      })
    );
    return objectKey;
  } catch {
    return null;
  }
}

export interface PrivateObject {
  buffer: Buffer;
  contentType: string;
}

/** Reads one object from the private bucket. Null when missing or unreachable. */
export async function readPrivateObject(objectKey: string | null | undefined): Promise<PrivateObject | null> {
  if (!objectKey || !storageConfigured()) return null;
  try {
    const obj = await createStorageClient().send(
      new GetObjectCommand({ Bucket: prescriptionBucket(), Key: objectKey })
    );
    const bytes = await obj.Body?.transformToByteArray();
    if (!bytes?.length) return null;
    return {
      buffer: Buffer.from(bytes),
      contentType: obj.ContentType || guessContentType(objectKey),
    };
  } catch {
    return null;
  }
}

function guessContentType(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic") return "image/heic";
  return "image/jpeg";
}

import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IFileModuleService, Logger } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { absoluteImageUrl, catalogUploadKey } from "../../../../lib/image-url";
import { matrixAccess } from "../../../../lib/price-matrix-route";

/**
 * POST /admin/catalog/uploads (multipart, field `file`) → 201 { url }
 *
 * v2 (docs/PRICE-MATRIX.md «Archivos»): one image for «Productos y precios» —
 * a brand logo (`POST /admin/catalog/brands[/:slug]` `logo_url`) or a model
 * photo (`images[]` / a colour's `image` of `POST /admin/catalog/frames[/:id]`).
 * JPEG / PNG / WEBP up to 8 MB, checked by the multer middleware
 * (`catalogUpload`, src/api/middlewares.ts: 415 `unsupported_media_type`,
 * 413 `file_too_large`).
 *
 * Stored through Medusa's file module, exactly like the review photos
 * (src/api/store/product-review-photos/route.ts): the PUBLIC assets bucket
 * (R2 / S3-compatible) when it is configured, the local disk otherwise —
 * never the private prescription bucket. `url` is absolute (lib/image-url.ts).
 *
 * Owner and superadmin only. Reasons: `forbidden_role` (403), `file_required`
 * (400), `upload_failed` (503).
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  const access = await matrixAccess(req);
  if (!access.isAdmin) {
    res.status(403).json({ type: "not_allowed", reason: "forbidden_role", message: "Only the owner or a superadmin can upload catalogue images." });
    return;
  }
  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file || !file.buffer?.length) {
    res.status(400).json({ type: "invalid_data", reason: "file_required", message: "Send one image in the `file` field." });
    return;
  }
  try {
    const files = req.scope.resolve<IFileModuleService>(Modules.FILE);
    const [stored] = await files.createFiles([
      {
        filename: catalogUploadKey(file.originalname),
        mimeType: file.mimetype,
        // Base64, never "binary": Medusa 2.17's file providers (local and S3/R2)
        // decode the content as base64 and fall back to UTF-8, so a "binary"
        // (latin1) string reached the disk/bucket with every byte ≥ 0x80
        // re-encoded as two — a corrupt PNG/JPEG (QA v2, 7-nov-2026).
        content: file.buffer.toString("base64"),
        access: "public" as const,
      },
    ]);
    const url = absoluteImageUrl(stored?.url ?? null);
    if (!url) throw new Error("the file module returned no url");
    logger.info(`[catalog] image uploaded (${file.mimetype}, ${file.size} bytes) by ${access.actorId ?? "?"}`);
    res.status(201).json({ url });
  } catch (error) {
    logger.error(`[catalog] upload failed: ${(error as Error).message}`);
    res.status(503).json({ type: "error", reason: "upload_failed", message: "Could not store the image." });
  }
}

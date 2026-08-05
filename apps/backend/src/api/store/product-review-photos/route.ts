import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { IFileModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

/**
 * POST /store/product-review-photos — upload the photos attached to a review.
 *
 * Separate from creating the review so the two failure modes stay separate: a
 * photo that will not upload must not cost the customer the words they wrote.
 * The storefront uploads first and passes the returned URLs to the review.
 *
 * These go to the PUBLIC assets bucket, unlike prescriptions — a review photo
 * is meant to be seen by other shoppers. Nothing here touches the private
 * prescription bucket.
 */

const MAX_PHOTOS = 3;

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const files = (req as unknown as { files?: Express.Multer.File[] }).files ?? [];

  if (!files.length) {
    res.status(400).json({ error_code: "file_required", error: "At least one image is required." });
    return;
  }

  const fileModule = req.scope.resolve<IFileModuleService>(Modules.FILE);

  try {
    const uploaded = await fileModule.createFiles(
      files.slice(0, MAX_PHOTOS).map((file) => ({
        filename: `reviews/${Date.now()}-${file.originalname}`,
        mimeType: file.mimetype,
        content: file.buffer.toString("binary"),
        access: "public" as const,
      }))
    );

    res.status(201).json({ urls: uploaded.map((f) => f.url) });
  } catch (error) {
    // Losing a photo must not look like the review itself failed.
    res.status(503).json({
      error_code: "upload_failed",
      error: `Could not store the images: ${(error as Error).message}`,
    });
  }
}

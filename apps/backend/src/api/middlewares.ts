import { defineMiddlewares } from "@medusajs/medusa";
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import multer from "multer";
import { ocrRateLimit } from "./store/prescriptions/ocr/rate-limit";
import { ocrSettingsMiddlewares } from "./admin/ocr-settings/middlewares";
import { orderAccessRateLimit } from "./store/order-access/rate-limit";

/**
 * Medusa ships `GET /store/orders/:id` with NO authentication — its own source
 * carries the comment "TODO: Do we want to apply some sort of authentication
 * here? My suggestion is that we do". Anyone holding the publishable key and an
 * order id gets the full order back, and ours reference `prescription_id` on
 * their line items, which is health data. We serve order tracking through
 * `/store/my-orders` (signed token, scoped to one email) instead, so this route
 * has no legitimate caller from our storefront and is closed off entirely.
 */
function blockUnauthenticatedOrderRetrieve(
  _req: MedusaRequest,
  res: MedusaResponse,
  _next: MedusaNextFunction
): void {
  res.status(404).json({
    type: "not_found",
    message: "Order not found.",
  });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    // Keep in sync with ACCEPTED_IMAGE_TYPES / PDF_MEDIA_TYPE in
    // src/api/store/prescriptions/ocr/route.ts.
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "application/pdf",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten imágenes (JPEG, PNG, WEBP, GIF) o PDF."));
    }
  },
});

export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/prescriptions/ocr",
      method: ["POST"],
      // Rate limit runs before multer so a flood is rejected without buffering
      // 10 MB per request into memory first.
      middlewares: [ocrRateLimit, upload.single("file")],
    },
    {
      matcher: "/store/orders/:id",
      method: ["GET"],
      middlewares: [blockUnauthenticatedOrderRetrieve],
    },
    {
      // Magic-link requests are the one unauthenticated write in this feature:
      // rate limited so the endpoint can't be used to blast mail at an address.
      matcher: "/store/order-access/request",
      method: ["POST"],
      middlewares: [orderAccessRateLimit],
    },
    {
      matcher: "/store/order-support",
      method: ["POST"],
      middlewares: [orderAccessRateLimit],
    },
    ...ocrSettingsMiddlewares,
  ],
});

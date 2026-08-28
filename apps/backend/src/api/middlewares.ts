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

const OCR_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: OCR_MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    // Keep in sync with ACCEPTED_IMAGE_TYPES / PDF_MEDIA_TYPE in
    // src/api/store/prescriptions/ocr/route.ts.
    //
    // HEIC/HEIF earn their place here even though sharp may not decode them:
    // it is what an iPhone hands over from the photo library, and rejecting it
    // at the door meant the request never reached the route — the storefront
    // just showed "we couldn't read it" while the prescription fields sat at
    // 0.00. The storefront now re-encodes to JPEG before uploading, so this is
    // the safety net for a browser that could not; the route reports a proper
    // reason if the decode then fails.
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/heic",
      "image/heif",
      "application/pdf",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new UnsupportedUploadError(file.mimetype));
    }
  },
});

/** Marker so the handler below can tell a rejected type from a real crash. */
class UnsupportedUploadError extends Error {
  constructor(public readonly mimetype: string) {
    super(`Unsupported upload media type: ${mimetype}`);
    this.name = "UnsupportedUploadError";
  }
}

/**
 * Turns multer's rejections into the same coded JSON the routes return.
 *
 * Returns false when the error is not one of ours, so the caller can forward it.
 */
function respondToUploadError(
  err: unknown,
  res: MedusaResponse,
  opts: { unsupportedMessage: string; tooLargeMessage: string }
): boolean {
  if (err instanceof UnsupportedUploadError) {
    res.status(415).json({
      error_code: "unsupported_media_type",
      error: opts.unsupportedMessage,
    });
    return true;
  }
  // multer tags its own failures with a `code`; LIMIT_FILE_SIZE is the only one
  // reachable here, and it is the common one on a modern phone camera.
  if (err && typeof err === "object" && (err as { code?: string }).code === "LIMIT_FILE_SIZE") {
    res.status(413).json({
      error_code: "file_too_large",
      error: opts.tooLargeMessage,
    });
    return true;
  }
  return false;
}

/**
 * Runs multer and converts its rejections into coded JSON.
 *
 * This deliberately does NOT use Express's four-argument error-handler form.
 * Medusa passes every entry in `defineMiddlewares` through `wrapHandler`, which
 * returns a three-argument function — so Express never classifies a four-arg
 * middleware as an error handler and calls it in the normal chain instead. The
 * arguments then land shifted (`err` receives the request, `next` receives
 * nothing), `next(err)` throws `TypeError: next is not a function`, and EVERY
 * request to the route dies as an opaque 500, upload or not. Calling multer
 * directly and handling its callback keeps the arity at three.
 */
function ocrUpload(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void {
  upload.single("file")(req as never, res as never, (err: unknown) => {
    if (!err) return next();
    if (
      respondToUploadError(err, res, {
        unsupportedMessage:
          "Unsupported media type. Send a JPEG, PNG, WEBP, GIF, HEIC or PDF.",
        tooLargeMessage: `File exceeds the ${Math.round(
          OCR_MAX_FILE_SIZE_BYTES / (1024 * 1024)
        )} MB limit.`,
      })
    ) {
      return;
    }
    next(err);
  });
}

const REVIEW_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** Uploads for review photos: public images only, and small ones. */
const reviewPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: REVIEW_PHOTO_MAX_BYTES, files: 3 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new UnsupportedUploadError(file.mimetype));
  },
});

/** Same three-argument shape as `ocrUpload`, and for the same reason. */
function reviewPhotosUpload(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void {
  reviewPhotoUpload.array("files", 3)(req as never, res as never, (err: unknown) => {
    if (!err) return next();
    if (
      respondToUploadError(err, res, {
        unsupportedMessage: "Review photos must be JPEG, PNG or WEBP.",
        tooLargeMessage: `Each photo must be under ${Math.round(
          REVIEW_PHOTO_MAX_BYTES / (1024 * 1024)
        )} MB.`,
      })
    ) {
      return;
    }
    next(err);
  });
}

export default defineMiddlewares({
  routes: [
    {
      // Two photos travel here as base64 data URLs (JSON, not multipart) — the
      // client caps each at 1568px/JPEG q0.9, but that still runs well past
      // Medusa's default JSON body limit for a single request.
      matcher: "/vision-measure",
      method: ["POST"],
      bodyParser: { sizeLimit: "10mb" },
    },
    {
      // The async job route carries the same two base64 photos as the sync route,
      // so it needs the same raised JSON body limit.
      matcher: "/vision-measure/job",
      method: ["POST"],
      bodyParser: { sizeLimit: "10mb" },
    },
    {
      matcher: "/store/prescriptions/ocr",
      method: ["POST"],
      // Rate limit runs before multer so a flood is rejected without buffering
      // 10 MB per request into memory first. `ocrUpload` runs multer and owns
      // its error reporting — see the note on its definition.
      middlewares: [ocrRateLimit, ocrUpload],
    },
    {
      // Review photos are ordinary public images — a much tighter allowlist
      // than the prescription upload, since there is no camera-format problem
      // to accommodate here and these are served to every visitor.
      matcher: "/store/product-review-photos",
      method: ["POST"],
      middlewares: [reviewPhotosUpload],
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
    {
      // Self-cancellation moves money and sends mail. The session token already
      // gates it, but the same per-IP ceiling keeps a leaked token from being
      // used to hammer the payment provider with refund calls.
      matcher: "/store/my-orders/:id/cancel",
      method: ["POST"],
      middlewares: [orderAccessRateLimit],
    },
    ...ocrSettingsMiddlewares,
  ],
});

import { defineMiddlewares } from "@medusajs/medusa";
import multer from "multer";

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
      middlewares: [upload.single("file")],
    },
  ],
});

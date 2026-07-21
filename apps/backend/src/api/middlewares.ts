import { defineMiddlewares } from "@medusajs/medusa";
import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten imágenes (JPEG, PNG, WEBP)."));
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

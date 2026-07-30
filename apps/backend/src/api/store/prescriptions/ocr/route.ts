import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import Anthropic from "@anthropic-ai/sdk";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import {
  createStorageClient,
  prescriptionBucket,
  storageConfigured,
} from "../../../../lib/s3";
import { PRESCRIPTION_MODULE } from "../../../../modules/prescription/index";
import type PrescriptionModuleService from "../../../../modules/prescription/service";
import type { Prescription } from "@eyewear/shared";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Media types accepted for a prescription upload. Must stay in sync with the
 * multer allowlist in `src/api/middlewares.ts` and with the `accept` attribute
 * of the storefront file input — a type accepted by one and rejected by another
 * shows up as an opaque failure at a different layer each time.
 *
 * Images go to the vision API as an `image` block; PDFs as a `document` block.
 */
// `as const` keeps this a non-widening literal — without it the media_type in
// the document block below widens to `string` and fails the SDK's union.
const PDF_MEDIA_TYPE = "application/pdf" as const;
const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;
type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];
type AcceptedMediaType = AcceptedImageType | typeof PDF_MEDIA_TYPE;

const isAcceptedImageType = (value: string): value is AcceptedImageType =>
  (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(value);

const isAcceptedMediaType = (value: string): value is AcceptedMediaType =>
  value === PDF_MEDIA_TYPE || isAcceptedImageType(value);

/**
 * The response shape is enforced by the API through `output_config.format`
 * below, so the prompt only carries the optometry domain rules — it does not
 * need to beg for "JSON only, no markdown".
 */
const OCR_SYSTEM_PROMPT = `You are a prescription data extraction assistant.
Extract optical prescription data from the provided document.
If the document has several pages, use the page holding the prescription table.

Conventions:
- OD is the right eye (oculus dexter), OS is the left eye (oculus sinister).
- SPH of "PL", "DS" or "Plano" means 0.00.
- AXIS is an integer in degrees, 1-180.
- PD is the pupillary distance in millimetres. Use "pd" when a single value is
  written, and "pd_od"/"pd_os" when the prescription gives one value per eye.
- Never guess: if a field is absent, ambiguous or illegible, return null for it.`;

/** JSON Schema mirroring the shared `Prescription` type (structured outputs). */
const NULLABLE_NUMBER = { anyOf: [{ type: "number" }, { type: "null" }] };
const NULLABLE_STRING = { anyOf: [{ type: "string" }, { type: "null" }] };
const EYE_SCHEMA = {
  type: "object",
  properties: {
    sph: NULLABLE_NUMBER,
    cyl: NULLABLE_NUMBER,
    axis: NULLABLE_NUMBER,
    add: NULLABLE_NUMBER,
    prism: NULLABLE_NUMBER,
    base: NULLABLE_STRING,
  },
  required: ["sph", "cyl", "axis", "add", "prism", "base"],
  additionalProperties: false,
};
const PRESCRIPTION_SCHEMA = {
  type: "object",
  properties: {
    od: EYE_SCHEMA,
    os: EYE_SCHEMA,
    pd: NULLABLE_NUMBER,
    pd_od: NULLABLE_NUMBER,
    pd_os: NULLABLE_NUMBER,
  },
  required: ["od", "os", "pd", "pd_od", "pd_os"],
  additionalProperties: false,
};

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  // File is available via multer or Medusa's built-in file handling
  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) {
    res.status(400).json({ error: "Se requiere un archivo de imagen." });
    return;
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    res.status(400).json({ error: "El archivo excede el límite de 10 MB." });
    return;
  }

  if (!isAcceptedMediaType(file.mimetype)) {
    res.status(400).json({
      error: "Formato no soportado. Sube una imagen (JPEG, PNG, WEBP, GIF) o un PDF.",
    });
    return;
  }
  const mediaType: AcceptedMediaType = file.mimetype;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Graceful fallback: return empty prescription, let user fill manually
    res.status(503).json({
      error: "OCR no disponible. Por favor ingresa tu receta manualmente.",
      fallback: true,
    });
    return;
  }

  // ── Upload to R2 (PHI compliance) ──────────────────────────────────────
  let fileUrl: string | null = null;
  if (storageConfigured()) {
    const ext = mediaType.split("/")[1];
    const objectKey = `rx/${randomUUID()}.${ext}`;
    try {
      const s3 = createStorageClient();
      await s3.send(
        new PutObjectCommand({
          Bucket: prescriptionBucket(),
          Key: objectKey,
          Body: file.buffer,
          ContentType: mediaType,
          // No ACL — bucket is private, access via presigned URLs only
        })
      );
      fileUrl = objectKey; // store key, not public URL
    } catch {
      // Non-fatal: OCR can proceed without storage
    }
  }

  const base64Data = file.buffer.toString("base64");
  const client = new Anthropic({ apiKey });

  // A PDF rides a `document` block, an image an `image` block. Either way it
  // must precede the text block in the content array.
  const sourceBlock = isAcceptedImageType(mediaType)
    ? {
        type: "image" as const,
        source: { type: "base64" as const, media_type: mediaType, data: base64Data },
      }
    : {
        type: "document" as const,
        source: { type: "base64" as const, media_type: PDF_MEDIA_TYPE, data: base64Data },
      };

  let rawJson: string;
  try {
    const message = await client.beta.messages.create({
      model: "claude-opus-5",
      // Thinking is on by default on this model and `max_tokens` caps thinking
      // plus response together, so this is far above the size of the JSON.
      max_tokens: 8192,
      // Safety classifiers occasionally decline benign health-adjacent images;
      // "default" re-runs the request on Anthropic's recommended fallback model
      // instead of handing us a refusal.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: OCR_SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", schema: PRESCRIPTION_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            sourceBlock,
            {
              type: "text",
              text: "Extract the prescription data from this document.",
            },
          ],
        },
      ],
    });

    if (message.stop_reason === "refusal") {
      res.status(422).json({
        error:
          "No se pudo leer la receta automáticamente. Por favor ingrésala manualmente.",
        fallback: true,
      });
      return;
    }

    // Thinking blocks come first in `content`, so the answer is never at [0].
    const textBlock = message.content.find((block) => block.type === "text");
    rawJson = textBlock?.text ?? "";
  } catch (err: unknown) {
    const isRateLimit =
      err instanceof Anthropic.RateLimitError ||
      (err instanceof Error && err.message.includes("rate_limit"));
    res.status(503).json({
      error: isRateLimit
        ? "Servicio OCR temporalmente no disponible. Por favor ingresa tu receta manualmente."
        : "No se pudo procesar la imagen. Por favor ingresa tu receta manualmente.",
      fallback: true,
    });
    return;
  }

  // Structured outputs guarantee the shape, but a truncated response would
  // still leave us with unparseable text.
  let extracted: Partial<Prescription>;
  try {
    extracted = JSON.parse(rawJson) as Partial<Prescription>;
  } catch {
    res.status(422).json({
      error:
        "No se pudo leer la receta automáticamente. Por favor ingrésala manualmente.",
      fallback: true,
    });
    return;
  }

  // Build a Prescription with source=ocr and verified_by_user=false
  const prescription: Prescription = {
    od: {
      sph: extracted.od?.sph ?? null,
      cyl: extracted.od?.cyl ?? null,
      axis: extracted.od?.axis ?? null,
      add: extracted.od?.add ?? null,
      prism: extracted.od?.prism ?? null,
      base: extracted.od?.base ?? null,
    },
    os: {
      sph: extracted.os?.sph ?? null,
      cyl: extracted.os?.cyl ?? null,
      axis: extracted.os?.axis ?? null,
      add: extracted.os?.add ?? null,
      prism: extracted.os?.prism ?? null,
      base: extracted.os?.base ?? null,
    },
    pd: extracted.pd ?? null,
    pd_od: extracted.pd_od ?? null,
    pd_os: extracted.pd_os ?? null,
    source: "ocr",
    verified_by_user: false, // MUST be confirmed by human before checkout
    file_url: fileUrl,
  };

  const prescriptionService = req.scope.resolve<PrescriptionModuleService>(
    PRESCRIPTION_MODULE
  );
  const validation = prescriptionService.validate(prescription);

  res.json({
    prescription,
    validation,
    message:
      "Por favor revisa y confirma que los valores extraídos son correctos antes de continuar.",
  });
}

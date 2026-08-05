import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import Anthropic from "@anthropic-ai/sdk";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import {
  createStorageClient,
  prescriptionBucket,
  storageConfigured,
} from "../../../../lib/s3";
import { downscaleForOcr } from "../../../../lib/image-downscale";
import { resolveOcrSettings } from "../../../../lib/ocr-settings";
import { getOcrModel } from "../../../../lib/ocr-models";
import { PRESCRIPTION_MODULE } from "../../../../modules/prescription/index";
import type PrescriptionModuleService from "../../../../modules/prescription/service";
import type { Prescription, PrescriptionValidationResult } from "@eyewear/shared";

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

/**
 * Formats we accept on the way IN but cannot forward to the vision API.
 *
 * HEIC/HEIF is what an iPhone hands over from its photo library. The API takes
 * none of it, so it has to be transcoded first — `downscaleForOcr` does that
 * whenever sharp was built with HEIF support. We accept it at the door anyway
 * because refusing it outright is what produced the dead end this fixes: the
 * upload failed before the route ran and the funnel showed a generic error with
 * every prescription field still at 0.00.
 */
const TRANSCODE_ONLY_TYPES = ["image/heic", "image/heif"] as const;

const isTranscodeOnlyType = (value: string): boolean =>
  (TRANSCODE_ONLY_TYPES as readonly string[]).includes(value);

const isAcceptedMediaType = (value: string): boolean =>
  value === PDF_MEDIA_TYPE || isAcceptedImageType(value) || isTranscodeOnlyType(value);

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

type SourceBlock =
  | { type: "image"; source: { type: "base64"; media_type: AcceptedImageType; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: typeof PDF_MEDIA_TYPE; data: string } };

/** Runs one extraction attempt against a specific model. */
async function readWithModel(
  client: Anthropic,
  modelId: string,
  sourceBlock: SourceBlock
): Promise<Partial<Prescription> | null> {
  // Safety classifiers occasionally decline benign health-adjacent images;
  // `fallbacks` re-runs the request on a substitute model instead of handing us
  // a refusal. Only some models accept the parameter — sending it to one that
  // does not is a hard 400, which would break every read on that model, so it
  // is gated on the catalogue rather than sent unconditionally.
  const fallbackParams = getOcrModel(modelId)?.supports_fallbacks
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : {};

  const message = await client.beta.messages.create({
    model: modelId,
    // On the thinking-enabled models max_tokens caps thinking plus response
    // together, so this sits far above the size of the JSON itself.
    max_tokens: 8192,
    ...fallbackParams,
    system: OCR_SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: PRESCRIPTION_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: [
          sourceBlock,
          { type: "text", text: "Extract the prescription data from this document." },
        ],
      },
    ],
  });

  if (message.stop_reason === "refusal") return null;

  // Thinking blocks come first in `content`, so the answer is never at [0].
  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock?.text) return null;

  try {
    return JSON.parse(textBlock.text) as Partial<Prescription>;
  } catch {
    // Structured outputs guarantee the shape, so this only happens on a
    // truncated response.
    return null;
  }
}

/**
 * Whether a reading is weak enough to be worth paying for a stronger model.
 *
 * The bar is a read that is *unusable* — nothing legible for an eye, or values
 * the fulfilment rules reject outright — because escalating on anything merely
 * imperfect would defeat the saving.
 *
 * Know what this cannot do: it detects an absent or impossible reading, never a
 * confidently wrong one. A cheaper model misreading an axis of 165° as 105°
 * produces values that are plausible, in range, and fulfillable, so this returns
 * false and the wrong prescription proceeds. That risk is managed by choosing a
 * model that reads accurately (see DEFAULT_OCR_MODEL) and by the mandatory
 * human confirmation step — not here.
 */
function shouldEscalate(
  rx: Partial<Prescription> | null,
  validation: PrescriptionValidationResult | null
): boolean {
  if (rx === null) return true;
  const odBlank = rx.od?.sph == null && rx.od?.cyl == null;
  const osBlank = rx.os?.sph == null && rx.os?.cyl == null;
  if (odBlank || osBlank) return true;
  return validation !== null && !validation.fulfillable;
}

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  // File is available via multer or Medusa's built-in file handling
  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) {
    res.status(400).json({ error_code: "file_required", error: "A file is required." });
    return;
  }

  // Statuses match what the multer error handler in src/api/middlewares.ts
  // returns for the same conditions, so the storefront maps one reason per
  // failure whichever layer caught it.
  if (file.size > MAX_FILE_SIZE_BYTES) {
    res.status(413).json({ error_code: "file_too_large", error: "File exceeds the 10 MB limit." });
    return;
  }

  if (!isAcceptedMediaType(file.mimetype)) {
    res.status(415).json({
      error_code: "unsupported_media_type",
      error: "Unsupported media type. Send a JPEG, PNG, WEBP, GIF, HEIC or PDF.",
    });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Graceful fallback: return empty prescription, let user fill manually
    res.status(503).json({
      error_code: "ocr_unavailable",
      error: "ANTHROPIC_API_KEY is not configured.",
      fallback: true,
    });
    return;
  }

  const settings = await resolveOcrSettings(req.scope);
  const primaryModel = getOcrModel(settings.model_id);

  // Shrink before sending. Image tokens scale with area, so this is the single
  // biggest lever on what a read costs — and it caps the upload we archive too.
  const downscaled = await downscaleForOcr(
    file.buffer,
    file.mimetype,
    Math.min(settings.max_image_px, primaryModel?.max_image_edge_px ?? settings.max_image_px)
  );
  const mediaType = downscaled.media_type as AcceptedMediaType;

  // `downscaleForOcr` converts whatever it can decode to JPEG. If a HEIC came
  // through unchanged, this build of sharp has no HEIF decoder and the API
  // would reject the bytes — say so plainly instead of burning a request and
  // reporting it as a failed read.
  if (isTranscodeOnlyType(mediaType)) {
    res.status(415).json({
      error_code: "unsupported_media_type",
      error: "HEIC/HEIF could not be converted on this server. Send a JPEG, PNG or PDF.",
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
          Body: downscaled.buffer,
          ContentType: mediaType,
          // No ACL — bucket is private, access via presigned URLs only
        })
      );
      fileUrl = objectKey; // store key, not public URL
    } catch {
      // Non-fatal: OCR can proceed without storage
    }
  }

  const base64Data = downscaled.buffer.toString("base64");
  const client = new Anthropic({ apiKey });

  // A PDF rides a `document` block, an image an `image` block. Either way it
  // must precede the text block in the content array.
  const sourceBlock: SourceBlock = isAcceptedImageType(mediaType)
    ? { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } }
    : {
        type: "document",
        source: { type: "base64", media_type: PDF_MEDIA_TYPE, data: base64Data },
      };

  const prescriptionService = req.scope.resolve<PrescriptionModuleService>(
    PRESCRIPTION_MODULE
  );

  // Which model produced the reading is operational telemetry, not health data,
  // so it is returned in `meta` rather than stored on the record.
  const toPrescription = (extracted: Partial<Prescription>): Prescription => ({
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

    // telemetry, not health data.
  });

  let extracted: Partial<Prescription> | null;
  let modelUsed = settings.model_id;
  let escalated = false;

  try {
    extracted = await readWithModel(client, settings.model_id, sourceBlock);

    // Cascade: only pay for the stronger model when the cheap one came back
    // unusable. At a ~20% escalation rate this lands near the cheap model's
    // price while keeping the expensive model's accuracy where it matters.
    if (settings.escalation_model_id) {
      const firstValidation = extracted
        ? prescriptionService.validate(toPrescription(extracted))
        : null;
      if (shouldEscalate(extracted, firstValidation)) {
        const retry = await readWithModel(
          client,
          settings.escalation_model_id,
          sourceBlock
        );
        if (retry) {
          extracted = retry;
          modelUsed = settings.escalation_model_id;
          escalated = true;
        }
      }
    }
  } catch (err: unknown) {
    const isRateLimit =
      err instanceof Anthropic.RateLimitError ||
      (err instanceof Error && err.message.includes("rate_limit"));
    res.status(503).json({
      error_code: isRateLimit ? "ocr_rate_limited" : "ocr_failed",
      error: isRateLimit
        ? "Upstream model rate limit reached."
        : "The model call failed.",
      fallback: true,
    });
    return;
  }

  if (!extracted) {
    res.status(422).json({
      error_code: "ocr_unreadable",
      error: "The model returned no usable reading.",
      fallback: true,
    });
    return;
  }

  const prescription = toPrescription(extracted);
  const validation = prescriptionService.validate(prescription);

  res.json({
    prescription,
    validation,
    // Operational telemetry so the admin can see what a read actually used.
    meta: {
      model_used: modelUsed,
      escalated,
      image_resized: downscaled.resized,
      bytes_sent: downscaled.final_bytes,
    },
    // No `message` here on purpose. The "review and confirm these values"
    // prompt is UI copy and belongs to the storefront dictionary, which knows
    // the customer's language; this endpoint does not. `verified_by_user:false`
    // is the machine-readable signal that confirmation is still required.
  });
}

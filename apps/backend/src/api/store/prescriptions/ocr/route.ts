import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import Anthropic from "@anthropic-ai/sdk";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { PRESCRIPTION_MODULE } from "../../../../modules/prescription/index";
import type PrescriptionModuleService from "../../../../modules/prescription/service";
import type { Prescription } from "@eyewear/shared";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const OCR_SYSTEM_PROMPT = `You are a prescription data extraction assistant. 
Extract optical prescription data from the provided image.
Return ONLY valid JSON matching this schema — no prose, no markdown, no code fences:
{
  "od": { "sph": number|null, "cyl": number|null, "axis": number|null, "add": number|null, "prism": number|null, "base": string|null },
  "os": { "sph": number|null, "cyl": number|null, "axis": number|null, "add": number|null, "prism": number|null, "base": string|null },
  "pd": number|null,
  "pd_od": number|null,
  "pd_os": number|null
}
If a field is absent or illegible, use null. SPH "PL", "DS", or "Plano" means 0.00.`;

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  // File is available via multer or Medusa's built-in file handling
  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) {
    res.status(400).json({ error: "Se requiere un archivo de imagen o PDF." });
    return;
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    res.status(400).json({ error: "El archivo excede el límite de 10 MB." });
    return;
  }

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
  const r2Bucket = process.env.R2_PRESCRIPTION_BUCKET ?? process.env.R2_BUCKET ?? "eyewear-assets";
  const r2Endpoint = process.env.R2_ENDPOINT;
  const r2AccessKey = process.env.R2_ACCESS_KEY_ID;
  const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY;

  if (r2Endpoint && r2AccessKey && r2SecretKey) {
    const ext = file.mimetype.split("/")[1] ?? "jpg";
    const objectKey = `rx/${randomUUID()}.${ext}`;
    try {
      const s3 = new S3Client({
        region: process.env.R2_REGION ?? "auto",
        endpoint: r2Endpoint,
        credentials: {
          accessKeyId: r2AccessKey,
          secretAccessKey: r2SecretKey,
        },
      });
      await s3.send(
        new PutObjectCommand({
          Bucket: r2Bucket,
          Key: objectKey,
          Body: file.buffer,
          ContentType: file.mimetype,
          // No ACL — bucket is private, access via presigned URLs only
        })
      );
      fileUrl = objectKey; // store key, not public URL
    } catch {
      // Non-fatal: OCR can proceed without storage
    }
  }

  // TODO(blocked): Upload to R2 first, store key in file_url
  // For now we base64-encode and send directly to Anthropic
  const base64Data = file.buffer.toString("base64");
  const mediaType = (file.mimetype as "image/jpeg" | "image/png" | "image/webp" | "image/gif") || "image/jpeg";

  const client = new Anthropic({ apiKey });

  let rawJson: string;
  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: OCR_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64Data,
              },
            },
            {
              type: "text",
              text: "Extract the prescription data from this image.",
            },
          ],
        },
      ],
    });

    const block = message.content[0];
    rawJson = block.type === "text" ? block.text : "";
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

  // Defensive JSON parse
  let extracted: Partial<Prescription>;
  try {
    extracted = JSON.parse(rawJson.trim()) as Partial<Prescription>;
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

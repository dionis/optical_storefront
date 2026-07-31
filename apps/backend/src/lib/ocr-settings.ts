import { MedusaContainer } from "@medusajs/framework/types";
import { OCR_CONFIG_MODULE } from "../modules/ocr-config/index";
import type OcrConfigModuleService from "../modules/ocr-config/service";
import {
  DEFAULT_ESCALATION_MODEL,
  DEFAULT_MAX_IMAGE_PX,
  DEFAULT_OCR_MODEL,
  OCR_MODELS,
  getOcrModel,
} from "./ocr-models";

/** The single settings row. */
export const OCR_SETTING_ID = "default";

export interface OcrSettings {
  model_id: string;
  escalation_model_id: string | null;
  max_image_px: number;
  /** Where the values came from — surfaced in the admin UI. */
  source: "database" | "environment";
  updated_by?: string | null;
  updated_at?: string | null;
}

/** Hard ceiling on uploads, regardless of what an operator types in. */
export const MAX_IMAGE_PX_LIMIT = 2576;
export const MIN_IMAGE_PX_LIMIT = 640;

/**
 * Models an operator is allowed to pick. Defaults to the whole catalogue; set
 * OCR_ALLOWED_MODELS to a comma-separated list to narrow it (e.g. to forbid the
 * expensive tier outright).
 */
export function allowedModelIds(): string[] {
  const raw = process.env.OCR_ALLOWED_MODELS;
  if (!raw) return OCR_MODELS.map((m) => m.id);
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((id) => getOcrModel(id) !== undefined);
  return ids.length > 0 ? ids : OCR_MODELS.map((m) => m.id);
}

function envDefaults(): OcrSettings {
  const allowed = allowedModelIds();
  const envModel = process.env.OCR_MODEL;
  const envEscalation = process.env.OCR_ESCALATION_MODEL;
  const envPx = Number(process.env.OCR_MAX_IMAGE_PX);

  const model_id =
    envModel && allowed.includes(envModel)
      ? envModel
      : allowed.includes(DEFAULT_OCR_MODEL)
        ? DEFAULT_OCR_MODEL
        : allowed[0];

  // "none" is how you turn escalation off from the environment.
  let escalation_model_id: string | null = DEFAULT_ESCALATION_MODEL;
  if (envEscalation === "none") escalation_model_id = null;
  else if (envEscalation && allowed.includes(envEscalation))
    escalation_model_id = envEscalation;
  if (escalation_model_id && !allowed.includes(escalation_model_id))
    escalation_model_id = null;

  return {
    model_id,
    escalation_model_id,
    max_image_px: clampImagePx(Number.isFinite(envPx) ? envPx : DEFAULT_MAX_IMAGE_PX),
    source: "environment",
  };
}

export function clampImagePx(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_IMAGE_PX;
  return Math.min(MAX_IMAGE_PX_LIMIT, Math.max(MIN_IMAGE_PX_LIMIT, Math.round(value)));
}

/**
 * Effective OCR configuration: the stored row if there is one, otherwise the
 * environment defaults. A stored model that has since been removed from the
 * allowlist is ignored rather than honoured — narrowing OCR_ALLOWED_MODELS must
 * take effect immediately, without an operator having to re-save.
 */
export async function resolveOcrSettings(
  container: MedusaContainer
): Promise<OcrSettings> {
  const defaults = envDefaults();
  const allowed = allowedModelIds();

  let rows: Record<string, unknown>[] = [];
  try {
    const svc = container.resolve<OcrConfigModuleService>(OCR_CONFIG_MODULE);
    rows = (await svc.listOcrSettings({ id: OCR_SETTING_ID })) as unknown as Record<
      string,
      unknown
    >[];
  } catch {
    // Module unavailable or the table has not been migrated yet — env wins.
    return defaults;
  }

  const row = rows[0];
  if (!row) return defaults;

  const storedModel = row["model_id"] as string | undefined;
  const storedEscalation = row["escalation_model_id"] as string | null | undefined;
  const storedPx = row["max_image_px"] as number | undefined;

  return {
    model_id:
      storedModel && allowed.includes(storedModel) ? storedModel : defaults.model_id,
    escalation_model_id:
      storedEscalation && allowed.includes(storedEscalation) ? storedEscalation : null,
    max_image_px: clampImagePx(storedPx ?? defaults.max_image_px),
    source: "database",
    updated_by: (row["updated_by"] as string | null) ?? null,
    updated_at: (row["updated_at"] as string | null) ?? null,
  };
}

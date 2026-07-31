/**
 * Catalogue of the models allowed for prescription OCR, with the numbers needed
 * to price a read *before* running it. Adding a model here is all it takes to
 * offer it in the admin dropdown — the settings routes validate against this
 * list, so nothing outside it can ever be selected.
 *
 * Prices are USD per million tokens, from Anthropic's published rates. Token
 * counts are measured, not modelled — see MEASURED_ON below. They are used for
 * estimates shown to operators; they never affect what is charged.
 */

/** Date the token counts below were measured with the count_tokens endpoint. */
export const MEASURED_ON = "2026-07-30";

export interface OcrModelSpec {
  id: string;
  label: string;
  /** USD per 1M input tokens. */
  input_per_mtok: number;
  /** USD per 1M output tokens. */
  output_per_mtok: number;
  /**
   * Longest edge, in pixels, the model itself accepts before downscaling.
   * Sending anything larger only wastes bandwidth — the token count is
   * identical, because the model shrinks the image before tokenising it.
   */
  max_image_edge_px: number;
  /**
   * Whether the API accepts the `fallbacks` parameter for this model. Sending
   * it to a model that does not support it is a hard 400, so this gates the
   * request rather than merely describing it.
   */
  supports_fallbacks: boolean;
  /**
   * Image tokens measured for a 3:4 document at a given long edge, as
   * [edge_px, tokens] pairs in ascending order. Interpolated between points and
   * clamped outside them.
   */
  image_tokens_by_edge: readonly (readonly [number, number])[];
  /** Short note shown in the admin UI to justify picking this model. */
  note: string;
}

/** Tokens for the system prompt plus the user text block (measured: 242). */
const PROMPT_TOKENS = 242;
/** Tokens the JSON output schema adds to every request (measured: ~1015). */
const SCHEMA_TOKENS = 1015;
/**
 * Output tokens for one extraction (measured: 115 on Haiku, 119 on Opus).
 * Structured outputs keep this small even on models that reason by default —
 * the schema leaves little room to ramble. A difficult or handwritten
 * prescription can push it higher.
 */
const OUTPUT_TOKENS = 120;

export const OCR_MODELS: readonly OcrModelSpec[] = [
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    input_per_mtok: 1,
    output_per_mtok: 5,
    max_image_edge_px: 1568,
    supports_fallbacks: false,
    image_tokens_by_edge: [
      [1024, 985],
      [1568, 1513],
    ],
    note:
      "El más barato. Acertó 8/8 en una receta impresa, pero en una manuscrita real " +
      "leyó un eje de 165° como 105° — un error clínicamente relevante que ninguna " +
      "validación puede detectar. Adecuado solo si las recetas llegan impresas.",
  },
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    input_per_mtok: 3,
    output_per_mtok: 15,
    max_image_edge_px: 2576,
    supports_fallbacks: false,
    image_tokens_by_edge: [
      [1024, 1039],
      [1568, 2355],
      [2048, 4073],
      [2576, 4743],
    ],
    note:
      "Acertó 9/9 en una receta manuscrita real, igual que Opus, por un 37 % menos. " +
      "Es el valor por defecto: un error de lectura silencioso cuesta más que la " +
      "diferencia de precio con Haiku.",
  },
  {
    id: "claude-opus-5",
    label: "Claude Opus 5",
    input_per_mtok: 5,
    output_per_mtok: 25,
    max_image_edge_px: 2576,
    supports_fallbacks: true,
    image_tokens_by_edge: [
      [1024, 1039],
      [1568, 2355],
      [2048, 4073],
      [2576, 4743],
    ],
    note: "La mayor precisión con fotos malas y letra manuscrita. Úsalo como modelo de escalado.",
  },
] as const;

/**
 * Sonnet rather than Haiku, despite costing four times more per read.
 *
 * On a real handwritten prescription Haiku misread an axis of 165° as 105° —
 * both eyes still had plausible values, every number stayed inside the
 * fulfilment ranges, and `shouldEscalate` therefore let it through. That is the
 * dangerous failure mode here: not an unreadable scan, which we detect and
 * retry, but a *confident wrong answer* that no validation can catch and that a
 * customer reviewing a pre-filled form is unlikely to question. Sonnet and Opus
 * both read the same form correctly; the price gap is smaller than the cost of
 * one remade pair of lenses.
 *
 * If your prescriptions arrive printed rather than handwritten, Haiku is a
 * sound choice and can be selected from the admin dashboard.
 */
export const DEFAULT_OCR_MODEL = "claude-sonnet-5";
export const DEFAULT_ESCALATION_MODEL = "claude-opus-5";
/**
 * Default long edge we downscale to before sending. 1568 px is where Haiku's
 * own tokeniser caps out and is comfortably enough to read a prescription
 * table; going higher costs Sonnet and Opus roughly twice as much and buys
 * nothing on a printed form.
 */
export const DEFAULT_MAX_IMAGE_PX = 1568;

export const getOcrModel = (id: string): OcrModelSpec | undefined =>
  OCR_MODELS.find((m) => m.id === id);

/** Image tokens at an arbitrary edge, interpolated from the measured points. */
function imageTokensAt(model: OcrModelSpec, edgePx: number): number {
  const points = model.image_tokens_by_edge;
  const edge = Math.min(edgePx, model.max_image_edge_px);

  if (edge <= points[0][0]) {
    // Below the smallest measurement, tokens scale with area.
    const [refEdge, refTokens] = points[0];
    return Math.round(refTokens * (edge / refEdge) ** 2);
  }
  for (let i = 1; i < points.length; i++) {
    const [hiEdge, hiTokens] = points[i];
    if (edge <= hiEdge) {
      const [loEdge, loTokens] = points[i - 1];
      const ratio = (edge - loEdge) / (hiEdge - loEdge);
      return Math.round(loTokens + (hiTokens - loTokens) * ratio);
    }
  }
  return points[points.length - 1][1];
}

export interface OcrCostEstimate {
  model_id: string;
  effective_edge_px: number;
  input_tokens: number;
  output_tokens: number;
  usd_per_read: number;
}

/**
 * Estimate what one prescription read costs on a given model, for a 3:4 photo
 * scaled so its long edge is `maxImagePx` — or the model's own cap, if that is
 * lower, since the model downscales anything bigger itself.
 */
export function estimateOcrCost(
  model: OcrModelSpec,
  maxImagePx: number
): OcrCostEstimate {
  const edge = Math.min(maxImagePx, model.max_image_edge_px);
  const inputTokens = imageTokensAt(model, edge) + PROMPT_TOKENS + SCHEMA_TOKENS;

  const usd =
    (inputTokens / 1_000_000) * model.input_per_mtok +
    (OUTPUT_TOKENS / 1_000_000) * model.output_per_mtok;

  return {
    model_id: model.id,
    effective_edge_px: edge,
    input_tokens: inputTokens,
    output_tokens: OUTPUT_TOKENS,
    // Sub-cent figures matter here, so keep six decimals rather than rounding
    // a $0.003 read down to $0.00.
    usd_per_read: Math.round(usd * 1_000_000) / 1_000_000,
  };
}

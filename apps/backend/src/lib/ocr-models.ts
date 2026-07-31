/**
 * Catalogue of the models allowed for prescription OCR, with the numbers needed
 * to price a read *before* running it. Adding a model here is all it takes to
 * offer it in the admin dropdown — the settings routes validate against this
 * list, so nothing outside it can ever be selected.
 *
 * Prices are USD per million tokens, from Anthropic's published rates. They are
 * used for estimates shown to operators; they never affect what is charged.
 */
export interface OcrModelSpec {
  id: string;
  label: string;
  /** USD per 1M input tokens. */
  input_per_mtok: number;
  /** USD per 1M output tokens. */
  output_per_mtok: number;
  /**
   * Longest edge, in pixels, the model itself accepts before downscaling.
   * Sending anything larger only wastes bandwidth — the tokens are billed on
   * the post-downscale size either way.
   */
  max_image_edge_px: number;
  /**
   * Whether the model reasons before answering unless told otherwise. Thinking
   * tokens are billed as output, so this roughly triples the output cost.
   */
  thinking_by_default: boolean;
  /** Short note shown in the admin UI to justify picking this model. */
  note: string;
}

export const OCR_MODELS: readonly OcrModelSpec[] = [
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    input_per_mtok: 1,
    output_per_mtok: 5,
    max_image_edge_px: 1568,
    thinking_by_default: false,
    note: "Cheapest. Good on printed prescriptions; weakest on difficult handwriting.",
  },
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    input_per_mtok: 3,
    output_per_mtok: 15,
    max_image_edge_px: 2576,
    thinking_by_default: true,
    note: "Middle ground. Near-Opus reading quality at a fraction of the cost.",
  },
  {
    id: "claude-opus-5",
    label: "Claude Opus 5",
    input_per_mtok: 5,
    output_per_mtok: 25,
    max_image_edge_px: 2576,
    thinking_by_default: true,
    note: "Highest accuracy on poor photos and handwriting. Use as the escalation model.",
  },
] as const;

export const DEFAULT_OCR_MODEL = "claude-haiku-4-5";
export const DEFAULT_ESCALATION_MODEL = "claude-opus-5";
/**
 * Default long edge we downscale to before sending. Image tokens scale with
 * area, so halving the edge quarters the cost; 1568 px is comfortably enough to
 * read a prescription table and is also Haiku's own ceiling.
 */
export const DEFAULT_MAX_IMAGE_PX = 1568;

export const getOcrModel = (id: string): OcrModelSpec | undefined =>
  OCR_MODELS.find((m) => m.id === id);

/** Anthropic bills images at roughly (width x height) / 750 tokens. */
const TOKENS_PER_PIXEL_DIVISOR = 750;

/** Tokens for the system prompt, the JSON schema and the user text block. */
const PROMPT_OVERHEAD_TOKENS = 300;

/** Output tokens for the JSON itself, before any thinking. */
const JSON_OUTPUT_TOKENS = 250;

/** Rough thinking budget observed for a structured extraction of this size. */
const THINKING_OUTPUT_TOKENS = 1250;

export interface OcrCostEstimate {
  model_id: string;
  effective_edge_px: number;
  input_tokens: number;
  output_tokens: number;
  usd_per_read: number;
}

/**
 * Estimate what one prescription read costs on a given model, assuming a 3:4
 * photo scaled so its long edge is `maxImagePx` (or the model's own cap, if
 * that is lower — the model downscales anything bigger itself).
 */
export function estimateOcrCost(
  model: OcrModelSpec,
  maxImagePx: number
): OcrCostEstimate {
  const edge = Math.min(maxImagePx, model.max_image_edge_px);
  const shortEdge = Math.round(edge * 0.75); // 3:4 photo
  const imageTokens = Math.round((edge * shortEdge) / TOKENS_PER_PIXEL_DIVISOR);

  const inputTokens = imageTokens + PROMPT_OVERHEAD_TOKENS;
  const outputTokens =
    JSON_OUTPUT_TOKENS + (model.thinking_by_default ? THINKING_OUTPUT_TOKENS : 0);

  const usd =
    (inputTokens / 1_000_000) * model.input_per_mtok +
    (outputTokens / 1_000_000) * model.output_per_mtok;

  return {
    model_id: model.id,
    effective_edge_px: edge,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    // Sub-cent figures matter here, so keep six decimals rather than rounding
    // a $0.004 read down to $0.00.
    usd_per_read: Math.round(usd * 1_000_000) / 1_000_000,
  };
}

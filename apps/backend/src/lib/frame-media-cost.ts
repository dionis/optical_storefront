/**
 * What a generation run costs, priced BEFORE it runs.
 *
 * Mirrors the rate table inside `gemini_media.py` — deliberately, not by import:
 * that module is a vendored copy owned by the Python side, and this half needs
 * the numbers to show an operator an estimate before they authorise a spend
 * (the same reason `ocr-models.ts` exists next to the OCR routes).
 *
 * THE TWO HALVES DO NOT BILL IN THE SAME UNIT, so there is no single "usage"
 * number that answers "what did this cost":
 *   - IMAGES bill per token. An image up to 1024px is 1290 output tokens.
 *   - VIDEO bills per SECOND of output. Veo reports no token count at all, and a
 *     zero there reads as "this was free".
 *
 * Every rate is overridable by environment variable and every estimate carries
 * the rate it used — a number whose rate is unknown cannot be checked against a
 * bill three weeks later.
 */

/** Date the published prices below were read. Keep in step with PRICES_READ_ON. */
export const PRICES_READ_ON = "2026-09-05";
export const PRICES_SOURCE = "https://ai.google.dev/gemini-api/docs/pricing";

function envFloat(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

export const USD_PER_1M_OUTPUT_TOKENS = envFloat("GEMINI_IMAGE_USD_PER_1M_OUTPUT", 30.0);
export const USD_PER_1M_INPUT_TOKENS = envFloat("GEMINI_IMAGE_USD_PER_1M_INPUT", 0.3);

/**
 * Output tokens per generated image, by requested size. 1290 for <=1024px is
 * Google's published figure; the 2K entry is an ESTIMATE until phase 0 measures
 * it, which is exactly why phase 0 blocks authorising a batch.
 */
export const IMAGE_TOKENS_BY_SIZE: Record<string, number> = {
  "1K": Number(process.env.GEMINI_IMAGE_TOKENS_1K ?? 1290),
  "2K": Number(process.env.GEMINI_IMAGE_TOKENS_2K ?? 1290 * 4),
};

/**
 * Models that IGNORE the requested `imageSize` and bill one flat token count.
 *
 * Measured, not published. `gemini-2.5-flash-image` renders at 1024px whatever
 * `imageConfig.imageSize` asks for, so the module's hardcoded "2K" request
 * (`gemini_media.py:40`) costs 1290 output tokens, not 5160: 224 receipts from
 * the September 2026 catalogue run reported exactly 1290, every one of them.
 *
 * This is the phase-0 measurement the whole ladder was waiting for, and it is
 * load-bearing in two places beyond the estimate an operator reads:
 *   - the DAILY CEILING reserves the estimate before a batch runs, so a 4x
 *     overestimate stops a run with three quarters of the day's budget unspent;
 *   - the tier ladder's cost-drift gate compares real spend against this
 *     arithmetic, so the same 4x reads as a 75% drift and blocks tier 3 by itself.
 *
 * A model NOT listed here is priced by IMAGE_TOKENS_BY_SIZE as before — absence
 * means "not measured yet", never "bills flat".
 */
export const FLAT_IMAGE_TOKENS_BY_MODEL: Record<string, number> = {
  "gemini-2.5-flash-image": Number(process.env.GEMINI_IMAGE_TOKENS_FLASH ?? 1290),
};

/** Output tokens one image costs, preferring a measured model rate over the size table. */
export function imageOutputTokens(
  imageSize: string = DEFAULT_IMAGE_SIZE,
  model?: string
): number {
  const flat = model ? FLAT_IMAGE_TOKENS_BY_MODEL[model] : undefined;
  if (flat != null) return flat;
  return IMAGE_TOKENS_BY_SIZE[imageSize] ?? IMAGE_TOKENS_BY_SIZE["2K"];
}

/** Tokens the source photo plus prompt contribute to each request (measured low). */
const PROMPT_AND_IMAGE_INPUT_TOKENS = Number(
  process.env.GEMINI_IMAGE_INPUT_TOKENS ?? 800
);

/** USD per second of video, by model family and resolution. Audio is included. */
export const VIDEO_USD_PER_SECOND: Record<string, number> = {
  "fast:720p": 0.1,
  "fast:1080p": 0.12,
  "fast:4k": 0.3,
  "standard:720p": 0.4,
  "standard:1080p": 0.4,
  "standard:4k": 0.6,
};

export const DEFAULT_VIDEO_SECONDS = Number(process.env.GEMINI_VIDEO_SECONDS ?? 8);
export const DEFAULT_IMAGE_SIZE = process.env.GEMINI_IMAGE_SIZE ?? "2K";

export interface CostEstimate {
  /** USD. */
  total: number;
  /** How the number was reached, so a surprising figure can be argued with. */
  unit_cost: number;
  units: number;
  billing_unit: "tokens" | "seconds";
  rates: Record<string, number | string>;
}

/**
 * USD for one generated view at the configured image size.
 *
 * Pass `model` wherever it is known: without it the size table is used, which
 * over-prices every model that ignores `imageSize` (see FLAT_IMAGE_TOKENS_BY_MODEL).
 */
export function viewCostUsd(
  imageSize: string = DEFAULT_IMAGE_SIZE,
  model?: string
): number {
  const output = imageOutputTokens(imageSize, model);
  return (
    (output / 1_000_000) * USD_PER_1M_OUTPUT_TOKENS +
    (PROMPT_AND_IMAGE_INPUT_TOKENS / 1_000_000) * USD_PER_1M_INPUT_TOKENS
  );
}

/** USD per second for a Veo model/resolution, or null when the pair is unknown. */
export function videoRateUsd(model: string, resolution: string): number | null {
  const family = /fast/i.test(model ?? "") ? "fast" : "standard";
  return VIDEO_USD_PER_SECOND[`${family}:${(resolution ?? "").toLowerCase()}`] ?? null;
}

/** USD for one video. Null when no rate is known — never a guessed number. */
export function videoCostUsd(
  model: string,
  resolution = "720p",
  seconds = DEFAULT_VIDEO_SECONDS
): number | null {
  const rate = videoRateUsd(model, resolution);
  return rate === null ? null : rate * seconds;
}

/**
 * Cost of a batch, for the confirmation dialog and for `media plan`.
 *
 * `model3d` is deliberately free: the GLB pipeline runs on a GPU outside this
 * repo and costs no API money. Reporting an invented figure for it would make
 * the whole estimate untrustworthy.
 */
export function estimateBatch(input: {
  views?: number;
  videos?: number;
  imageSize?: string;
  imageModel?: string;
  videoModel?: string;
  videoResolution?: string;
  videoSeconds?: number;
}): { total_usd: number; views: CostEstimate | null; video: CostEstimate | null } {
  const imageSize = input.imageSize ?? DEFAULT_IMAGE_SIZE;
  const viewCount = input.views ?? 0;
  const videoCount = input.videos ?? 0;
  const unit = viewCostUsd(imageSize, input.imageModel);

  const views: CostEstimate | null = viewCount
    ? {
        total: unit * viewCount,
        unit_cost: unit,
        units: viewCount,
        billing_unit: "tokens",
        rates: {
          usd_per_1m_output_tokens: USD_PER_1M_OUTPUT_TOKENS,
          usd_per_1m_input_tokens: USD_PER_1M_INPUT_TOKENS,
          output_tokens_per_image: imageOutputTokens(imageSize, input.imageModel),
          image_size: imageSize,
          // Named because the rate depends on it: the same size costs different
          // tokens on a model that honours it and one that ignores it.
          image_model: input.imageModel ?? "unspecified",
          published_prices_read_on: PRICES_READ_ON,
        },
      }
    : null;

  const seconds = input.videoSeconds ?? DEFAULT_VIDEO_SECONDS;
  const perVideo = videoCostUsd(
    input.videoModel ?? "veo-3.1-fast-generate-preview",
    input.videoResolution ?? "720p",
    seconds
  );
  const video: CostEstimate | null =
    videoCount && perVideo !== null
      ? {
          total: perVideo * videoCount,
          unit_cost: perVideo,
          units: videoCount,
          billing_unit: "seconds",
          rates: {
            usd_per_second: perVideo / seconds,
            duration_seconds: seconds,
            published_prices_read_on: PRICES_READ_ON,
          },
        }
      : null;

  return {
    total_usd: round6((views?.total ?? 0) + (video?.total ?? 0)),
    views,
    video,
  };
}

/** USD from a reported token count, for reconciling an actual against an estimate. */
export function imageCostFromTokens(prompt: number, output: number): number {
  return round6(
    (output / 1_000_000) * USD_PER_1M_OUTPUT_TOKENS +
      (prompt / 1_000_000) * USD_PER_1M_INPUT_TOKENS
  );
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

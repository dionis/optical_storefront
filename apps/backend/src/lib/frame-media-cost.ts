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

/** USD for one generated view at the configured image size. */
export function viewCostUsd(imageSize: string = DEFAULT_IMAGE_SIZE): number {
  const output = IMAGE_TOKENS_BY_SIZE[imageSize] ?? IMAGE_TOKENS_BY_SIZE["2K"];
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
  videoModel?: string;
  videoResolution?: string;
  videoSeconds?: number;
}): { total_usd: number; views: CostEstimate | null; video: CostEstimate | null } {
  const imageSize = input.imageSize ?? DEFAULT_IMAGE_SIZE;
  const viewCount = input.views ?? 0;
  const videoCount = input.videos ?? 0;

  const views: CostEstimate | null = viewCount
    ? {
        total: viewCostUsd(imageSize) * viewCount,
        unit_cost: viewCostUsd(imageSize),
        units: viewCount,
        billing_unit: "tokens",
        rates: {
          usd_per_1m_output_tokens: USD_PER_1M_OUTPUT_TOKENS,
          usd_per_1m_input_tokens: USD_PER_1M_INPUT_TOKENS,
          output_tokens_per_image: IMAGE_TOKENS_BY_SIZE[imageSize] ?? 0,
          image_size: imageSize,
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

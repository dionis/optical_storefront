/**
 * Prescription OCR through Google Gemini — the fallback provider.
 *
 * Anthropic stays the first choice: when ANTHROPIC_API_KEY is set the route
 * behaves exactly as before. Only when it is absent and a Gemini key exists
 * (GEMINI_API_KEY, or GOOGLE_API_KEY — the same two names vision-measure and
 * the scraper read) does the read go to Gemini instead.
 *
 * The admin OCR settings (model dropdown, escalation) are Anthropic models, so
 * the Gemini model comes from the environment: OCR_GEMINI_MODEL and, optionally,
 * OCR_GEMINI_ESCALATION_MODEL. The image-size ceiling from the settings still
 * applies to both providers.
 *
 * Plain `fetch` against the REST API rather than an SDK: one endpoint, one call
 * shape, and the backend does not need another dependency for it.
 */
import type { Prescription } from "@eyewear/shared";

export type OcrProvider = "anthropic" | "gemini";

/**
 * Default Gemini model: the Pro tier, not Flash. The failure that matters in
 * OCR is a confident wrong value on a handwritten form (see DEFAULT_OCR_MODEL in
 * ocr-models.ts), which no validation can catch, so accuracy outranks price.
 * Preview ids get retired; override with OCR_GEMINI_MODEL when Google renames it.
 */
export const DEFAULT_GEMINI_OCR_MODEL = "gemini-3.1-pro-preview";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
/** A read normally takes a few seconds; past this the customer types it in. */
const GEMINI_TIMEOUT_MS = 60_000;

export type OcrProviderChoice =
  | { provider: "anthropic"; apiKey: string }
  | {
      provider: "gemini";
      apiKey: string;
      model: string;
      escalationModel: string | null;
    };

const clean = (v: string | undefined): string => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();

/**
 * Which provider reads the prescription, from the environment alone.
 * Anthropic first (the existing behaviour); Gemini only when Anthropic has no
 * key; null when neither does — the route then answers `ocr_unavailable`.
 */
export function resolveOcrProvider(env: NodeJS.ProcessEnv = process.env): OcrProviderChoice | null {
  const anthropic = clean(env.ANTHROPIC_API_KEY);
  if (anthropic) return { provider: "anthropic", apiKey: anthropic };

  const gemini = clean(env.GEMINI_API_KEY) || clean(env.GOOGLE_API_KEY);
  if (!gemini) return null;

  const escalation = clean(env.OCR_GEMINI_ESCALATION_MODEL);
  return {
    provider: "gemini",
    apiKey: gemini,
    model: clean(env.OCR_GEMINI_MODEL) || DEFAULT_GEMINI_OCR_MODEL,
    escalationModel: escalation && escalation !== "none" ? escalation : null,
  };
}

/**
 * The prescription shape in Gemini's `responseSchema` dialect (OpenAPI subset:
 * `nullable` instead of `anyOf [..., null]`). Mirrors PRESCRIPTION_SCHEMA in the
 * OCR route — keep the two in step.
 */
const NUM = { type: "NUMBER", nullable: true };
const STR = { type: "STRING", nullable: true };
const EYE = {
  type: "OBJECT",
  properties: { sph: NUM, cyl: NUM, axis: NUM, add: NUM, prism: NUM, base: STR },
  required: ["sph", "cyl", "axis", "add", "prism", "base"],
  propertyOrdering: ["sph", "cyl", "axis", "add", "prism", "base"],
};
export const GEMINI_PRESCRIPTION_SCHEMA = {
  type: "OBJECT",
  properties: { od: EYE, os: EYE, pd: NUM, pd_od: NUM, pd_os: NUM },
  required: ["od", "os", "pd", "pd_od", "pd_os"],
  propertyOrdering: ["od", "os", "pd", "pd_od", "pd_os"],
};

/** Request body for `models/{model}:generateContent`. */
export function buildGeminiRequest(
  systemPrompt: string,
  mediaType: string,
  base64Data: string
): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [
      {
        role: "user",
        parts: [
          { inline_data: { mime_type: mediaType, data: base64Data } },
          { text: "Extract the prescription data from this document." },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: GEMINI_PRESCRIPTION_SCHEMA,
      temperature: 0,
      // Thinking models count their reasoning against this cap too.
      maxOutputTokens: 8192,
    },
  };
}

export interface GeminiUsage {
  input_tokens: number | null;
  output_tokens: number | null;
}

/**
 * Tokens billed for one call. Thinking tokens are billed at the output rate,
 * so they are added to the output count.
 */
export function geminiUsage(body: unknown): GeminiUsage {
  const u = (body as { usageMetadata?: Record<string, unknown> })?.usageMetadata ?? {};
  const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const input = n(u.promptTokenCount);
  const candidates = n(u.candidatesTokenCount);
  const thoughts = n(u.thoughtsTokenCount);
  const output = candidates === null && thoughts === null ? null : (candidates ?? 0) + (thoughts ?? 0);
  return { input_tokens: input, output_tokens: output };
}

/**
 * The reading inside a generateContent response, or null when there is none
 * usable: a blocked prompt, a safety stop, a truncated answer or non-JSON text.
 * Null means "unreadable", which the route may escalate — never an exception.
 */
export function parseGeminiReading(body: unknown): Partial<Prescription> | null {
  const b = body as {
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  };
  if (b?.promptFeedback?.blockReason) return null;
  const candidate = b?.candidates?.[0];
  if (!candidate) return null;
  if (candidate.finishReason && candidate.finishReason !== "STOP") return null;

  // Thought summaries, when present, come as parts flagged `thought: true`.
  const text = (candidate.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("")
    .trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Partial<Prescription>) : null;
  } catch {
    return null;
  }
}

/**
 * HTTP failure from the Gemini API, carrying the status so the route's
 * `classifyModelFailure` tells a bad key from a quota from a missing model the
 * same way it does for Anthropic.
 */
export class GeminiApiError extends Error {
  readonly status: number;
  readonly type: string | undefined;
  constructor(status: number, message: string, type?: string) {
    super(message);
    this.name = "GeminiApiError";
    this.status = status;
    this.type = type;
  }
}

/** Runs one extraction attempt against a Gemini model. */
export async function readWithGemini(
  apiKey: string,
  modelId: string,
  systemPrompt: string,
  mediaType: string,
  base64Data: string,
  onUsage?: (usage: GeminiUsage) => void,
  fetchImpl: typeof fetch = fetch
): Promise<Partial<Prescription> | null> {
  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(modelId)}:generateContent`;
  // Network failures and the timeout propagate without a status, which the
  // route reports as `ocr_unreachable`.
  const resp = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(buildGeminiRequest(systemPrompt, mediaType, base64Data)),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });

  const text = await resp.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!resp.ok) {
    const err = (body as { error?: { message?: string; status?: string } })?.error;
    // The key travels in a header, never in the URL, so the message is safe to log.
    throw new GeminiApiError(resp.status, (err?.message ?? text).slice(0, 300), err?.status);
  }

  // Billed whether or not the reading is usable — count it before deciding.
  onUsage?.(geminiUsage(body));
  return parseGeminiReading(body);
}

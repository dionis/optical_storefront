/**
 * AI CONSUMPTION AND CREDIT — the pure half (no database, no HTTP).
 *
 * No provider reports a prepaid balance through an API (Anthropic shows it only
 * in its Console, Gemini only in AI Studio → Billing). So the balance here is
 * DERIVED: the owner says what they loaded (or what the console showed), and
 * every paid call this system makes is priced and subtracted from it.
 *
 *   remaining = (last "balance" figure, or the sum of deposits)
 *             + deposits after that figure
 *             − cost measured since that figure
 *
 * Costs are estimates from published list prices copied by hand (dated below);
 * a call the caller priced itself (vision-measure, Medios) keeps that figure.
 * The owner re-anchors with a "balance" entry whenever they read the console,
 * and the difference shows how far the estimate had drifted.
 */
import { getOcrModel } from "./ocr-models";

export const AI_PROVIDERS = ["anthropic", "gemini", "openai", "openrouter", "mistral", "xai", "qwen"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_ACTIVITIES = [
  "ocr",
  "vision_measure",
  "tryon_render",
  "translation",
  "media_views",
  "media_video",
  "other",
] as const;
export type AiActivity = (typeof AI_ACTIVITIES)[number];

export const CREDIT_KINDS = ["deposit", "balance"] as const;
export const ALERT_UNITS = ["usd", "percent", "days"] as const;
export type AlertUnit = (typeof ALERT_UNITS)[number];

/** Days of spending the pace ("se acaba en N días") is averaged over. */
export const BURN_WINDOW_DAYS = 7;
/** A no-credit refusal keeps the provider flagged this long after it happened. */
export const NO_CREDIT_FLAG_HOURS = 24;

const DAY_MS = 86_400_000;

export const isProvider = (v: unknown): v is AiProvider => typeof v === "string" && (AI_PROVIDERS as readonly string[]).includes(v);
export const isActivity = (v: unknown): v is AiActivity => typeof v === "string" && (AI_ACTIVITIES as readonly string[]).includes(v);

/** vision-measure and Medios name providers their own way; fold them onto ours. */
export function normalizeProvider(raw: unknown): AiProvider | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (isProvider(v)) return v;
  if (v === "google" || v.startsWith("gemini") || v === "veo") return "gemini";
  if (v === "claude") return "anthropic";
  if (v === "grok") return "xai";
  return null;
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/** Date the fallback rates below were read. Keep in step with ocr-models.ts and pricing.py. */
export const RATES_READ_ON = "2026-11-04";

/**
 * Fallback per-token rates (USD per 1M input, output) for calls this backend
 * prices itself and whose model is not in OCR_MODELS — today the scraper's
 * translation. Prefixes, longest first wins, because vendors append dated
 * suffixes to the same model.
 */
const FALLBACK_RATES: Record<string, Array<[string, number, number]>> = {
  anthropic: [
    ["claude-haiku", 1, 5],
    ["claude-sonnet", 3, 15],
    ["claude-opus", 5, 25],
  ],
  gemini: [
    // Image output bills per token: 1290 tokens per image up to 1024px (frame-media-cost.ts).
    ["gemini-2.5-flash-image", 0.3, 30],
    ["gemini-2.5-flash", 0.3, 2.5],
    ["gemini-2.5-pro", 1.25, 10],
    ["gemini-3-flash", 0.3, 2.5],
    // Prescription OCR fallback (lib/ocr-gemini.ts); under 200k prompt tokens.
    ["gemini-3.1-pro", 2, 12],
  ],
};

export interface Priced {
  cost_usd: number;
  priced: "estimated" | "unpriced";
  rate_note: string | null;
}

/** Cost of one call from its token counts, or "unpriced" when the model has no known rate. */
export function priceTokens(provider: AiProvider, model: string | null, inputTokens: number | null, outputTokens: number | null): Priced {
  const id = String(model ?? "");
  let rate: [number, number] | null = null;
  let source = "";
  const ocr = provider === "anthropic" ? getOcrModel(id) : undefined;
  if (ocr) {
    rate = [ocr.input_per_mtok, ocr.output_per_mtok];
    source = "ocr-models";
  } else {
    const match = (FALLBACK_RATES[provider] ?? [])
      .filter(([prefix]) => id.startsWith(prefix))
      .sort((a, b) => b[0].length - a[0].length)[0];
    if (match) {
      rate = [match[1], match[2]];
      source = `ai-usage ${RATES_READ_ON}`;
    }
  }
  if (!rate || (inputTokens == null && outputTokens == null)) {
    return { cost_usd: 0, priced: "unpriced", rate_note: rate ? "no token counts" : `no rate for ${provider}/${id || "?"}` };
  }
  const cost = ((inputTokens ?? 0) / 1_000_000) * rate[0] + ((outputTokens ?? 0) / 1_000_000) * rate[1];
  return { cost_usd: round6(cost), priced: "estimated", rate_note: `${rate[0]}/${rate[1]} USD per 1M (${source})` };
}

export const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Does this provider error mean "out of money" (not a rate limit, not a bad key)?
 * Anthropic: 400 "Your credit balance is too low". Gemini prepay: 429
 * RESOURCE_EXHAUSTED "prepayment credits are depleted". OpenAI: insufficient_quota.
 * OpenRouter: 402. A bare RESOURCE_EXHAUSTED is a rate limit and does NOT count.
 */
export function isNoCreditError(message: unknown, status?: number | null): boolean {
  const text = String(message ?? "");
  if (status === 402) return true;
  return /credit balance|prepayment credits|prepay(ment)? balance|insufficient[_ ](quota|credits|funds|balance)|payment required|billing (is )?(not )?(enabled|active)|exceeded your current quota/i.test(text);
}

// ---------------------------------------------------------------------------
// Input cleaning (routes and the scraper's ingest)
// ---------------------------------------------------------------------------

const toInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const toDate = (v: unknown): Date | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

const short = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

export interface CleanUsage {
  provider: AiProvider;
  model: string | null;
  activity: AiActivity;
  status: "ok" | "no_credit";
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number;
  priced: "estimated" | "reported" | "unpriced";
  rate_note: string | null;
  event_key: string | null;
  ref_id: string | null;
  establishment_id: string | null;
}

/**
 * One usage event from a caller. A `cost_usd` the caller sends is kept as
 * "reported" (it came from the provider's receipt or the caller's own rate
 * table); otherwise it is priced here from the tokens.
 */
export function cleanUsageEvent(raw: Record<string, unknown>): { event: CleanUsage } | { reason: string } {
  const provider = normalizeProvider(raw.provider);
  if (!provider) return { reason: "invalid_provider" };
  const activity = isActivity(raw.activity) ? raw.activity : null;
  if (!activity) return { reason: "invalid_activity" };
  const status = raw.status === "no_credit" ? "no_credit" : "ok";
  const model = short(raw.model, 120);
  const input_tokens = toInt(raw.input_tokens);
  const output_tokens = toInt(raw.output_tokens);
  const given = raw.cost_usd === null || raw.cost_usd === undefined || raw.cost_usd === "" ? null : Number(raw.cost_usd);
  if (given !== null && (!Number.isFinite(given) || given < 0 || given > 1000)) return { reason: "invalid_cost" };

  let cost: Priced | { cost_usd: number; priced: "reported"; rate_note: string | null };
  if (status === "no_credit") cost = { cost_usd: 0, priced: "unpriced", rate_note: null };
  else if (given !== null) cost = { cost_usd: round6(given), priced: "reported", rate_note: short(raw.rate_note, 200) };
  else cost = priceTokens(provider, model, input_tokens, output_tokens);

  return {
    event: {
      provider,
      model,
      activity,
      status,
      input_tokens,
      output_tokens,
      ...cost,
      event_key: short(raw.event_key, 200),
      ref_id: short(raw.ref_id, 120),
      establishment_id: short(raw.establishment_id, 80),
    },
  };
}

export interface CleanEntry {
  provider: AiProvider;
  kind: "deposit" | "balance";
  amount_usd: number;
  effective_at: Date;
  note: string | null;
}

/** An owner's credit entry. A deposit must be positive; a balance figure may be 0. */
export function cleanCreditEntry(raw: Record<string, unknown>, now = new Date()): { entry: CleanEntry } | { reason: string } {
  const provider = normalizeProvider(raw.provider);
  if (!provider) return { reason: "invalid_provider" };
  const kind = raw.kind === "balance" ? "balance" : raw.kind === "deposit" || raw.kind == null ? "deposit" : null;
  if (!kind) return { reason: "invalid_kind" };
  const amount = Number(raw.amount_usd);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000 || (kind === "deposit" && amount === 0)) return { reason: "invalid_amount" };
  const at = raw.effective_at == null || raw.effective_at === "" ? now : toDate(raw.effective_at);
  if (!at) return { reason: "invalid_date" };
  // A figure dated in the future would hide all spending until then.
  if (at.getTime() > now.getTime() + 5 * 60_000) return { reason: "future_date" };
  return { entry: { provider, kind, amount_usd: round2(amount), effective_at: at, note: short(raw.note, 300) } };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CleanAlert {
  provider: AiProvider;
  unit: AlertUnit;
  threshold: number;
  recipients: string[];
  locale: "es" | "en";
  is_active: boolean;
}

export function cleanAlert(raw: Record<string, unknown>): { alert: CleanAlert } | { reason: string } {
  const provider = normalizeProvider(raw.provider);
  if (!provider) return { reason: "invalid_provider" };
  const unit = (ALERT_UNITS as readonly string[]).includes(String(raw.unit)) ? (raw.unit as AlertUnit) : null;
  if (!unit) return { reason: "invalid_unit" };
  const threshold = Number(raw.threshold);
  const max = unit === "percent" ? 100 : unit === "days" ? 365 : 1_000_000;
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > max) return { reason: "invalid_threshold" };
  const list = Array.isArray(raw.recipients)
    ? raw.recipients
    : typeof raw.recipients === "string"
      ? raw.recipients.split(/[,;\s]+/)
      : [];
  const recipients = [...new Set(list.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  if (recipients.some((e) => !EMAIL.test(e) || e.length > 254)) return { reason: "invalid_email" };
  if (recipients.length > 20) return { reason: "too_many_recipients" };
  return {
    alert: {
      provider,
      unit,
      threshold: round2(threshold),
      recipients,
      locale: raw.locale === "en" ? "en" : "es",
      is_active: raw.is_active !== false,
    },
  };
}

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------

export interface EntryLike {
  id: string;
  kind: string;
  amount_usd: number;
  effective_at: Date | string;
}

export interface CreditCycle {
  /** Spending counts from this instant on; null = the owner never entered anything. */
  start: Date | null;
  /** What the current cycle was funded with: the balance figure plus later deposits. */
  funded: number;
  /** Id of the newest entry — an alert fires once per cycle and re-arms on the next entry. */
  cycle_id: string | null;
  anchor_kind: "balance" | "deposit" | null;
}

/**
 * Where the current balance starts. The newest "balance" entry resets it; with
 * none, the deposits add up from the first one. Entries are ordered by
 * effective_at, ties by id so the result never depends on the query's order.
 */
export function creditCycle(entries: EntryLike[]): CreditCycle {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.effective_at).getTime() - new Date(b.effective_at).getTime() || (a.id < b.id ? -1 : 1)
  );
  if (!sorted.length) return { start: null, funded: 0, cycle_id: null, anchor_kind: null };
  let anchorIdx = -1;
  sorted.forEach((e, i) => {
    if (e.kind === "balance") anchorIdx = i;
  });
  const from = anchorIdx === -1 ? 0 : anchorIdx;
  const counted = sorted.slice(from);
  const funded = counted.reduce((sum, e, i) => (i === 0 || e.kind === "deposit" ? sum + Number(e.amount_usd) : sum), 0);
  return {
    start: new Date(sorted[from].effective_at),
    funded: round2(funded),
    cycle_id: sorted[sorted.length - 1].id,
    anchor_kind: anchorIdx === -1 ? "deposit" : "balance",
  };
}

export interface ProviderBalance {
  tracked: boolean;
  funded: number;
  spent: number;
  remaining: number | null;
  pct_left: number | null;
  burn_per_day: number;
  days_left: number | null;
}

/**
 * Remaining balance and pace. `spentSinceStart` is what was measured since the
 * cycle's start; `spentInWindow` what was measured in the last
 * BURN_WINDOW_DAYS (clipped to the cycle start). A cycle younger than the
 * window averages over its own age, never less than one day.
 */
export function providerBalance(cycle: CreditCycle, spentSinceStart: number, spentInWindow: number, now = new Date()): ProviderBalance {
  const windowDays = cycle.start
    ? Math.min(BURN_WINDOW_DAYS, Math.max(1, (now.getTime() - cycle.start.getTime()) / DAY_MS))
    : BURN_WINDOW_DAYS;
  const burn = spentInWindow > 0 ? spentInWindow / windowDays : 0;
  if (!cycle.start) {
    return { tracked: false, funded: 0, spent: round2(spentSinceStart), remaining: null, pct_left: null, burn_per_day: round2(burn), days_left: null };
  }
  const remaining = cycle.funded - spentSinceStart;
  return {
    tracked: true,
    funded: cycle.funded,
    spent: round2(spentSinceStart),
    remaining: round2(remaining),
    pct_left: cycle.funded > 0 ? Math.max(0, Math.round((remaining / cycle.funded) * 1000) / 10) : null,
    burn_per_day: round2(burn),
    days_left: burn > 0 ? Math.max(0, Math.round((remaining / burn) * 10) / 10) : null,
  };
}

/** The window over which `spentInWindow` is measured. */
export function burnWindowStart(cycle: CreditCycle, now = new Date()): Date {
  const windowStart = new Date(now.getTime() - BURN_WINDOW_DAYS * DAY_MS);
  return cycle.start && cycle.start > windowStart ? cycle.start : windowStart;
}

export interface AlertLike {
  unit: string;
  threshold: number;
  is_active: boolean;
  fired_cycle: string | null;
}

/** Is the balance at or past this alert's threshold right now? */
export function alertTripped(alert: AlertLike, bal: ProviderBalance): boolean {
  if (!alert.is_active || !bal.tracked || bal.remaining === null) return false;
  if (alert.unit === "usd") return bal.remaining <= alert.threshold;
  if (alert.unit === "percent") return bal.pct_left !== null && bal.pct_left <= alert.threshold;
  if (alert.unit === "days") return bal.days_left !== null && bal.days_left <= alert.threshold;
  return false;
}

/** Tripped and not yet sent in this funding cycle. */
export function alertShouldFire(alert: AlertLike, bal: ProviderBalance, cycle: CreditCycle): boolean {
  return cycle.cycle_id !== null && alert.fired_cycle !== cycle.cycle_id && alertTripped(alert, bal);
}

/** The provider's state for the panel's chip and banner. */
export function providerState(bal: ProviderBalance, trippedCount: number, lastNoCreditAt: Date | null, now = new Date()): "untracked" | "ok" | "low" | "empty" | "no_credit" {
  if (lastNoCreditAt && now.getTime() - lastNoCreditAt.getTime() < NO_CREDIT_FLAG_HOURS * 3_600_000) return "no_credit";
  if (!bal.tracked) return "untracked";
  if (bal.remaining !== null && bal.remaining <= 0) return "empty";
  return trippedCount > 0 ? "low" : "ok";
}

// ---------------------------------------------------------------------------
// vision-measure responses
// ---------------------------------------------------------------------------

/** Output tokens Gemini bills per generated image up to 1024px (frame-media-cost.ts). */
export const GEMINI_IMAGE_OUTPUT_TOKENS = 1290;

/**
 * The usage events inside a vision-measure answer — the synchronous one, or a
 * finished job (`{status:"done", result}`). Each measurement result carries
 * the cost vision-measure priced itself (pricing.py), kept as reported; each
 * try-on render is priced here (Gemini image models only, by the published
 * tokens per image). A failed result whose error names the balance is a
 * "no_credit" event. Keys use the request id, so polling a job twice counts once.
 */
export function visionUsageEvents(body: unknown): Array<Record<string, unknown>> {
  if (!body || typeof body !== "object") return [];
  const top = body as Record<string, unknown>;
  const payload = (top.status === "done" && top.result && typeof top.result === "object" ? top.result : top) as Record<string, unknown>;
  const requestId = typeof payload.requestId === "string" && payload.requestId ? payload.requestId : null;
  if (!requestId || !Array.isArray(payload.results)) return [];
  const out: Array<Record<string, unknown>> = [];
  payload.results.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") return;
    const r = raw as Record<string, unknown>;
    const provider = normalizeProvider(r.provider);
    if (!provider) return; // "local" engines cost nothing
    const cost = (r.cost && typeof r.cost === "object" ? r.cost : {}) as Record<string, unknown>;
    const noCredit = r.ok === false && isNoCreditError(r.error);
    const total = cost.totalCost == null ? null : Number(cost.totalCost);
    out.push({
      provider,
      model: r.model ?? null,
      activity: "vision_measure",
      status: noCredit ? "no_credit" : "ok",
      input_tokens: cost.inputTokens ?? null,
      output_tokens: cost.outputTokens ?? null,
      // vision-measure's own estimate; absent → priced here from the tokens.
      cost_usd: total !== null && Number.isFinite(total) ? total : null,
      rate_note: total !== null ? `vision-measure pricing.py ${String(cost.ratesCheckedOn ?? "")}`.trim() : null,
      event_key: `vision:${requestId}:${i}`,
      ref_id: requestId,
    });
  });
  for (const [k, view] of [["tryOn", "front"], ["tryOnProfile", "profile"]] as const) {
    const r = payload[k] as Record<string, unknown> | undefined;
    if (!r || typeof r !== "object") continue;
    const provider = normalizeProvider(r.provider);
    if (!provider) continue;
    const noCredit = !r.imageDataUrl && isNoCreditError(r.error);
    if (!r.imageDataUrl && !noCredit) continue; // a failed render is not billed
    const isGeminiImage = provider === "gemini" && /image/i.test(String(r.model ?? ""));
    out.push({
      provider,
      model: r.model ?? null,
      activity: "tryon_render",
      status: noCredit ? "no_credit" : "ok",
      output_tokens: isGeminiImage && !noCredit ? GEMINI_IMAGE_OUTPUT_TOKENS : null,
      event_key: `vision:${requestId}:render:${view}`,
      ref_id: requestId,
    });
  }
  return out;
}

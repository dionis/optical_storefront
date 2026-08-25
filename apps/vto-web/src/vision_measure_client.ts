/**
 * Typed client for the multimodal measurement endpoint (services/api/vision_api.py).
 *
 * Everything goes through the same origin: Vite proxies /api to the Python service, so
 * an API key typed into the panel never crosses a third origin and there is no CORS
 * preflight to configure per deployment host.
 */

/** Where the endpoint lives. Overridable so a built bundle can point elsewhere. */
const API_BASE = (import.meta as any).env?.VITE_VISION_API_BASE ?? '/api';

export interface ProviderInfo {
  id: string;
  label: string;
  adapter: string;
  defaultModel: string;
  suggestedModels: string[];
  envKeys: string[];
  /** True when the server already has a key for this vendor in its environment. */
  hasServerKey: boolean;
  docsUrl: string;
}

export interface StrategyInfo {
  id: string;
  label: string;
  description: string;
  requiresContext: boolean;
}

/** An engine able to return the picture of the patient wearing the frame. */
export interface ImageEngineInfo {
  id: string;
  label: string;
  requiresKey: boolean;
  /** True when it needs the locally tracked capture (the deterministic composite does). */
  requiresContext: boolean;
  defaultModel: string | null;
}

/** Identifies the build of the Python service that answered. */
export interface ServiceBuild {
  fingerprint: string;
  features: string[];
}

export interface ProviderCatalog {
  providers: ProviderInfo[];
  strategies: StrategyInfo[];
  build?: ServiceBuild;
  imageEngines: ImageEngineInfo[];
}

export interface FacialResult {
  pdTotalMM: number | null;
  pdRightMM: number | null;
  pdLeftMM: number | null;
  corridorHeightRightMM: number | null;
  corridorHeightLeftMM: number | null;
  pupilCenterHeightMM: number | null;
  pantoscopicAngleDeg: number | null;
  wrapAngleDeg: number | null;
  faceWidthMM: number | null;
}

export interface FrameResult {
  brand: string | null;
  model: string | null;
  color: string | null;
  sizeCode: string | null;
  lensWidthMM: number | null;
  bridgeMM: number | null;
  templeLengthMM: number | null;
  lensHeightMM: number | null;
  totalFrontWidthMM: number | null;
  shape: string | null;
  material: string | null;
  /** Full rim, semi-rimless or rimless. The optician card has a row for it. */
  rimType?: string | null;
}

export interface ConfidenceEntry {
  level: string;
  source: string;
  note: string;
}

/** The fitting height a varifocal needs, and whether this frame gives it. */
export interface ProgressiveResult {
  fittingHeightRightMM: number | null;
  fittingHeightLeftMM: number | null;
  /** What the chosen design needs: ~18 mm short corridor, ~22 mm standard. */
  minimumRequiredMM: number | null;
  /** true / false / null when the heights could not be established at all. */
  suitable: boolean | null;
  note: string;
}

/** The Capri protocol's summary table. Empty unless a frame identifier was given. */
export interface CapriResult {
  frameId?: string | null;
  brand?: string | null;
  model?: string | null;
  color?: string | null;
  commercialSize?: string | null;
  sourceUrl?: string | null;
  lensWidthAMM?: number | null;
  lensHeightBMM?: number | null;
  edMM?: number | null;
  circMM?: number | null;
  bridgeDBLMM?: number | null;
  templeLengthMM?: number | null;
  bSource?: string | null;
  monofocalHeightMM?: number | null;
  bifocalHeightMM?: number | null;
  progressiveHeightMM?: number | null;
  personNasalBridgeWidthMM?: number | null;
  bridgeWidthDifferenceMM?: number | null;
  verticalOffsetAboveBridgeMM?: number | null;
  pixelsPerMM?: number | null;
  verticalOffsetPx?: number | null;
  horizontalAdjustmentPx?: number | null;
  verticalAdjustmentPx?: number | null;
  headRotationNote?: string | null;
  confidence?: Record<string, string>;
  notes?: string[];
}

/** The model's verdict on the two photographs it was given. */
export interface InputsCheck {
  faceImageShowsOnePerson: boolean | null;
  frameImageShowsEyewear: boolean | null;
  problem: string | null;
}

export interface Measurements {
  inputs?: InputsCheck;
  capri: CapriResult;
  facial: FacialResult;
  frame: FrameResult;
  progressive: ProgressiveResult;
  fit: {
    verdict: string;
    score: number | null;
    issues: string[];
    recommendations: string[];
  };
  confidence: Record<string, ConfidenceEntry>;
  notes: string[];
  /** Field names whose value fell outside the clinically plausible band. */
  outOfRange: string[];
  warnings: string[];
}

/** Token spend and estimated price of one call. */
export interface CostBreakdown {
  inputTokens: number | null;
  outputTokens: number | null;
  /** Reasoning tokens. Already inside outputTokens — never add them again. */
  thinkingTokens: number | null;
  totalTokens: number | null;
  currency: string;
  ratesCheckedOn: string;
  rateSource: string | null;
  inputRatePerMTok: number | null;
  outputRatePerMTok: number | null;
  inputCost: number | null;
  outputCost: number | null;
  totalCost: number | null;
  note: string | null;
}

export interface CostSummary {
  currency: string;
  totalCost: number;
  totalTokens: number;
  pricedCalls: number;
  unpricedCalls: number;
}

export interface MeasureResult {
  ok: boolean;
  /** Id of the HTTP request this result belongs to. */
  requestId?: string;
  strategy: string;
  provider: string;
  providerLabel: string;
  model: string;
  latencyMs?: number;
  usage?: Record<string, number | null>;
  measurements?: Measurements;
  rawText?: string;
  error?: string;
  /** Machine-readable reason, so the panel can localise it. e.g. 'missing-api-key'. */
  errorCode?: string;
  /** Environment variables that would have supplied the key, when one was missing. */
  envKeys?: string[];
  docsUrl?: string;
  cost?: CostBreakdown;
  /** Supplier pages the Capri protocol asked the model to open, when it asked. */
  browseUrls?: string[];
  /** What the model reported actually retrieving. Empty after asking IS the finding. */
  urlRetrieval?: Array<{ url: string; status: string }>;
  /** False when the provider has no way of opening a page at all. */
  browsingSupported?: boolean;
}

/** The rendered try-on. One per run, whatever number of strategies were executed. */
export interface TryOnResult {
  ok: boolean;
  method?: string;
  /** 'front' or 'profile'. A profile view is always AI-extrapolated. */
  view?: string;
  /** True when the image arrived fine but was dropped to fit browser storage. */
  imageDropped?: boolean;
  errorCode?: string;
  envKeys?: string[];
  provider?: string;
  model?: string | null;
  imageDataUrl?: string;
  latencyMs?: number;
  note?: string;
  error?: string;
  geometry?: {
    frameTotalWidthMM: number;
    frameWidthSource: string;
    pixelsPerMM: number;
    rollAngleDeg: number;
    lensAperturePx: number;
  };
}

export interface MeasureResponse {
  ok: boolean;
  results: MeasureResult[];
  tryOn?: TryOnResult;
  /** What the whole request cost, failed proposals included: they burned tokens too. */
  cost?: CostSummary;
  /** One id per request, stamped by the service on every result and log line. */
  requestId?: string;
  /** Optional side view. Costs a second image-model call. */
  tryOnProfile?: TryOnResult;
}

export interface MeasureRequest {
  faceImage: string;
  glassesImage: string;
  provider: string;
  model?: string;
  apiKey?: string;
  /** 'A', 'B', or 'AB' to run both proposals over the same capture. */
  strategy: string;
  context?: Record<string, unknown> | null;
  lang: string;
  /** Ask for the composed picture of the patient wearing the frame. */
  renderTryOn: boolean;
  /** 'local' for the deterministic composite, or a provider id for a real image model. */
  imageEngine: string;
  imageModel?: string;
  imageApiKey?: string;
  /** Ask for the extra profile view. Off by default: it is a second paid call. */
  renderProfile?: boolean;
  /** Operator notes appended to the system prompt, below everything else. */
  extraInstructions?: string;
  /** Capri model identifier. Set it and the Capri fitting protocol is applied. */
  frameId?: string;
}

export async function fetchProviderCatalog(lang: string): Promise<ProviderCatalog> {
  const res = await fetch(`${API_BASE}/vision-measure/providers?lang=${encodeURIComponent(lang)}`);
  if (!res.ok) {
    throw new Error(`El servicio de medición respondió ${res.status}`);
  }
  return (await res.json()) as ProviderCatalog;
}

/**
 * Runs a measurement. `signal` lets the panel stop waiting.
 *
 * Aborting closes the browser's side of the connection; it does NOT un-spend tokens the
 * provider has already been asked for. It exists to end a wait and to stop duplicate
 * runs piling up, not to refund anything — and the panel says exactly that.
 */
export async function requestMeasurement(
  payload: MeasureRequest,
  signal?: AbortSignal
): Promise<MeasureResponse> {
  const res = await fetch(`${API_BASE}/vision-measure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Respuesta ilegible del servicio (HTTP ${res.status}).`);
  }

  // 422 carries a single actionable message rather than a results array
  if (!res.ok && !Array.isArray(body?.results)) {
    throw new Error(body?.error || body?.detail || `El servicio respondió ${res.status}.`);
  }

  return {
    ok: Boolean(body?.ok),
    results: (body?.results ?? []) as MeasureResult[],
    tryOn: body?.tryOn as TryOnResult | undefined,
    cost: body?.cost as CostSummary | undefined,
    requestId: body?.requestId as string | undefined,
    tryOnProfile: body?.tryOnProfile as TryOnResult | undefined,
  };
}

/**
 * Reads a picked file and re-encodes it to a JPEG data URL no larger than `maxEdge`.
 *
 * The server re-encodes as well, but a modern phone photo is 8-12 MB and posting it
 * raw as base64 is a 15 MB request body — shrinking first is what keeps the panel
 * usable on a phone connection.
 */
export async function fileToScaledDataURL(file: File, maxEdge = 1568, quality = 0.9): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo leer la imagen seleccionada.'));
      img.src = objectUrl;
    });

    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    const ratio = longest > maxEdge ? maxEdge / longest : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));

    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Shrinks an existing data URL to a thumbnail.
 *
 * The frame photograph is uploaded at up to 1568 px because the model has to read a size
 * code stamped inside a temple. The printed sheet shows it as a small inset, so storing
 * the full upload alongside the report would spend the localStorage budget on pixels
 * nobody looks at — and that budget is what decides whether the composite survives.
 */
export async function dataUrlToThumbnail(
  dataUrl: string,
  maxEdge = 420,
  quality = 0.82
): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo releer la imagen de la montura.'));
    img.src = dataUrl;
  });

  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  if (longest <= maxEdge) return dataUrl;

  const ratio = maxEdge / longest;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export interface ModelInfo {
  id: string;
  label: string;
  note: string;
}

export interface ModelCatalog {
  ok: boolean;
  provider?: string;
  providerLabel?: string;
  defaultModel?: string;
  models?: ModelInfo[];
  error?: string;
}

/**
 * Asks the vendor which models the current key can actually call.
 *
 * The key goes in the body rather than the query string so it never reaches an access
 * log. A vendor-side failure comes back as {ok:false, error} with HTTP 200, like the
 * measurement endpoint.
 */
export async function fetchModelCatalog(
  provider: string,
  apiKey?: string
): Promise<ModelCatalog> {
  const res = await fetch(`${API_BASE}/vision-measure/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, apiKey: apiKey || undefined }),
  });

  try {
    return (await res.json()) as ModelCatalog;
  } catch {
    return { ok: false, error: `Respuesta ilegible del servicio (HTTP ${res.status}).` };
  }
}

/**
 * Service behaviours this frontend relies on.
 *
 * The Python service does not hot-reload, so a stale process is easy to leave running
 * after an edit — and its symptoms are indistinguishable from a defect. Naming the
 * expectations lets the panel say "the service is old" instead of showing a stale error
 * and letting the operator debug something that was already fixed.
 */
export const REQUIRED_SERVICE_FEATURES = [
  'reasoning-budget',
  'vendor-error-detail',
  'failure-logging',
  'truncation-detail',
  'transient-retry',
  'request-isolation',
  'directed-param-fix',
  'profile-view',
  'extra-instructions',
  'capri-protocol',
  'input-validation',
] as const;

/** Behaviours the frontend expects that the running service does not report. */
export function missingServiceFeatures(build?: ServiceBuild): string[] {
  if (!build || !Array.isArray(build.features)) return [...REQUIRED_SERVICE_FEATURES];
  return REQUIRED_SERVICE_FEATURES.filter((f) => !build.features.includes(f));
}

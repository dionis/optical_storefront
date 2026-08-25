/**
 * Keeps the last multimodal run so it outlives the tab that produced it.
 *
 * This exists because of a real loss: an OpenAI reasoning model took minutes, the panel
 * showed a static "Analizando…", the operator assumed it had hung and reloaded — and the
 * request completed on the server with nobody left to receive it. Results that live only
 * in a JavaScript variable are one accidental refresh away from gone.
 *
 * Persisting also makes a second window possible at all: `localStorage` is shared across
 * tabs of the same origin, so the report page can render a run started in the try-on.
 */

import { MeasureResult, TryOnResult } from './vision_measure_client';

const STORAGE_KEY = 'rubilens.lastVisionRun';

/** Comfortably under the ~5 MB localStorage budget, with the try-on JPEG inside. */
const MAX_STORED_BYTES = 4_000_000;

export interface StoredRun {
  /** ISO timestamp of when the run came back. */
  finishedAt: string;
  engine: {
    provider: string;
    model: string;
    strategy: string;
    imageEngine: string;
    /** The optician's own note, when one was sent. It shaped the answer. */
    extraInstructions?: string;
    /** The Capri identifier that was asked for, when the protocol was applied. */
    frameId?: string;
  };
  /**
   * Who the fitting is for. Typed by the optician and used only to head the printed
   * card — it is NEVER sent to a provider. A patient's name has no bearing on any
   * measurement, so there is no reason for it to leave this browser.
   */
  patient?: string;
  /**
   * The practice's own name, heading the printed sheet. Local like the patient name,
   * but remembered between fittings because it does not change with the patient.
   */
  practice?: string;
  /**
   * Thumbnail of the frame photograph the operator uploaded. The printed sheet shows the
   * frame beside its own dimensions, which is what lets a reader confirm that the numbers
   * describe the frame in front of them and not a different one with the same code.
   */
  frameImage?: string;
  /** Locally measured snapshot, when the capture carried one. */
  context: Record<string, unknown> | null;
  results: MeasureResult[];
  tryOn: TryOnResult | null;
  /** Optional side view, when one was requested. */
  tryOnProfile?: TryOnResult | null;
}

/**
 * Stores a finished run.
 *
 * Returns whether it fits. A run that does not fit is NOT partially written: half a
 * report is worse than an honest "too large", because the reader cannot tell which half
 * is missing. The raw model answers are dropped first — they are a debugging aid, while
 * the figures and the picture are the deliverable.
 */
/**
 * Removes an image from a render result, leaving a marker that says why.
 *
 * Dropping `imageDataUrl` and nothing else is what made the report claim a provider
 * error that never happened: the renderer cannot tell an image that failed to arrive
 * from one that was thrown away here. `imageDropped` is that distinction.
 */
function withoutImage(view: TryOnResult | null | undefined): TryOnResult | null {
  if (!view) return null;
  return { ...view, imageDataUrl: undefined, imageDropped: true };
}

export function saveRun(run: StoredRun): boolean {
  const lean = run.results.map(({ rawText, ...rest }) => rest);

  const attempts: StoredRun[] = [
    run,
    // 1st: drop the raw model answers — a debugging aid, not the deliverable
    { ...run, results: lean },
    // 2nd: also drop the profile picture. It goes before the frontal one on purpose:
    // the frontal composite is the evidence, the profile is an illustration.
    { ...run, results: lean, tryOnProfile: withoutImage(run.tryOnProfile) },
    // 3rd: give up the frontal picture too. The measurements still fit, and they are
    // what the optician actually needs.
    {
      ...run,
      results: lean,
      tryOn: withoutImage(run.tryOn),
      tryOnProfile: withoutImage(run.tryOnProfile),
    },
    // 4th: the frame thumbnail too. It is small, so this rarely decides anything — but
    // leaving it out of the chain would mean a run that fits at step 3 and not at 4 fails
    // for a reason the chain never actually tried to fix.
    {
      ...run,
      results: lean,
      tryOn: withoutImage(run.tryOn),
      tryOnProfile: withoutImage(run.tryOnProfile),
      frameImage: undefined,
    },
  ];

  for (const attempt of attempts) {
    const payload = JSON.stringify(attempt);
    if (payload.length > MAX_STORED_BYTES) continue;
    try {
      localStorage.setItem(STORAGE_KEY, payload);
      return true;
    } catch {
      // Quota or private browsing: try the next, smaller shape
    }
  }
  return false;
}

export function loadRun(): StoredRun | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.results)) return null;
    return parsed as StoredRun;
  } catch {
    return null;
  }
}

export function clearRun(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do: the caller only wanted it gone */
  }
}

/** URL of the standalone report page, relative to wherever the app is served from. */
export function reportUrl(): string {
  return new URL('report.html', window.location.href).toString();
}

/**
 * Second try-on option: AI measurement from two photographs.
 *
 * The first option (the live 3D try-on) measures the face geometrically and dresses it
 * with a generated frame. This one takes a correct frontal photograph plus a photo of a
 * real frame the patient chose, sends both to a multimodal model, and shows the
 * measurements that model proposes.
 *
 * The panel owns the whole flow: capture gating, the frame upload, engine selection,
 * the request, and the rendering of the report. It reads live tracking state through
 * `VisionPanelHost` and never touches the 3D scene, so with this file removed the
 * original try-on is unchanged.
 */

import { OpticalMeasurements } from './optical_calculator';
import { t, getLang, onLangChange } from './i18n';
import { checkSingleFace } from './image_validator';
import { StoredRun, loadRun, reportUrl, saveRun } from './vision_report_store';
import {
  attachRawToggles,
  renderResultsHtml,
  renderTryOnHtml,
} from './vision_report_view';
import {
  fetchModelCatalog,
  fetchProviderCatalog,
  fetchProxiedImage,
  missingServiceFeatures,
  fileToScaledDataURL,
  dataUrlToThumbnail,
  requestMeasurement,
  CostSummary,
  ImageEngineInfo,
  MeasureResult,
  ProviderCatalog,
  ProviderInfo,
  TryOnResult,
} from './vision_measure_client';

/** What the panel needs to know about the live capture at the instant of the shot. */
export interface CaptureSnapshot {
  faceDetected: boolean;
  isFrontal: boolean;
  poseWarning: string;
  measurements: OpticalMeasurements | null;
  /** MediaPipe normalized landmarks for the tracked face, or null. */
  landmarks: Array<{ x: number; y: number; z: number }> | null;
}

export interface ActiveFrameInfo {
  sku: string;
  name: string;
  totalWidthMM: number;
  lensHeightBMM: number | null;
}

export interface VisionPanelHost {
  getVideoElement(): HTMLVideoElement;
  getSnapshot(): CaptureSnapshot;
  getActiveFrame(): ActiveFrameInfo;
}

/** MediaPipe FaceLandmarker indices the context block reports, as used elsewhere here. */
const LM = {
  rightPupil: 468,
  leftPupil: 473,
  rightEar: 234,
  leftEar: 454,
  chin: 152,
  forehead: 10,
  noseTip: 1,
} as const;

const KEY_STORAGE = 'rubilens.visionApiKeys';
const PREFS_STORAGE = 'rubilens.visionPrefs';


export class VisionMeasurePanel {
  private host: VisionPanelHost;
  private catalog: ProviderCatalog | null = null;

  // Captured inputs
  private faceImage: string | null = null;
  private glassesImage: string | null = null;
  /** Local measurement snapshot frozen at the instant the face photo was taken. */
  private captureContext: Record<string, unknown> | null = null;
  private lastResults: MeasureResult[] = [];
  private lastTryOn: TryOnResult | null = null;
  private lastProfile: TryOnResult | null = null;

  /**
   * The capture whose quality note is on screen, kept so a language switch can redraw it.
   */
  private lastSnapshot: CaptureSnapshot | null = null;

  /**
   * The status line as a KEY plus its arguments, never as finished text.
   *
   * Storing the resolved sentence is what made this panel immune to the language
   * selector: you cannot translate a string you have already flattened.
   */
  private lastStatus: {
    state: 'idle' | 'busy' | 'ok' | 'error';
    key: string;
    vars?: Record<string, string | number>;
  } | null = null;

  // DOM
  private root: HTMLElement | null;
  private facePreview: HTMLImageElement | null = null;
  private glassesPreview: HTMLImageElement | null = null;
  private captureQuality: HTMLElement | null = null;
  private providerSelect: HTMLSelectElement | null = null;
  private modelInput: HTMLInputElement | null = null;
  private modelList: HTMLDataListElement | null = null;
  private modelHint: HTMLElement | null = null;
  private keyInput: HTMLInputElement | null = null;
  private rememberKey: HTMLInputElement | null = null;
  private keyHint: HTMLElement | null = null;
  private strategySelect: HTMLSelectElement | null = null;
  private strategyNote: HTMLElement | null = null;
  private imageEngineSelect: HTMLSelectElement | null = null;
  private imageModelInput: HTMLInputElement | null = null;
  private imageNote: HTMLElement | null = null;
  private profileCheck: HTMLInputElement | null = null;
  private extraInput: HTMLTextAreaElement | null = null;
  private frameIdInput: HTMLInputElement | null = null;
  private patientInput: HTMLInputElement | null = null;
  private practiceInput: HTMLInputElement | null = null;
  /**
   * Whether the operator has chosen the render settings by hand.
   *
   * Until they do, picking a vendor that can also draw pictures turns both on. Once
   * they touch either control, their choice stands and is never overwritten again —
   * an assistant that keeps re-ticking a box you unticked is not being helpful.
   */
  private renderChoiceIsUsers = false;
  private tryOnBox: HTMLElement | null = null;
  private runButton: HTMLButtonElement | null = null;
  private exportButton: HTMLButtonElement | null = null;
  private resultsBox: HTMLElement | null = null;
  private statusBox: HTMLElement | null = null;

  /**
   * Whether the face THUMBNAIL is shown flipped. Presentation only — the image that
   * travels is always the unmirrored one.
   */
  private previewMirrored = true;

  /** Result of the local single-face check on the current face photo. */
  private faceCheck: { code: string; faces: number } | null = null;

  private running = false;
  /** Ticks the elapsed-time readout while a run is in flight. */
  private elapsedTimer: number | null = null;
  /** Lets the operator abandon a run in flight. */
  private inFlight: AbortController | null = null;
  /** Running token spend for this browser session, across every run. */
  private sessionCost = { totalCost: 0, totalTokens: 0, calls: 0, unpriced: 0 };

  constructor(host: VisionPanelHost) {
    this.host = host;
    this.root = document.getElementById('ai-panel');
    if (!this.root) return;

    this.facePreview = document.getElementById('ai-face-preview') as HTMLImageElement;
    this.glassesPreview = document.getElementById('ai-glasses-preview') as HTMLImageElement;
    this.captureQuality = document.getElementById('ai-capture-quality');
    this.providerSelect = document.getElementById('select-ai-provider') as HTMLSelectElement;
    this.modelInput = document.getElementById('input-ai-model') as HTMLInputElement;
    this.modelList = document.getElementById('ai-model-list') as HTMLDataListElement;
    this.modelHint = document.getElementById('ai-model-hint');
    this.keyInput = document.getElementById('input-ai-key') as HTMLInputElement;
    this.rememberKey = document.getElementById('check-ai-remember') as HTMLInputElement;
    this.keyHint = document.getElementById('ai-key-hint');
    this.strategySelect = document.getElementById('select-ai-strategy') as HTMLSelectElement;
    this.strategyNote = document.getElementById('ai-strategy-note');
    this.imageEngineSelect = document.getElementById('select-ai-image-engine') as HTMLSelectElement;
    this.imageModelInput = document.getElementById('input-ai-image-model') as HTMLInputElement;
    this.imageNote = document.getElementById('ai-image-note');
    this.profileCheck = document.getElementById('check-ai-profile') as HTMLInputElement;
    this.extraInput = document.getElementById('input-ai-extra') as HTMLTextAreaElement;
    this.frameIdInput = document.getElementById('input-ai-frame-id') as HTMLInputElement;
    this.patientInput = document.getElementById('input-ai-patient') as HTMLInputElement;
    this.practiceInput = document.getElementById('input-ai-practice') as HTMLInputElement;
    this.tryOnBox = document.getElementById('ai-tryon');
    this.runButton = document.getElementById('btn-ai-run') as HTMLButtonElement;
    this.exportButton = document.getElementById('btn-ai-export') as HTMLButtonElement;
    this.resultsBox = document.getElementById('ai-results');
    this.statusBox = document.getElementById('ai-status');

    this.wireEvents();
    // A run from a previous session is still readable: offer the report straight away
    if (loadRun()) document.getElementById('btn-ai-open-report')?.classList.remove('hidden');
    void this.loadCatalog();

    // Everything this panel shows is built from JavaScript, so the language switch has
    // to redraw it. Without this the surrounding labels changed and the results kept the
    // language they were produced in -- which, once there are results on screen, looks
    // exactly like the switch doing nothing at all.
    onLangChange(() => this.relocalize());
  }

  /** Rebuilds every piece of this panel in the language now selected. */
  private relocalize(): void {
    // The provider, strategy and engine labels are written by the service, so they have
    // to be asked for again rather than re-rendered.
    void this.loadCatalog();

    this.paintStatus();
    this.paintExtraHint();
    this.paintSessionCost();
    this.paintMirrorState();

    if (this.lastSnapshot) this.renderCaptureQuality(this.lastSnapshot);
    if (this.lastResults.length) this.renderResults(this.lastResults);
    if (this.lastTryOn || this.lastProfile) this.renderTryOn(this.lastTryOn);
    this.updateRunState();
  }

  // ---------------------------------------------------------------- wiring

  private wireEvents(): void {
    document.getElementById('btn-ai-capture')?.addEventListener('click', () => this.captureFace());

    document.getElementById('btn-ai-mirror')?.addEventListener('click', () => {
      this.previewMirrored = !this.previewMirrored;
      this.paintMirrorState();
      this.savePrefs();
    });

    const faceUpload = document.getElementById('input-ai-face') as HTMLInputElement | null;
    faceUpload?.addEventListener('change', () => {
      const file = faceUpload.files?.[0];
      if (file) void this.loadFaceFromFile(file);
    });

    const glassesUpload = document.getElementById('input-ai-glasses') as HTMLInputElement | null;
    glassesUpload?.addEventListener('change', () => {
      const file = glassesUpload.files?.[0];
      if (file) void this.loadGlassesFromFile(file);
    });

    // Dropping a frame photo straight onto the tile is the fastest path on a desktop
    const drop = document.getElementById('ai-glasses-drop');
    if (drop) {
      ['dragenter', 'dragover'].forEach((evt) =>
        drop.addEventListener(evt, (e) => {
          e.preventDefault();
          drop.classList.add('drag-over');
        })
      );
      ['dragleave', 'drop'].forEach((evt) =>
        drop.addEventListener(evt, (e) => {
          e.preventDefault();
          drop.classList.remove('drag-over');
        })
      );
      drop.addEventListener('drop', (e) => {
        const file = (e as DragEvent).dataTransfer?.files?.[0];
        if (file) void this.loadGlassesFromFile(file);
      });
    }

    document.getElementById('btn-ai-models')?.addEventListener('click', () => void this.refreshModels());

    this.providerSelect?.addEventListener('change', () => this.onProviderChange());
    this.strategySelect?.addEventListener('change', () => this.onStrategyChange());
    this.imageEngineSelect?.addEventListener('change', () => {
      this.renderChoiceIsUsers = true;
      this.onImageEngineChange();
    });
    this.frameIdInput?.addEventListener('change', () => this.savePrefs());
    // Deliberately NOT persisted with the other preferences: a patient's name is not
    // a setting to carry into the next fitting.
    this.patientInput?.addEventListener('change', () => {});
    this.practiceInput?.addEventListener('change', () => this.savePrefs());
    this.extraInput?.addEventListener('input', () => this.paintExtraHint());
    this.extraInput?.addEventListener('change', () => this.savePrefs());

    this.profileCheck?.addEventListener('change', () => {
      this.renderChoiceIsUsers = true;
      this.savePrefs();
    });

    this.keyInput?.addEventListener('change', () => this.persistKey());
    this.rememberKey?.addEventListener('change', () => this.persistKey());

    this.runButton?.addEventListener('click', () => void this.run());
    document.getElementById('btn-ai-cancel')?.addEventListener('click', () => this.cancelRun());
    this.exportButton?.addEventListener('click', () => this.exportReport());
    document.getElementById('btn-ai-open-report')?.addEventListener('click', () => {
      window.open(reportUrl(), 'rubilens-report');
    });
  }

  private async loadCatalog(): Promise<void> {
    try {
      this.catalog = await fetchProviderCatalog(getLang());
    } catch (error: any) {
      this.setStatus('error', 'ai.serviceDown', { detail: error?.message ?? String(error) });
      return;
    }

    if (this.providerSelect) {
      this.providerSelect.innerHTML = this.catalog.providers
        .map(
          (p) =>
            `<option value="${p.id}">${p.label}${p.hasServerKey ? ' · 🔑' : ''}</option>`
        )
        .join('');
    }

    if (this.strategySelect) {
      const options = this.catalog.strategies
        .map((s) => `<option value="${s.id}">${s.label}</option>`)
        .join('');
      this.strategySelect.innerHTML = `${options}<option value="AB">${t('ai.strategyCompare')}</option>`;
    }

    if (this.imageEngineSelect) {
      this.imageEngineSelect.innerHTML = this.catalog.imageEngines
        .map((e) => `<option value="${e.id}">${e.label}</option>`)
        .join('');
    }

    // A service older than this page produces symptoms that look exactly like bugs.
    // Say which it is, before the operator spends a run finding out.
    const missing = missingServiceFeatures(this.catalog.build);
    if (missing.length > 0) {
      this.setStatus('error', 'ai.staleService', {
        build: this.catalog.build?.fingerprint ?? '?',
        missing: missing.join(', '),
      });
    }

    this.restorePrefs();
    this.applyActiveFrameId();
    void this.applyActiveFrameImage();
    this.paintMirrorState();
    this.onProviderChange();
    this.onStrategyChange();
    this.onImageEngineChange();
    if (missing.length === 0) this.setStatus('idle', 'ai.ready');
  }

  // ------------------------------------------------------------ preferences

  private readStore(name: string): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem(name) || '{}');
    } catch {
      return {};
    }
  }

  /**
   * Pre-fills the Capri identifier from whichever frame is actually on screen, so a
   * customer trying on a real product never has to find or type this field to get the
   * right measurements. Runs after {@link restorePrefs} and wins over it: a remembered
   * value from a previous product tried in this same browser is exactly the kind of
   * stale identifier this replaces.
   *
   * Only for identifiers that look like a real catalogue code (letters then digits,
   * e.g. "DC384") — the bundled demo SKUs ("classic-aviator", "sample-frame") are not
   * Capri codes, and activating the protocol with one would just waste a lookup that
   * can only come back "not detected".
   *
   * The colour (`?color=` from TryOn3D.jsx, already in English off the supplier's own
   * catalogue — "Black", "Light Blue") is appended the same way an operator would type
   * it by hand ("DC210 Black Green Red", per capri_prompt.py's own example): the
   * technical table on a Capri product page has one row per colour variant, and without
   * it the model has no way to tell which row is this one.
   */
  private applyActiveFrameId(): void {
    if (!this.frameIdInput) return;
    const sku = this.host.getActiveFrame().sku || '';
    if (!/^[a-z]{1,6}\d/i.test(sku)) return;
    const color = new URLSearchParams(location.search).get('color');
    this.frameIdInput.value = color ? `${sku.toUpperCase()} ${color}` : sku.toUpperCase();
  }

  /**
   * Pre-fills "Imagen del espejuelo" from the storefront's own catalog photo of the
   * frame the customer is actually trying on (`?glassesImageUrl=` from TryOn3D.jsx), so
   * they never have to find or upload a picture of a frame they are already wearing on
   * screen. Best-effort: a failed fetch (network, disallowed host, oversized image)
   * just leaves the drop zone empty for a manual upload, exactly as if the URL had
   * never been given — it never blocks the rest of the panel.
   */
  private async applyActiveFrameImage(): Promise<void> {
    if (this.glassesImage) return;
    const url = new URLSearchParams(location.search).get('glassesImageUrl');
    if (!url) return;

    // Retried once: this is usually the very first request this browser tab makes to
    // the backend, and a backend container that just restarted (a fresh deploy) can be
    // slow to answer its first request while it finishes booting. One retry after a
    // short pause costs little and turns "cold start" into a non-issue instead of a
    // silently empty drop zone the customer has to notice and fix by hand.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        this.glassesImage = await fetchProxiedImage(url);
        this.showPreview(this.glassesPreview, this.glassesImage);
        this.updateRunState();
        return;
      } catch (error: any) {
        console.warn(
          `[VTO] No se pudo precargar la imagen de la montura (intento ${attempt + 1}/2):`,
          error?.message ?? error
        );
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  }

  private restorePrefs(): void {
    const prefs = this.readStore(PREFS_STORAGE);
    // A stored render setting came from a deliberate choice in an earlier session, so
    // it outranks the automatic one just as a fresh click would.
    if (prefs.renderChoiceIsUsers === 'true') this.renderChoiceIsUsers = true;
    if (this.providerSelect && prefs.provider) this.providerSelect.value = prefs.provider;
    if (this.strategySelect && prefs.strategy) this.strategySelect.value = prefs.strategy;
    if (this.modelInput && prefs.model) this.modelInput.value = prefs.model;
    if (this.imageEngineSelect && prefs.imageEngine) this.imageEngineSelect.value = prefs.imageEngine;
    if (this.frameIdInput && prefs.frameId) this.frameIdInput.value = prefs.frameId;
    if (this.practiceInput && prefs.practice) this.practiceInput.value = prefs.practice;
    if (prefs.previewMirrored) this.previewMirrored = prefs.previewMirrored === 'true';
    if (this.extraInput && prefs.extraInstructions) {
      this.extraInput.value = prefs.extraInstructions;
    }
    this.paintExtraHint();
    if (this.profileCheck && prefs.renderProfile) {
      this.profileCheck.checked = prefs.renderProfile === 'true';
    }
  }

  private savePrefs(): void {
    try {
      localStorage.setItem(
        PREFS_STORAGE,
        JSON.stringify({
          provider: this.providerSelect?.value ?? '',
          strategy: this.strategySelect?.value ?? '',
          model: this.modelInput?.value ?? '',
          imageEngine: this.imageEngineSelect?.value ?? '',
          renderProfile: String(this.profileCheck?.checked ?? false),
          renderChoiceIsUsers: String(this.renderChoiceIsUsers),
          extraInstructions: this.extraInput?.value ?? '',
          frameId: this.frameIdInput?.value ?? '',
          practice: this.practiceInput?.value ?? '',
          previewMirrored: String(this.previewMirrored),
        })
      );
    } catch {
      /* private browsing: preferences are a convenience, never a requirement */
    }
  }

  /**
   * Keys are held in localStorage only when the operator opts in, and only ever leave
   * the browser towards this application's own endpoint.
   */
  private persistKey(): void {
    const provider = this.providerSelect?.value;
    if (!provider || !this.keyInput) return;

    const store = this.readStore(KEY_STORAGE);
    if (this.rememberKey?.checked && this.keyInput.value.trim()) {
      store[provider] = this.keyInput.value.trim();
    } else {
      delete store[provider];
    }

    try {
      localStorage.setItem(KEY_STORAGE, JSON.stringify(store));
    } catch {
      /* ignore */
    }
  }

  /**
   * Replaces the model suggestions with what the vendor says this key can call.
   *
   * The bundled defaults are a snapshot: Gemini retired `gemini-2.5-pro` for new keys and
   * the only symptom was a 404 mid-fitting. This turns "guess a name" into "pick one that
   * exists", using the key already in the panel.
   */
  private async refreshModels(): Promise<void> {
    const provider = this.providerSelect?.value;
    if (!provider || !this.modelHint) return;

    this.modelHint.className = 'ai-hint';
    this.modelHint.textContent = t('ai.modelsLoading');

    const catalog = await fetchModelCatalog(provider, this.keyInput?.value.trim());

    if (!catalog.ok || !catalog.models) {
      this.modelHint.className = 'ai-hint ai-bad';
      this.modelHint.textContent = catalog.error ?? t('ai.modelsFailed');
      return;
    }

    if (this.modelList) {
      this.modelList.innerHTML = catalog.models
        .map((m) => `<option value="${m.id}">${m.label !== m.id ? m.label : ''}</option>`)
        .join('');
    }

    // Whether the name currently typed is among them is the question that was actually
    // asked: a stale default looks fine until it 404s.
    const current = this.modelInput?.value.trim();
    const known = catalog.models.some((m) => m.id === current);
    this.modelHint.className = `ai-hint ${known ? 'ai-ok' : 'ai-bad'}`;
    this.modelHint.textContent = known
      ? t('ai.modelsOk', { n: catalog.models.length, model: current ?? '' })
      : t('ai.modelsUnknown', { n: catalog.models.length, model: current ?? '' });
  }

  /**
   * Turns the picture on when the chosen vendor can draw one.
   *
   * OpenAI and Gemini measure AND generate images, so selecting one of them almost
   * always means wanting the composite and the side view too. Doing it by hand every
   * time is friction for no decision. The moment the operator sets either control
   * themselves, this stops touching them.
   */
  private applyRenderDefaults(providerId: string): void {
    if (this.renderChoiceIsUsers) return;

    // Read from the catalogue rather than a hardcoded pair: whatever the service says
    // can produce an image is what qualifies.
    const canRender = this.catalog?.imageEngines.some((e) => e.id === providerId);
    if (!canRender) return;

    if (this.imageEngineSelect) this.imageEngineSelect.value = providerId;
    if (this.profileCheck && !this.profileCheck.disabled) this.profileCheck.checked = true;

    this.onImageEngineChange();
    this.savePrefs();
  }

  /**
   * Says what the note does, and how much room is left.
   *
   * The cap is enforced on the server too; showing it here means the operator finds out
   * while writing rather than by having a sentence silently truncated mid-word.
   */
  private paintExtraHint(): void {
    const hint = document.getElementById('ai-extra-hint');
    if (!hint) return;

    const used = this.extraInput?.value.trim().length ?? 0;
    const max = 2000;
    hint.textContent = used
      ? t('ai.extraCount', { n: String(used), max: String(max) })
      : t('ai.extraHint', { max: String(max) });
    hint.className = used > max ? 'ai-hint ai-bad' : 'ai-hint';
  }

  private onProviderChange(): void {
    const info = this.currentProvider();
    if (!info) return;

    this.applyRenderDefaults(info.id);

    if (this.modelInput) {
      this.modelInput.value = info.defaultModel;
      this.modelInput.placeholder = info.defaultModel;
    }
    if (this.modelList) {
      this.modelList.innerHTML = info.suggestedModels
        .map((m) => `<option value="${m}"></option>`)
        .join('');
    }

    const stored = this.readStore(KEY_STORAGE)[info.id] ?? '';
    if (this.keyInput) {
      this.keyInput.value = stored;
      this.keyInput.placeholder = info.hasServerKey
        ? t('ai.keyFromServer', { env: info.envKeys[0] })
        : t('ai.keyRequired', { env: info.envKeys[0] });
    }
    if (this.rememberKey) this.rememberKey.checked = Boolean(stored);

    if (this.keyHint) {
      this.keyHint.innerHTML = info.hasServerKey
        ? `<span class="ai-ok">${t('ai.keyConfigured', { env: info.envKeys.join(' / ') })}</span>`
        : t('ai.keyMissing', { env: info.envKeys.join(' / '), url: info.docsUrl });
    }

    if (this.modelHint) {
      // The listing belonged to the previous vendor: clear it rather than leave a
      // verdict that no longer refers to the model in the field.
      this.modelHint.textContent = '';
      this.modelHint.className = 'ai-hint';
    }

    this.savePrefs();
  }

  private onStrategyChange(): void {
    const value = this.strategySelect?.value ?? 'B';
    const info = this.catalog?.strategies.find((s) => s.id === value);
    if (this.strategyNote) {
      this.strategyNote.textContent = info ? info.description : t('ai.strategyCompareNote');
    }
    this.savePrefs();
  }

  /**
   * The two kinds of render engine want opposite things, so the note has to say which
   * one is selected: the local composite needs a tracked capture and no key, an image
   * model needs a key and works on any photo.
   */
  /** Keeps the profile option honest about what the chosen engine can actually do. */
  private syncProfileOption(): void {
    if (!this.profileCheck) return;
    const engine = this.imageEngineSelect?.value ?? 'local';
    const localOnly = engine === 'local';

    // The deterministic compositor has no side photograph to work from and does not
    // invent one. Offering the option there would promise something it will refuse.
    this.profileCheck.disabled = localOnly;
    if (localOnly) this.profileCheck.checked = false;

    const alter = document.getElementById('ai-alter-warning');
    if (alter) {
      // Only the deterministic composite is incapable of changing the patient: it
      // pastes onto the original pixels. A generative model rewrites the picture, so
      // no prompt can promise the face comes back untouched.
      alter.textContent = localOnly ? t('ai.alterSafe') : t('ai.alterWarning');
      alter.className = localOnly ? 'ai-hint ai-ok' : 'ai-hint ai-bad';
    }

    const hint = document.getElementById('ai-profile-hint');
    if (hint) hint.textContent = localOnly ? t('ai.profileNeedsAi') : t('ai.profileCost');
  }

  private onImageEngineChange(): void {
    const engine = this.currentImageEngine();
    if (this.imageModelInput) {
      this.imageModelInput.value = engine?.defaultModel ?? '';
      this.imageModelInput.placeholder = engine?.defaultModel ?? '';
      this.imageModelInput.disabled = !engine || !engine.requiresKey;
    }
    if (this.imageNote) {
      if (!engine) {
        this.imageNote.textContent = '';
      } else if (engine.requiresContext) {
        this.imageNote.textContent = t('ai.imageLocalNote');
      } else {
        this.imageNote.textContent = t('ai.imageAiNote');
      }
    }
    this.savePrefs();

    this.syncProfileOption();
  }

  private currentImageEngine(): ImageEngineInfo | null {
    const id = this.imageEngineSelect?.value;
    return this.catalog?.imageEngines.find((e) => e.id === id) ?? null;
  }

  private currentProvider(): ProviderInfo | null {
    const id = this.providerSelect?.value;
    return this.catalog?.providers.find((p) => p.id === id) ?? null;
  }

  // -------------------------------------------------------------- capturing

  /**
   * Grabs the current webcam frame.
   *
   * The feed is shown mirrored by CSS, but `drawImage` reads the underlying stream, so
   * the captured photograph is the true, unmirrored view. That matters: OD/OS laterality
   * in the report would otherwise be swapped.
   */
  private captureFace(): void {
    const video = this.host.getVideoElement();
    if (!video || !video.videoWidth) {
      this.setStatus('error', 'ai.noCamera');
      return;
    }

    const snapshot = this.host.getSnapshot();

    const maxEdge = 1568;
    const ratio = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * ratio);
    canvas.height = Math.round(video.videoHeight * ratio);
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);

    // A new capture is, as far as this panel can tell, a new patient. Keeping the
    // previous report on screen next to a new face is the one mix-up that could put
    // somebody else's millimetres on a prescription.
    this.discardPreviousRun();

    this.faceImage = canvas.toDataURL('image/jpeg', 0.92);
    this.captureContext = this.buildContext(snapshot, video.videoWidth, video.videoHeight);
    // The live tracker already vouches for this frame having exactly one face
    this.faceCheck = { code: 'ok', faces: 1 };
    this.showPreview(this.facePreview, this.faceImage);
    this.lastSnapshot = snapshot;
    this.renderCaptureQuality(snapshot);
    this.updateRunState();
  }

  private async loadFaceFromFile(file: File): Promise<void> {
    try {
      this.faceImage = await fileToScaledDataURL(file);
    } catch (error: any) {
      this.setStatusVerbatim('error', error?.message ?? String(error));
      return;
    }

    // Same reasoning as a fresh capture: a different face invalidates the last report
    this.discardPreviousRun();

    // An uploaded photo was not taken through the tracker, so there is no calibrated
    // scale to hand the model: proposal B has nothing to stand on and must not pretend
    // otherwise.
    this.captureContext = null;
    this.showPreview(this.facePreview, this.faceImage);
    if (this.captureQuality) {
      this.captureQuality.className = 'ai-quality warn';
      this.captureQuality.textContent = t('ai.qualityUploaded');
    }

    // An uploaded photo has not been through the tracker, so nothing yet vouches for it
    // containing exactly one person. Check it now, for free, rather than paying a
    // provider to tell us the picture was wrong.
    void this.verifyFacePhoto();
    if (this.strategySelect && this.strategySelect.value !== 'A') {
      this.strategySelect.value = 'A';
      this.onStrategyChange();
    }
    this.updateRunState();
  }

  private async loadGlassesFromFile(file: File): Promise<void> {
    try {
      this.glassesImage = await fileToScaledDataURL(file);
    } catch (error: any) {
      this.setStatusVerbatim('error', error?.message ?? String(error));
      return;
    }
    this.showPreview(this.glassesPreview, this.glassesImage);
    this.updateRunState();
  }

  private showPreview(img: HTMLImageElement | null, dataUrl: string): void {
    if (!img) return;
    img.src = dataUrl;
    img.classList.remove('hidden');
    img.closest('.ai-drop')?.classList.add('has-image');
  }

  /**
   * Tells the operator whether the shot they just took is one the measurement can rest
   * on. A bad frontal photo is the single largest error source in this flow, and it is
   * cheap to retake — but only if the problem is stated at the moment of capture.
   */
  private renderCaptureQuality(snapshot: CaptureSnapshot): void {
    if (!this.captureQuality) return;

    const problems: string[] = [];
    if (!snapshot.faceDetected) problems.push(t('ai.qNoFace'));
    if (snapshot.faceDetected && !snapshot.isFrontal) {
      problems.push(t('ai.qNotFrontal', { detail: snapshot.poseWarning }));
    }

    const distance = snapshot.measurements?.captureDistance;
    if (distance && distance.centimetres !== null && !distance.withinRecommendedRange) {
      problems.push(t('ai.qDistance', { cm: distance.centimetres.toFixed(0) }));
    }

    const card = snapshot.measurements?.creditCardCalibration;
    const calibrated = Boolean(card?.active && card?.accepted);

    if (problems.length === 0) {
      this.captureQuality.className = 'ai-quality ok';
      this.captureQuality.textContent = calibrated
        ? t('ai.qualityCalibrated')
        : t('ai.qualityGood');
      return;
    }

    this.captureQuality.className = 'ai-quality warn';
    this.captureQuality.textContent = `${t('ai.qualityIssues')} ${problems.join(' · ')}`;
  }

  /**
   * The measured context handed to proposal B.
   *
   * This is the whole difference between the two proposals: everything in here is a
   * figure the local pipeline actually measured, so the model is told to treat the
   * scale as ground truth instead of inventing one from the pixels.
   */
  private buildContext(
    snapshot: CaptureSnapshot,
    imageWidth: number,
    imageHeight: number
  ): Record<string, unknown> | null {
    const m = snapshot.measurements;
    if (!snapshot.faceDetected || !m || !snapshot.landmarks) return null;

    const lms = snapshot.landmarks;
    const point = (index: number) => {
      const p = lms[index];
      return p ? { x: Number(p.x.toFixed(5)), y: Number(p.y.toFixed(5)) } : null;
    };

    const rightPupil = point(LM.rightPupil);
    const leftPupil = point(LM.leftPupil);

    // Millimetres per normalized image unit, read back from the figure the calculator
    // produced rather than recomputed, so the model gets the exact scale the panel used.
    let mmPerNormalizedUnit: number | null = null;
    if (rightPupil && leftPupil && m.pupillaryDistance.pdTotal > 0) {
      const normDistance = Math.hypot(leftPupil.x - rightPupil.x, leftPupil.y - rightPupil.y);
      if (normDistance > 1e-6) {
        mmPerNormalizedUnit = Number((m.pupillaryDistance.pdTotal / normDistance).toFixed(3));
      }
    }

    const card = m.creditCardCalibration;
    const frame = this.host.getActiveFrame();

    return {
      capture: {
        imageWidthPx: imageWidth,
        imageHeightPx: imageHeight,
        mirrored: false,
        timestamp: new Date().toISOString(),
        note:
          'Landmark coordinates are normalized to [0,1] over the image; x by width, ' +
          'y by height. The image is NOT mirrored.',
      },
      scale: {
        millimetresPerNormalizedXUnit: mmPerNormalizedUnit,
        source: card?.active && card?.accepted ? 'iso-7810-card' : 'facial-estimator',
        cardApparentWidthPx: card?.apparentWidthPx ?? null,
        cardAccepted: Boolean(card?.accepted),
        verticalScaleFactor:
          imageWidth > 0 ? Number((imageHeight / imageWidth).toFixed(4)) : null,
      },
      pose: {
        isFrontal: snapshot.isFrontal,
        warning: snapshot.poseWarning || null,
        pantoscopicTiltDeg: m.ergonomicsAndEarFit.pantoscopicTiltDeg,
        earAlignmentRatio: m.ergonomicsAndEarFit.earAlignmentRatio,
      },
      captureDistance: {
        millimetres: m.captureDistance.millimetres,
        method: m.captureDistance.method,
        withinRecommendedRange: m.captureDistance.withinRecommendedRange,
      },
      measuredFacial: {
        pdTotalMM: m.pupillaryDistance.pdTotal,
        pdRightMM: m.pupillaryDistance.pdRight,
        pdLeftMM: m.pupillaryDistance.pdLeft,
        fittingHeightRightMM: m.fittingHeight.heightRight,
        fittingHeightLeftMM: m.fittingHeight.heightLeft,
        fittingHeightSource: m.fittingHeight.source,
        headWidthMM: m.ergonomicsAndEarFit.headWidthMM,
        templeReachDepthMM: m.ergonomicsAndEarFit.templeReachDepthMM,
        outOfRangeFlags: m.outOfRange,
      },
      landmarksNormalized: {
        rightPupil,
        leftPupil,
        rightEar: point(LM.rightEar),
        leftEar: point(LM.leftEar),
        chin: point(LM.chin),
        forehead: point(LM.forehead),
        noseTip: point(LM.noseTip),
        note: 'right/left are the PATIENT\'s right and left, not screen sides.',
      },
      catalogFrameOnScreen: {
        sku: frame.sku,
        name: frame.name,
        totalFrontWidthMM: frame.totalWidthMM,
        lensHeightBMM: frame.lensHeightBMM,
        note:
          'This is the 3D catalogue frame the live try-on was showing. It is NOT the ' +
          'frame in IMAGE 2 unless they happen to be the same product.',
      },
    };
  }

  // ------------------------------------------------------------------- run

  private updateRunState(): void {
    if (this.runButton) {
      // Disabled while a run is in flight: a second click would start a second paid
      // request against the same capture.
      this.runButton.disabled = this.running || !this.faceImage || !this.glassesImage;
      this.runButton.classList.toggle('hidden', this.running);
    }
    // Cancel takes its place, so the control under the pointer is always the useful one
    document.getElementById('btn-ai-cancel')?.classList.toggle('hidden', !this.running);
  }

  /**
   * Abandons the run in flight.
   *
   * This stops the browser waiting and frees the panel for another attempt. It does not
   * un-spend tokens already committed to the provider — the request is on its way — so
   * the message says so rather than implying a refund.
   */
  private cancelRun(): void {
    if (!this.inFlight) return;
    this.inFlight.abort();
    this.setStatus('idle', 'ai.cancelling');
  }

  /** Adds a finished request to the session running total, and repaints the readout. */
  private recordCost(cost?: CostSummary): void {
    if (cost) {
      this.sessionCost.totalCost += cost.totalCost || 0;
      this.sessionCost.totalTokens += cost.totalTokens || 0;
      this.sessionCost.calls += (cost.pricedCalls || 0) + (cost.unpricedCalls || 0);
      this.sessionCost.unpriced += cost.unpricedCalls || 0;
    }
    this.paintSessionCost();
  }

  /**
   * The session total, in the panel.
   *
   * Deliberately labelled an estimate: the rates are list prices copied by hand into
   * pricing.py, and a figure on an invoice-shaped screen invites more trust than it has
   * earned.
   */
  private paintSessionCost(): void {
    const box = document.getElementById('ai-session-cost');
    if (!box) return;

    if (this.sessionCost.calls === 0) {
      box.textContent = '';
      box.className = 'ai-session-cost';
      return;
    }

    const parts = [
      t('ai.sessionCost', {
        usd: this.sessionCost.totalCost.toFixed(4),
        tokens: this.sessionCost.totalTokens.toLocaleString(),
        calls: String(this.sessionCost.calls),
      }),
    ];
    if (this.sessionCost.unpriced > 0) {
      parts.push(t('ai.sessionUnpriced', { n: String(this.sessionCost.unpriced) }));
    }
    box.textContent = parts.join(' ');
    box.className = 'ai-session-cost visible';
  }

  /**
   * Throws away everything the previous run produced.
   *
   * Called before the validation guards, not after them. A guard used to return with the
   * previous report still on screen and still in `lastResults`, so a fresh error message
   * sat above stale measurements — and "Descargar informe" would have written the earlier
   * patient's numbers into a file stamped with today's time.
   */
  private discardPreviousRun(): void {
    this.lastResults = [];
    this.lastTryOn = null;
    this.lastProfile = null;
    if (this.resultsBox) this.resultsBox.innerHTML = '';
    if (this.tryOnBox) this.tryOnBox.innerHTML = '';
    this.exportButton?.classList.add('hidden');
  }

  /**
   * Counts the faces in the uploaded photo, in the browser.
   *
   * Zero faces or a group shot make every downstream figure meaningless: "the patient's
   * PD" has no referent in a photo of two people. Catching that here costs nothing and
   * saves both a paid request and a report full of numbers about nobody in particular.
   *
   * A detector that cannot load does NOT block the run — the operator is told the check
   * could not be made, and decides.
   */
  /**
   * Applies the mirror choice to the face thumbnail and says what it means.
   *
   * The distinction this makes visible is not cosmetic: mirrored, the patient's right eye
   * sits on the right of the picture, which is what the operator just watched on the live
   * feed. Unmirrored — the image actually sent — it sits on the left, the way it does in
   * any ordinary photograph of a person, which is the orientation the model reads OD/OS
   * from. Both are correct views of the same capture; only one is the one being measured.
   */
  private paintMirrorState(): void {
    const button = document.getElementById('btn-ai-mirror');
    const note = document.getElementById('ai-mirror-note');

    this.facePreview?.classList.toggle('mirrored', this.previewMirrored);
    button?.classList.toggle('active', this.previewMirrored);
    button?.setAttribute('aria-pressed', String(this.previewMirrored));

    if (note) {
      note.textContent = this.previewMirrored
        ? t('ai.mirrorOnNote')
        : t('ai.mirrorOffNote');
    }
  }

  private async verifyFacePhoto(): Promise<void> {
    if (!this.faceImage || !this.captureQuality) return;

    this.faceCheck = null;
    this.captureQuality.className = 'ai-quality';
    this.captureQuality.textContent = t('ai.faceChecking');

    const check = await checkSingleFace(this.faceImage);
    this.faceCheck = check;

    if (check.code === 'ok') {
      this.captureQuality.className = 'ai-quality warn';
      this.captureQuality.textContent = t('ai.qualityUploaded');
    } else if (check.code === 'unavailable') {
      this.captureQuality.className = 'ai-quality warn';
      this.captureQuality.textContent = t('ai.faceCheckUnavailable');
    } else {
      this.captureQuality.className = 'ai-quality bad';
      this.captureQuality.textContent =
        check.code === 'no-face'
          ? t('ai.faceCheckNone')
          : t('ai.faceCheckMany', { n: String(check.faces) });
    }

    this.updateRunState();
  }

  private async run(): Promise<void> {
    if (!this.faceImage || !this.glassesImage || this.running) return;

    // Nothing from the previous run survives into this one, whatever happens below
    this.discardPreviousRun();

    // A photo that does not show exactly one person cannot produce a measurement of
    // anybody. Refuse here rather than pay to be told the same thing.
    if (this.faceCheck && (this.faceCheck.code === 'no-face' || this.faceCheck.code === 'many-faces')) {
      this.setStatus(
        'error',
        this.faceCheck.code === 'no-face' ? 'ai.faceCheckNone' : 'ai.faceCheckMany',
        { n: String(this.faceCheck.faces) }
      );
      return;
    }

    const provider = this.providerSelect?.value ?? 'openai';
    const strategy = this.strategySelect?.value ?? 'B';

    if ((strategy === 'B' || strategy === 'AB') && !this.captureContext) {
      this.setStatus('error', 'ai.needsTrackedCapture');
      return;
    }

    // Neither the panel nor the server has a key: say so here rather than paying for a
    // round trip to be told the same thing.
    const info = this.currentProvider();
    const typedKey = this.keyInput?.value.trim();
    if (info && !typedKey && !info.hasServerKey) {
      this.setStatus('error', 'ai.keyMissingWithEnv', { env: info.envKeys.join(' / ') });
      return;
    }

    const imageEngine = this.imageEngineSelect?.value ?? 'local';
    const imageProvider = this.catalog?.providers.find((p) => p.id === imageEngine);
    if (imageProvider && !typedKey && !imageProvider.hasServerKey) {
      this.setStatus('error', 'ai.keyMissingWithEnv', {
        env: imageProvider.envKeys.join(' / '),
      });
      return;
    }

    if (imageEngine === 'local' && !this.captureContext) {
      // The deterministic composite is placed from the tracked landmarks; without them
      // there is nothing to place it against. Say so before spending a request.
      this.setStatus('error', 'ai.imageNeedsCapture');
      return;
    }

    this.running = true;
    this.inFlight = new AbortController();
    this.updateRunState();
    this.startElapsed();

    try {
      const response = await requestMeasurement({
        faceImage: this.faceImage,
        glassesImage: this.glassesImage,
        provider,
        model: this.modelInput?.value.trim() || undefined,
        apiKey: this.keyInput?.value.trim() || undefined,
        strategy,
        context: this.captureContext,
        lang: getLang(),
        renderTryOn: true,
        imageEngine,
        imageModel: this.imageModelInput?.value.trim() || undefined,
        renderProfile: this.profileCheck?.checked ?? false,
        extraInstructions: this.extraInput?.value.trim() || undefined,
        frameId: this.frameIdInput?.value.trim() || undefined,
      }, this.inFlight.signal);

      const results = response.results;
      this.lastResults = results;
      this.lastTryOn = response.tryOn ?? null;
      this.lastProfile = response.tryOnProfile ?? null;
      this.renderTryOn(response.tryOn ?? null);
      this.renderResults(results);

      // Stored before anything else can go wrong with the DOM: from here on the run
      // survives a reload, and the report page in another tab can pick it up. Awaited
      // because building the frame thumbnail is asynchronous, and letting the rest of
      // this method run first would put the "open report" button on screen before the
      // report it opens actually exists.
      await this.persistRun(results, this.lastTryOn);

      // Counted before the verdict: a proposal that failed still spent tokens.
      this.recordCost(response.cost);

      // Stamped by the service, one per HTTP request. Shown so the operator can tie what
      // is on screen to a line in the log — the difference between trusting that runs do
      // not mix and being able to check it.
      const requestId = response.requestId ?? results[0]?.requestId;
      if (requestId) console.log(`[VTO] Petición de medición ${requestId}`);

      const okCount = results.filter((r) => r.ok).length;
      if (okCount === 0) {
        // "Revisa el detalle del error" is not help when the detail is off-screen below.
        // With a single failed proposal its message IS the detail, so show it here.
        const firstError = results.find((r) => !r.ok)?.error;
        if (results.length === 1 && firstError) {
          this.setStatusVerbatim('error', firstError);
        } else {
          this.setStatus('error', 'ai.allFailed');
        }
      } else {
        this.setStatus('ok', 'ai.done', { n: okCount });
      }

      // The results are appended below a long form; on a laptop they start off-screen.
      // Bring them into view rather than leaving the operator to discover the scroll.
      this.resultsBox?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error: any) {
      // An abort is the operator's own decision, not a fault to report as one.
      if (error?.name === 'AbortError') {
        this.setStatus('idle', 'ai.cancelled');
      } else {
        this.setStatusVerbatim('error', error?.message ?? String(error));
      }
    } finally {
      this.inFlight = null;
      this.stopElapsed();
      this.running = false;
      this.updateRunState();
      this.savePrefs();
    }
  }

  /**
   * Counts the wait out loud.
   *
   * A reasoning model can take minutes, and the panel used to show one frozen line for
   * the whole time. A run was lost exactly that way: the operator read the stillness as
   * a hang, reloaded, and the answer arrived on the server with nobody left to receive
   * it. So the seconds tick, and the warning about reloading is on screen while it
   * matters.
   */
  private startElapsed(): void {
    const started = Date.now();
    const paint = () => {
      const seconds = Math.round((Date.now() - started) / 1000);
      this.setStatus('busy', 'ai.analysingFor', { s: String(seconds) });
    };
    paint();
    this.stopElapsed();
    this.elapsedTimer = window.setInterval(paint, 1000);
  }

  private stopElapsed(): void {
    if (this.elapsedTimer !== null) {
      window.clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
  }

  /**
   * Keeps the finished run where a reload cannot reach it, and where a second tab can.
   *
   * Called for every run, including one where every proposal failed: an error the
   * operator can reopen and read at leisure is worth more than one that vanishes with
   * the next click.
   */
  private async persistRun(
    results: MeasureResult[],
    tryOn: TryOnResult | null
  ): Promise<void> {
    // Best effort: a thumbnail that cannot be produced must not cost us the report.
    let frameImage: string | undefined;
    try {
      frameImage = this.glassesImage
        ? await dataUrlToThumbnail(this.glassesImage)
        : undefined;
    } catch {
      frameImage = undefined;
    }

    const run: StoredRun = {
      finishedAt: new Date().toISOString(),
      engine: {
        provider: this.providerSelect?.value ?? '',
        model: this.modelInput?.value.trim() ?? '',
        strategy: this.strategySelect?.value ?? '',
        imageEngine: this.imageEngineSelect?.value ?? '',
        extraInstructions: this.extraInput?.value.trim() || undefined,
        frameId: this.frameIdInput?.value.trim() || undefined,
      },
      patient: this.patientInput?.value.trim() || undefined,
      practice: this.practiceInput?.value.trim() || undefined,
      frameImage,
      context: this.captureContext,
      results,
      tryOn,
      tryOnProfile: this.lastProfile,
    };

    const stored = saveRun(run);
    const openButton = document.getElementById('btn-ai-open-report');
    openButton?.classList.toggle('hidden', !stored);

    if (!stored) {
      console.warn('[VTO] El informe no cabe en localStorage; solo queda en esta pestaña.');
    }
  }

  // -------------------------------------------------------------- rendering

  private setStatus(
    state: 'idle' | 'busy' | 'ok' | 'error',
    key: string,
    vars?: Record<string, string | number>
  ): void {
    this.lastStatus = { state, key, vars };
    this.paintStatus();
  }

  /**
   * Puts a message on screen that the provider wrote, in the provider's own words.
   *
   * Kept separate from `setStatus` because there is nothing to translate here: a vendor
   * error arrives as one finished sentence. Recording no key means a language switch
   * leaves it exactly as it is, which is the honest outcome.
   */
  private setStatusVerbatim(state: 'idle' | 'busy' | 'ok' | 'error', text: string): void {
    this.lastStatus = null;
    if (!this.statusBox) return;
    this.statusBox.className = `ai-status ai-status-${state}`;
    this.statusBox.textContent = text;
  }

  private paintStatus(): void {
    if (!this.statusBox || !this.lastStatus) return;
    const { state, key, vars } = this.lastStatus;
    this.statusBox.className = `ai-status ai-status-${state}`;
    this.statusBox.textContent = t(key, vars);
  }

  /** Paints the composed picture through the shared renderer. */
  private renderTryOn(tryOn: TryOnResult | null): void {
    if (!this.tryOnBox) return;
    this.tryOnBox.innerHTML = renderTryOnHtml(tryOn, 'btn-ai-save-image', this.lastProfile);

    // The button is re-created with the markup, so it is wired here rather than once
    document
      .getElementById('btn-ai-save-image')
      ?.addEventListener('click', () => this.saveTryOnImage());
  }

  /** Downloads the composed picture as a file the optician can attach to the record. */
  private saveTryOnImage(): void {
    const url = this.lastTryOn?.imageDataUrl;
    if (!url) return;

    const a = document.createElement('a');
    a.href = url;
    a.download = `tryon_${this.lastTryOn?.method ?? 'image'}_${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  private renderResults(results: MeasureResult[]): void {
    if (!this.resultsBox) return;
    this.resultsBox.innerHTML = renderResultsHtml(results, {
      frameId: this.frameIdInput?.value.trim() || undefined,
    });
    attachRawToggles(this.resultsBox);
    if (this.exportButton) this.exportButton.classList.remove('hidden');
  }

  /** Hands the optician the full run, inputs and engine included, as one JSON file. */
  private exportReport(): void {
    if (!this.lastResults.length) return;

    const payload = {
      generatedAt: new Date().toISOString(),
      source: 'RUBILENS VTO · medición multimodal',
      capture: {
        hasTrackedContext: this.captureContext !== null,
        context: this.captureContext,
      },
      engine: {
        provider: this.providerSelect?.value ?? null,
        model: this.modelInput?.value ?? null,
        strategy: this.strategySelect?.value ?? null,
      },
      tryOn: this.lastTryOn
        ? {
            ok: this.lastTryOn.ok,
            method: this.lastTryOn.method,
            provider: this.lastTryOn.provider,
            model: this.lastTryOn.model,
            geometry: this.lastTryOn.geometry,
            note: this.lastTryOn.note,
            error: this.lastTryOn.error,
            // Embedded so the report file is self-contained for the lab
            imageDataUrl: this.lastTryOn.imageDataUrl,
          }
        : null,
      results: this.lastResults.map(({ rawText, ...rest }) => rest),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai_measurement_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

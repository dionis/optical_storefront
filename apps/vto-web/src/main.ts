import * as THREE from 'three';
import { SceneManager } from './scene_manager';
import { FaceTracker } from './face_tracker';
import { VTOManager } from './vto_manager';
import { OpticalCalculator, OpticalMeasurements } from './optical_calculator';
import { HUDRenderer } from './hud_renderer';
import { ReferenceChecker } from './reference_checker';
import { t, setLang, getLang, applyTranslations, onLangChange, Lang } from './i18n';
import { viewTransform, ViewTransform } from './view_transform';
import {
  VisionMeasurePanel,
  VisionPanelHost,
  CaptureSnapshot,
  ActiveFrameInfo,
} from './vision_measure_panel';
import { FITTING_CONFIG } from './fitting_config';
import { measureLensHeightB } from './frame_height';
import { parseFrameDescriptorText, type FrameDescriptor } from './frame_descriptor';
import { measureFrame } from './frame_metrology';
import { evaluateFrame, type FrameEvaluation, type EvaluationRow } from './frame_evaluation';
import { checkIdentity, basenameOf, type IdentityCheck } from './frame_pair_loader';
import { computeOpticalHeights } from './optical_heights';

/**
 * Bumped by hand whenever the try-on maths changes. Printed by the ?debug=1 overlay so a
 * screenshot from a handset says immediately whether the deployment is running the code
 * being reasoned about — the alternative is debugging a bundle that was never shipped.
 */
const BUILD_STAMP = '2026-08-25-depth-coherent';

/** The three heights the phone sheet settles on. */
type SheetState = 'peek' | 'half' | 'full';

/** How long model loading may run before it is reported as failed rather than hung. */
const MODEL_LOAD_TIMEOUT_MS = 20000;

/** Rejects with `message` if `promise` has not settled within `ms` — never hangs silently. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

class VTOApp {
  private sceneManager: SceneManager;
  private faceTracker: FaceTracker;
  private vtoManager: VTOManager;
  private opticalCalculator: OpticalCalculator;
  private hudRenderer: HUDRenderer;
  private referenceChecker: ReferenceChecker;

  // DOM elements
  private statusBadge: HTMLElement;
  private statusText: HTMLElement;
  private faceGuide: HTMLElement;
  private poseWarning: HTMLElement;
  private poseWarningText: HTMLElement;
  private referenceCard: HTMLElement;

  private valPd: HTMLElement;
  private valFps: HTMLElement;

  // Same two readings, repeated on the mobile sheet handle where they stay visible at
  // every sheet height
  private mValPd: HTMLElement | null;
  private mValFps: HTMLElement | null;
  
  // Optical HUD DOM elements
  private optPdTotal: HTMLElement;
  private optPdDer: HTMLElement;
  private optPdIzq: HTMLElement;
  private optAltDer: HTMLElement;
  private optAltIzq: HTMLElement;
  private optEarStatus: HTMLElement;
  private btnDownloadJson: HTMLButtonElement;
  private btnToggleHud: HTMLButtonElement;

  // Controls & Sliders
  private sliderScale: HTMLInputElement;
  private sliderYOffset: HTMLInputElement;
  private sliderZOffset: HTMLInputElement;
  private sliderTempleWidth: HTMLInputElement;
  private checkFlipZ: HTMLInputElement;
  private btnReset: HTMLButtonElement;

  // Value displays
  private displayScale: HTMLElement;
  private displayYOffset: HTMLElement;
  private displayZOffset: HTMLElement;
  private displayTempleWidth: HTMLElement;

  // Active SKU tracking
  private activeSKU = 'classic-aviator';
  private activeSKUWidth = 142;
  private activeSKUName = 'Classic Aviator';
  // Boxing-system B of the active frame; drives the frame-geometry fitting height
  private activeSKULensHeightB: number | null = null;

  /**
   * B measured on the lens opening of the model actually installed, in mm. Null until a
   * model is installed whose aperture could be read.
   *
   * It takes precedence over the published figure because it describes the mesh on
   * screen. Without it every SKU falls back to the 45.5 mm stand-in — the four demo
   * frames publish no B — so the fitting height handed to an optician is the same number
   * whichever frame the patient is wearing.
   */
  private measuredLensHeightBMM: number | null = null;

  // Capture freeze, used while marking the calibration card
  private isFrozen = false;
  private lastResults: any = null;

  // Last tracked frame, republished to the AI measurement panel so the photo it takes
  // carries the geometry that was measured at that exact instant
  private lastLandmarks: Array<{ x: number; y: number; z: number }> | null = null;
  private lastMeasurements: OpticalMeasurements | null = null;
  private lastPoseFrontal = false;
  private lastPoseWarning = '';

  // Watches models/{sku}.glb so a model produced in Gradio is picked up on its own,
  // without the operator having to reload anything
  private modelWatchTimer: number | null = null;
  private modelSignature: string | null = null;

  // How the camera frame is currently painted; kept so the class is only toggled on change
  private appliedFit: 'cover' | 'contain' = 'cover';

  // Frames rejected for carrying landmarks outside the normalized range. Zero on a
  // healthy device; a number that climbs with the frame counter means the tracker is
  // handing back a buffer this build cannot use.
  private corruptFrames = 0;
  private lastCorruptSample = '';

  /** Corruption in a row before the GPU path is abandoned — about a second at 30 fps. */
  private static readonly CORRUPT_FRAMES_BEFORE_CPU = 30;
  private consecutiveCorrupt = 0;

  /**
   * A delegate that returns nothing at all is the other way the inference path fails, and
   * on a Galaxy S25 Plus it is the one that actually happens: the GPU delegate reported
   * success and detected no face, ever. Not corrupt landmarks — none. So the guard above
   * had nothing to reject and never fired.
   */
  private everDetected = false;
  private firstDetectAt = 0;
  /** How long a delegate may run without a single detection before it is abandoned. */
  private static readonly SILENT_MS_BEFORE_CPU = 2500;

  // On-screen diagnostic, enabled with ?debug=1
  private debugEnabled = new URLSearchParams(location.search).get('debug') === '1';
  private debugPanel: HTMLElement | null = null;

  // Which frame the scene is showing, so a failed refresh never wipes a good model
  private showingFallback = false;
  private lastModelSource: {
    state: 'generated' | 'default' | 'error' | 'uploaded';
    detail?: string;
  } | null = null;

  // GLBs the operator handed over from disk, per SKU. Kept as the raw buffer rather than
  // an installed object so switching frames and coming back re-installs it cleanly, and
  // so a re-parse always starts from exactly what was uploaded. Session-scoped on
  // purpose: a frame model is megabytes, and quietly persisting one would leave the
  // operator wondering why a SKU no longer matches what is on the server.
  private userModels = new Map<string, { buffer: ArrayBuffer; name: string }>();

  /**
   * The JSON half of the pair, per SKU. Held in memory only: a descriptor belongs to the
   * frame in front of the operator right now, and persisting it would let one frame's
   * spec sheet quietly outlive the model it was loaded for.
   */
  private frameDescriptors = new Map<string, { descriptor: FrameDescriptor; fileName: string }>();

  /** Whether the spec-sheet height table is on show. Remembered across sessions. */
  private showOpticalHeights = false;
  private static readonly HEIGHTS_KEY = 'rubilens.showOpticalHeights';

  // FPS calculations
  private lastFrameTime = 0;
  private frameCount = 0;
  private fpsInterval = 1000;
  private lastFpsUpdate = 0;

  constructor() {
    // 1. Initialize UI Elements
    this.statusBadge = document.getElementById('tracking-status')!;
    this.statusText = this.statusBadge.querySelector('.status-text')!;
    this.faceGuide = document.getElementById('face-guide')!;
    this.poseWarning = document.getElementById('pose-warning')!;
    this.poseWarningText = document.getElementById('pose-warning-text')!;
    this.referenceCard = document.getElementById('reference-card')!;

    this.valPd = document.getElementById('val-pd')!;
    this.valFps = document.getElementById('val-fps')!;
    this.mValPd = document.getElementById('m-val-pd');
    this.mValFps = document.getElementById('m-val-fps');

    // Optical Section DOM
    this.optPdTotal = document.getElementById('opt-pd-total')!;
    this.optPdDer = document.getElementById('opt-pd-der')!;
    this.optPdIzq = document.getElementById('opt-pd-izq')!;
    this.optAltDer = document.getElementById('opt-alt-der')!;
    this.optAltIzq = document.getElementById('opt-alt-izq')!;
    this.optEarStatus = document.getElementById('opt-ear-status')!;
    this.btnDownloadJson = document.getElementById('btn-download-json') as HTMLButtonElement;
    this.btnToggleHud = document.getElementById('btn-toggle-hud') as HTMLButtonElement;

    // Control Sliders & Inputs
    this.sliderScale = document.getElementById('slider-scale') as HTMLInputElement;
    this.sliderYOffset = document.getElementById('slider-y-offset') as HTMLInputElement;
    this.sliderZOffset = document.getElementById('slider-z-offset') as HTMLInputElement;
    this.sliderTempleWidth = document.getElementById('slider-temple-width') as HTMLInputElement;
    this.checkFlipZ = document.getElementById('check-flip-z') as HTMLInputElement;
    this.btnReset = document.getElementById('btn-reset') as HTMLButtonElement;

    this.displayScale = document.getElementById('val-scale')!;
    this.displayYOffset = document.getElementById('val-y-offset')!;
    this.displayZOffset = document.getElementById('val-z-offset')!;
    this.displayTempleWidth = document.getElementById('val-temple-width')!;

    // 2. Initialize Managers
    this.sceneManager = new SceneManager('vto-canvas');
    this.faceTracker = new FaceTracker('webcam');
    this.vtoManager = new VTOManager(this.sceneManager.camera, this.sceneManager.vtoGroup, this.sceneManager);
    this.opticalCalculator = new OpticalCalculator();
    this.hudRenderer = new HUDRenderer('hud-canvas');
    this.referenceChecker = new ReferenceChecker();

    // 3. Register Events & Listeners
    this.setupEventListeners();
    this.setupLanguageSwitch();
    this.setupMobileSheet();
    this.setupSectionCollapse();
    this.setupHeaderChips();
    this.trackHeaderHeight();

    // 4. Second try-on option. It wires itself to its own section and keeps no
    //    reference here: it only reads tracking state through the host callbacks, so
    //    the live try-on above is unaffected by anything it does.
    new VisionMeasurePanel(this.buildVisionHost());
  }

  /** Read-only window onto the live capture, handed to the AI measurement panel. */
  private buildVisionHost(): VisionPanelHost {
    return {
      getVideoElement: (): HTMLVideoElement => this.faceTracker.videoElement,
      getSnapshot: (): CaptureSnapshot => ({
        faceDetected: this.lastLandmarks !== null,
        isFrontal: this.lastPoseFrontal,
        poseWarning: this.lastPoseWarning,
        measurements: this.lastMeasurements,
        landmarks: this.lastLandmarks,
      }),
      getActiveFrame: (): ActiveFrameInfo => ({
        sku: this.activeSKU,
        name: this.activeSKUName,
        totalWidthMM: this.activeSKUWidth,
        lensHeightBMM: this.measuredLensHeightBMM ?? this.activeSKULensHeightB,
      }),
    };
  }

  /**
   * Re-reads the lens opening of the model now installed.
   *
   * Called after every path that installs a frame — SKU load, operator upload, and the
   * procedural fallback — because the aperture belongs to the mesh, not to the SKU. A
   * model whose opening cannot be read (a solid front, or lenses modelled in) leaves the
   * value null and the published figure takes over, which is the correct order of
   * preference rather than a failure.
   */
  /**
   * Draws the spec-sheet height table, or hides it.
   *
   * The MediaPipe figure is repeated at the foot of the table rather than left elsewhere
   * on the panel: the whole reason both exist is to be compared, and a comparison the
   * operator has to assemble by scrolling is not one they will make.
   */
  private renderOpticalHeights(): void {
    const box = document.getElementById('optical-heights');
    const button = document.getElementById('btn-toggle-heights');
    const entry = this.frameDescriptors.get(this.activeSKU);

    if (button) {
      button.classList.toggle('hidden', !entry);
      button.textContent = this.showOpticalHeights ? t('heights.hide') : t('heights.show');
    }
    if (!box) return;

    box.classList.toggle('hidden', !entry || !this.showOpticalHeights);
    box.innerHTML = '';
    if (!entry || !this.showOpticalHeights) return;

    const report = computeOpticalHeights(entry.descriptor, this.measuredLensHeightBMM);

    const add = (tag: string, cls: string, text: string) => {
      const el = document.createElement(tag);
      el.className = cls;
      el.textContent = text;
      box.appendChild(el);
      return el;
    };

    add('div', 'heights-title', t('heights.title', { name: report.identity }));
    add('div', 'heights-note', t('heights.reference'));

    const SOURCE_KEY: Record<string, string> = {
      measured: 'heights.srcMeasured',
      catalog: 'heights.srcCatalog',
      'fallback-a': 'heights.srcFallbackA',
      none: 'heights.srcCatalog',
    };

    const table = document.createElement('table');
    table.className = 'heights-table';

    const head = table.insertRow();
    for (const key of ['heights.colParam', 'heights.colFormula', 'heights.colCatalog', 'heights.colMeasured']) {
      const th = document.createElement('th');
      th.textContent = t(key);
      head.appendChild(th);
    }

    const cell = (row: HTMLTableRowElement, text: string, cls = '') => {
      const td = row.insertCell();
      td.textContent = text;
      if (cls) td.className = cls;
    };

    const bRow = table.insertRow();
    bRow.className = 'heights-brow';
    cell(bRow, t('heights.bRow'));
    cell(bRow, 'B');
    cell(bRow, report.fromCatalog ? `${report.fromCatalog.bMM} mm` : '—');
    cell(bRow, report.fromMeasured ? `${report.fromMeasured.bMM} mm` : '—');

    const srcRow = table.insertRow();
    srcRow.className = 'heights-srcrow';
    cell(srcRow, '');
    cell(srcRow, '');
    cell(srcRow, report.fromCatalog ? t(SOURCE_KEY[report.fromCatalog.bSource]) : '—');
    cell(srcRow, report.fromMeasured ? t(SOURCE_KEY[report.fromMeasured.bSource]) : '—');

    const ROWS: Array<[string, string, keyof typeof shape]> = [
      ['heights.mono', 'B / 2', 'monofocalMM'],
      ['heights.bifocal', '(B / 2) − 5', 'bifocalMM'],
      ['heights.progressive', 'B − 11', 'progressiveMM'],
    ];
    const shape = { monofocalMM: 0, bifocalMM: 0, progressiveMM: 0 };

    for (const [labelKey, formula, field] of ROWS) {
      const tr = table.insertRow();
      cell(tr, t(labelKey));
      cell(tr, formula, 'heights-formula');
      const shallow = (set: typeof report.fromCatalog) =>
        field === 'progressiveMM' && set?.progressiveTooShallow ? 'heights-shallow' : '';
      cell(
        tr,
        report.fromCatalog ? `${report.fromCatalog[field]} mm` : '—',
        shallow(report.fromCatalog)
      );
      cell(
        tr,
        report.fromMeasured ? `${report.fromMeasured[field]} mm` : '—',
        shallow(report.fromMeasured)
      );
    }
    box.appendChild(table);

    // The other reading, side by side. Never replaced, never hidden behind this toggle.
    const m = this.opticalCalculator.getMeasurements().fittingHeight;
    add(
      'div',
      'heights-mediapipe',
      t('heights.vsMediapipe', {
        ratio: FITTING_CONFIG.frameGeometry.pupilHeightRatio,
        od: m.heightRight,
        os: m.heightLeft,
      })
    );

    for (const note of report.notes) add('div', 'heights-warn', note);
  }

  /** Shows which spec sheet is loaded, plus any parse message. */
  private paintDescriptorChip(name: string | null, message?: string, warnings: string[] = []): void {
    const chip = document.getElementById('descriptor-loaded');
    const label = document.getElementById('descriptor-name');
    const button = document.getElementById('btn-evaluate-pair');

    chip?.classList.toggle('hidden', name === null);
    button?.classList.toggle('hidden', name === null);
    if (label) label.textContent = name ? t('descriptor.loaded', { name }) : '';

    const box = document.getElementById('eval-result');
    if (!box || name !== null) return;
    // Only a failure to load writes here directly; a success is overwritten by the table.
    box.innerHTML = message ? `<p class="eval-error"></p>` : '';
    const p = box.querySelector('.eval-error');
    if (p) p.textContent = message ?? '';
    void warnings;
  }

  /** Renders the evaluation table, or clears it when there is nothing to show. */
  private renderEvaluation(
    result: {
      evaluation: FrameEvaluation;
      identity: IdentityCheck;
      modelName: string;
      jsonName: string;
    } | null,
    message?: string
  ): void {
    const box = document.getElementById('eval-result');
    if (!box) return;

    box.innerHTML = '';
    if (!result) {
      if (message) {
        const p = document.createElement('p');
        p.className = 'eval-error';
        p.textContent = message;
        box.appendChild(p);
      }
      return;
    }

    const { evaluation: e, identity } = result;
    const verdictKey =
      e.overall === 'usable' ? 'eval.usable' : e.overall === 'suspect' ? 'eval.suspect' : 'eval.unusable';

    const add = (tag: string, cls: string, text: string): HTMLElement => {
      const el = document.createElement(tag);
      el.className = cls;
      el.textContent = text;
      box.appendChild(el);
      return el;
    };

    add('div', `eval-verdict eval-${e.overall}`, `${t(verdictKey)} — ${e.identity}`);

    // The two identities stay on screen permanently: a mis-paired evaluation is
    // confident and wrong, and the only defence is showing what was compared.
    add('div', 'eval-pair', `${result.modelName}  +  ${result.jsonName}`);
    add('div', identity.matches ? 'eval-note' : 'eval-warn', identity.message);
    add('div', 'eval-note', `${t('eval.scale')}: ${e.scale.message}`);

    const table = document.createElement('table');
    table.className = 'eval-table';
    const head = table.insertRow();
    for (const key of ['eval.colRow', 'eval.colMeasured', 'eval.colDeclared']) {
      const th = document.createElement('th');
      th.textContent = t(key);
      head.appendChild(th);
    }

    const VERDICT_KEY: Record<EvaluationRow['verdict'], string> = {
      ok: 'eval.in',
      'out-of-range': 'eval.out',
      'no-data': 'eval.noData',
      'not-measured': 'eval.notMeasured',
      'not-independent': 'eval.notIndep',
    };

    for (const row of e.rows) {
      const tr = table.insertRow();
      tr.className = `eval-row eval-${row.verdict}`;

      const label = tr.insertCell();
      label.textContent = row.label;
      if (row.note) label.title = row.note;

      const digits = row.unit === 'mm' ? 1 : 3;
      tr.insertCell().textContent =
        row.measured === null ? '—' : `${row.measured.toFixed(digits)} ${row.unit}`.trim();

      const declared =
        row.declaredMin === null && row.declaredMax === null
          ? '—'
          : `${(row.declaredMin ?? 0).toFixed(digits)}–${(row.declaredMax ?? 0).toFixed(digits)}`;
      tr.insertCell().textContent = `${declared}  ${t(VERDICT_KEY[row.verdict])}`;
    }
    box.appendChild(table);

    if (e.symmetryDeltaMM !== null) {
      add('div', 'eval-note', `${t('eval.symmetry')}: ${e.symmetryDeltaMM.toFixed(2)} mm`);
    }
    if (e.reasons.length > 0) {
      add('div', 'eval-warn', `${t('eval.reasons')}: ${e.reasons.join(' · ')}`);
    }
    // The circularity caveat is printed every time, never summarised away.
    add('div', 'eval-caveat', e.caveat);
  }

  /**
   * Takes the JSON half of the pair.
   *
   * Kept per SKU, exactly like the uploaded GLB, because a descriptor describes one
   * frame: carrying it over to the next SKU would silently evaluate one model against
   * another model's spec sheet, which is the single failure this whole feature exists to
   * catch.
   */
  private async loadFrameDescriptor(file: File): Promise<void> {
    if (!/\.json$/i.test(file.name)) {
      this.paintDescriptorChip(null, t('descriptor.badType'));
      return;
    }

    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.paintDescriptorChip(null, t('descriptor.parseError', { file: file.name, detail }));
      return;
    }

    const parsed = parseFrameDescriptorText(text);
    if (!parsed.ok || !parsed.value) {
      this.paintDescriptorChip(null, t('descriptor.parseError', {
        file: file.name,
        detail: parsed.errors.join(' '),
      }));
      this.renderEvaluation(null);
      return;
    }

    this.frameDescriptors.set(this.activeSKU, { descriptor: parsed.value, fileName: file.name });
    this.paintDescriptorChip(file.name, t('descriptor.ready'), parsed.warnings);
    this.renderOpticalHeights();
    console.log(
      `[VTO] Ficha cargada para "${this.activeSKU}": ${file.name} · ` +
        `${parsed.value.sku ?? parsed.value.id ?? 'sin sku'} · ` +
        `${parsed.warnings.length} aviso(s)`
    );

    // Evaluate straight away: making the operator press a second button to see whether
    // the file they just chose is even about this frame would be busywork.
    this.evaluateActivePair();
  }

  /**
   * Runs the evaluation for the active SKU's pair.
   *
   * The model side is whatever is installed — uploaded GLB, generated GLB, or the
   * procedural fallback. Evaluating the fallback is not a mistake: it tells the operator
   * that no real model is loaded, which is worth knowing.
   */
  private evaluateActivePair(): void {
    const entry = this.frameDescriptors.get(this.activeSKU);
    if (!entry) {
      this.renderEvaluation(null);
      return;
    }

    const model = this.sceneManager.vtoGroup;
    if (!model || model.children.length === 0) {
      this.renderEvaluation(null, t('eval.noModel'));
      return;
    }

    const metrology = measureFrame(model);
    const evaluation = evaluateFrame(metrology, entry.descriptor);

    // Identity is checked against the GLB's own filename when the operator uploaded one,
    // and against the SKU otherwise. Matching filenames are a convention, never proof.
    const modelName = this.userModels.get(this.activeSKU)?.name ?? `${this.activeSKU}.glb`;
    const identity = checkIdentity(basenameOf(modelName), entry.descriptor);

    this.renderEvaluation({ evaluation, identity, modelName, jsonName: entry.fileName });
  }

  private refreshMeasuredLensHeight(): void {
    const previous = this.measuredLensHeightBMM;
    this.measuredLensHeightBMM = measureLensHeightB(this.sceneManager.vtoGroup);

    // A new model means the standing verdict is about the old one, so re-run it.
    if (this.frameDescriptors.has(this.activeSKU)) {
      this.evaluateActivePair();
      this.renderOpticalHeights();
    }

    if (this.measuredLensHeightBMM !== previous) {
      console.log(
        `[VTO] Apertura de lente medida: ${
          this.measuredLensHeightBMM === null
            ? 'no legible, se usa la B publicada'
            : `${this.measuredLensHeightBMM} mm`
        }`
      );
    }
  }

  /** Writes a stat to both the desktop panel and the mobile sheet handle. */
  private setStat(target: 'pd' | 'fps', text: string): void {
    if (target === 'pd') {
      this.valPd.textContent = text;
      if (this.mValPd) this.mValPd.textContent = text;
    } else {
      this.valFps.textContent = text;
      if (this.mValFps) this.mValFps.textContent = text;
    }
  }

  /**
   * Reads `?sku=` and `?lang=` off the URL and returns the SKU to boot with.
   *
   * The host page (the storefront's try-on launcher, or a direct link) is the only
   * caller who can know which product the visitor was looking at — this app has no
   * catalog of its own. `?sku=` must match one of the `data-sku` cards already in
   * index.html; an unrecognised value falls back to the default rather than booting
   * into a SKU nothing on screen represents.
   */
  private applyEmbedParams(): string {
    const params = new URLSearchParams(location.search);

    const lang = params.get('lang');
    if (lang === 'es' || lang === 'en') setLang(lang as Lang);

    const requestedSku = params.get('sku');
    if (!requestedSku) return this.activeSKU;

    // The storefront's SKU is the real product identifier (and what the Capri
    // protocol looks up) whether or not a matching 3D card exists here yet — a
    // real catalog product almost never does today, and that must not erase its
    // identity down to whichever demo SKU happens to be the default. A missing
    // card just means loadGLBModel() falls back to the procedural mesh, exactly
    // as it already does for any SKU with no generated .glb.
    this.activeSKU = requestedSku;
    this.activeSKUName = requestedSku;

    const card = document.querySelector(`.sku-card[data-sku="${CSS.escape(requestedSku)}"]`);
    if (card) {
      document.querySelectorAll('.sku-card').forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      const widthAttr = card.getAttribute('data-width');
      const nameElem = card.querySelector('.sku-name');
      if (widthAttr) this.activeSKUWidth = parseFloat(widthAttr);
      if (nameElem) this.activeSKUName = nameElem.textContent || requestedSku;
    }
    return this.activeSKU;
  }

  /**
   * Tells whoever embedded this page (the storefront's iframe launcher) that it is
   * up and which SKU it actually booted with — a no-op, harmless postMessage when
   * opened as a plain top-level page (window.parent === window).
   */
  private notifyEmbedder(event: string, detail: Record<string, unknown> = {}): void {
    if (window.parent === window) return;
    window.parent.postMessage({ source: 'eyewear-vto', event, ...detail }, '*');
  }

  /**
   * Starts the camera and tracking pipeline
   */
  public async start(): Promise<void> {
    try {
      const initialSku = this.applyEmbedParams();

      this.updateStatus('loading', t('status.loadingModels'));
      // `?delegate=cpu` forces the CPU path from the start, so the GPU driver can be
      // ruled in or out in one load instead of waiting for the fallback to trip.
      const forced = new URLSearchParams(location.search).get('delegate');
      // The WASM runtime and model file are same-origin now (see face_tracker.ts), so
      // this should never take long — but "Cargando modelos" hanging forever with no
      // error at all, which is what an unbounded await gave a customer on a bad network
      // connection, is worse than a clear failure they can retry from.
      await withTimeout(
        this.faceTracker.initialize(forced === 'cpu' ? 'CPU' : 'GPU'),
        MODEL_LOAD_TIMEOUT_MS,
        t('status.modelTimeout')
      );

      this.updateStatus('loading', t('status.loadingFrame'));
      await this.loadSKU(initialSku);

      // Independent of the camera: a busy or missing webcam must not stop a generated
      // model from being picked up.
      this.startModelWatcher();

      this.updateStatus('loading', t('status.startingCamera'));
      const video = await this.faceTracker.startWebcam();

      video.style.opacity = '1';
      this.updateStatus('lost', t('status.searchingFace'));

      this.lastFrameTime = performance.now();
      this.lastFpsUpdate = this.lastFrameTime;
      requestAnimationFrame(this.loop.bind(this));
      this.notifyEmbedder('ready', { sku: initialSku });

    } catch (error: any) {
      console.error("VTO startup failed:", error);
      this.updateStatus('lost', t('status.cameraError'));
      alert(`${t('status.startFailed')} ${error.message || error}`);
    }
  }

  private setupEventListeners(): void {
    // Range Slider & Controls Changes
    this.sliderScale.addEventListener('input', () => {
      const val = parseFloat(this.sliderScale.value);
      this.vtoManager.adjustments.scale = val;
      this.displayScale.textContent = `${val.toFixed(2)}x`;
    });

    this.sliderYOffset.addEventListener('input', () => {
      const val = parseInt(this.sliderYOffset.value);
      this.vtoManager.adjustments.yOffset = val;
      this.displayYOffset.textContent = `${val > 0 ? '+' : ''}${val}mm`;
    });

    this.sliderZOffset.addEventListener('input', () => {
      const val = parseInt(this.sliderZOffset.value);
      this.vtoManager.adjustments.zOffset = val;
      this.displayZOffset.textContent = `${val > 0 ? '+' : ''}${val}mm`;
    });

    this.sliderTempleWidth.addEventListener('input', () => {
      const val = parseFloat(this.sliderTempleWidth.value);
      this.vtoManager.adjustments.templeWidth = val;
      this.displayTempleWidth.textContent = `${val.toFixed(2)}x`;
    });

    this.checkFlipZ.addEventListener('change', () => {
      this.vtoManager.adjustments.flipZ = this.checkFlipZ.checked;
    });

    // Reset button
    this.btnReset.addEventListener('click', () => {
      this.sliderScale.value = '1.00';
      this.sliderYOffset.value = '0';
      this.sliderZOffset.value = '0';
      this.sliderTempleWidth.value = '1.00';
      this.checkFlipZ.checked = false;
      
      this.vtoManager.adjustments = { scale: 1.0, yOffset: 0, zOffset: 0, flipZ: false, templeWidth: 1.0 };
      
      this.displayScale.textContent = '1.00x';
      this.displayYOffset.textContent = '0mm';
      this.displayZOffset.textContent = '0mm';
      this.displayTempleWidth.textContent = '1.00x';
    });

    // HUD Overlay Toggle Button
    if (this.btnToggleHud) {
      this.btnToggleHud.addEventListener('click', () => {
        this.hudRenderer.isEnabled = !this.hudRenderer.isEnabled;
        if (this.hudRenderer.isEnabled) {
          this.btnToggleHud.classList.add('active');
          this.btnToggleHud.textContent = t('opt.hideOverlay');
        } else {
          this.btnToggleHud.classList.remove('active');
          this.btnToggleHud.textContent = t('opt.showOverlay');
          this.hudRenderer.clear();
        }
      });
      // Mirrors the renderer's own initial state instead of asserting one: the overlay
      // starts hidden, so the button must offer to SHOW it.
      this.btnToggleHud.classList.toggle('active', this.hudRenderer.isEnabled);
      this.btnToggleHud.textContent = this.hudRenderer.isEnabled
        ? t('opt.hideOverlay')
        : t('opt.showOverlay');
    }

    // JSON Export Button Handler
    if (this.btnDownloadJson) {
      this.btnDownloadJson.addEventListener('click', () => {
        this.opticalCalculator.downloadJSON();
      });
    }

    // Reload Active Frame button — explicitly loads the GLB for the active SKU
    const btnReload = document.getElementById('btn-reload-sku');
    if (btnReload) {
      btnReload.addEventListener('click', async () => {
        this.updateStatus('loading', t('status.loadingSku', { sku: this.activeSKU }));
        // An uploaded frame is not overwritten by a refresh: it is removed explicitly,
        // with the button next to its name.
        await this.loadGLBModel(this.activeSKU);
      });
    }

    // Operator-supplied GLB: picker plus drag and drop onto the block
    const glbInput = document.getElementById('input-glb-file') as HTMLInputElement | null;
    glbInput?.addEventListener('change', () => {
      const file = glbInput.files?.[0];
      if (file) void this.loadUserModel(file);
      // Clear the picker, or choosing the same file twice in a row fires nothing
      glbInput.value = '';
    });

    const glbBlock = document.getElementById('glb-upload');
    if (glbBlock) {
      ['dragenter', 'dragover'].forEach((evt) =>
        glbBlock.addEventListener(evt, (e) => {
          e.preventDefault();
          glbBlock.classList.add('drag-over');
        })
      );
      ['dragleave', 'drop'].forEach((evt) =>
        glbBlock.addEventListener(evt, (e) => {
          e.preventDefault();
          glbBlock.classList.remove('drag-over');
        })
      );
      glbBlock.addEventListener('drop', (e) => {
        const file = (e as DragEvent).dataTransfer?.files?.[0];
        if (file) void this.loadUserModel(file);
      });
    }

    document.getElementById('btn-glb-remove')?.addEventListener('click', () => {
      void this.removeUserModel();
    });

    // The other half of the pair: the frame's own spec sheet. Same picker-plus-drop
    // idiom as the GLB, because the two are handed over the same way.
    const descInput = document.getElementById('input-descriptor-json') as HTMLInputElement | null;
    descInput?.addEventListener('change', () => {
      const file = descInput.files?.[0];
      if (file) void this.loadFrameDescriptor(file);
      descInput.value = '';
    });

    const descBlock = document.getElementById('descriptor-upload');
    if (descBlock) {
      ['dragenter', 'dragover'].forEach((evt) =>
        descBlock.addEventListener(evt, (e) => {
          e.preventDefault();
          descBlock.classList.add('drag-over');
        })
      );
      ['dragleave', 'drop'].forEach((evt) =>
        descBlock.addEventListener(evt, (e) => {
          e.preventDefault();
          descBlock.classList.remove('drag-over');
        })
      );
      descBlock.addEventListener('drop', (e) => {
        const file = (e as DragEvent).dataTransfer?.files?.[0];
        if (file) void this.loadFrameDescriptor(file);
      });
    }

    document.getElementById('btn-descriptor-remove')?.addEventListener('click', () => {
      this.frameDescriptors.delete(this.activeSKU);
      this.paintDescriptorChip(null);
      this.renderEvaluation(null);
      this.renderOpticalHeights();
    });

    document.getElementById('btn-evaluate-pair')?.addEventListener('click', () => {
      this.evaluateActivePair();
    });

    // The spec-sheet heights are a second opinion beside the MediaPipe reading, so they
    // are opt-in. The choice is remembered: an optician who wants both columns wants
    // them on every patient, not once.
    this.showOpticalHeights = localStorage.getItem(VTOApp.HEIGHTS_KEY) === '1';
    document.getElementById('btn-toggle-heights')?.addEventListener('click', () => {
      this.showOpticalHeights = !this.showOpticalHeights;
      try {
        localStorage.setItem(VTOApp.HEIGHTS_KEY, this.showOpticalHeights ? '1' : '0');
      } catch {
        // A private window refuses storage; the toggle still works for this session.
      }
      this.renderOpticalHeights();
    });

    // Operator-supplied reference sheet for the FRAME REFERENCE DATA panel
    const refInput = document.getElementById('input-ref-json') as HTMLInputElement | null;
    refInput?.addEventListener('change', () => {
      const file = refInput.files?.[0];
      if (file) void this.loadUserReference(file);
      refInput.value = '';
    });

    const refBlock = document.getElementById('ref-upload');
    if (refBlock) {
      ['dragenter', 'dragover'].forEach((evt) =>
        refBlock.addEventListener(evt, (e) => {
          e.preventDefault();
          refBlock.classList.add('drag-over');
        })
      );
      ['dragleave', 'drop'].forEach((evt) =>
        refBlock.addEventListener(evt, (e) => {
          e.preventDefault();
          refBlock.classList.remove('drag-over');
        })
      );
      refBlock.addEventListener('drop', (e) => {
        const file = (e as DragEvent).dataTransfer?.files?.[0];
        if (file) void this.loadUserReference(file);
      });
    }

    document.getElementById('btn-ref-remove')?.addEventListener('click', () => {
      this.referenceChecker.clearUserReference();
      this.paintReferenceUpload(null);
      void this.updateReferenceCard(this.activeSKU);
    });

    // A sheet kept from a previous session is already in force: say so on startup
    this.paintReferenceUpload(null);

    // Credit Card Calibration Button Handler
    const btnCardCalib = document.getElementById('btn-toggle-card-calib');
    const cardPanel = document.getElementById('card-calib-panel');
    const sliderCardSize = document.getElementById('slider-card-size') as HTMLInputElement;
    const valCardSize = document.getElementById('val-card-size');
    const btnCardReset = document.getElementById('btn-card-reset');

    if (btnCardCalib) {
      btnCardCalib.addEventListener('click', () => {
        const isEnabled = !this.hudRenderer.isCardCalibrationEnabled;
        this.hudRenderer.isCardCalibrationEnabled = isEnabled;
        this.hudRenderer.setCardInteractive(isEnabled);
        cardPanel?.classList.toggle('hidden', !isEnabled);

        if (isEnabled) {
          btnCardCalib.style.background = 'rgba(16, 185, 129, 0.4)';
          btnCardCalib.textContent = t('catalog.cardCalibActive');
          this.updateStatus('detecting', t('status.cardActive'));
          // On a phone the marking controls must be the section on screen, or the
          // operator drags the card blind
          this.selectMobileTab?.('frames');
        } else {
          btnCardCalib.style.background = 'rgba(16, 185, 129, 0.15)';
          btnCardCalib.textContent = t('catalog.cardCalib');
          // Back to the facial estimator
          this.opticalCalculator.customScaleMMPerNorm = null;
          this.opticalCalculator.cardApparentWidthPx = null;
          this.hudRenderer.resetCardAdjust();
          this.opticalCalculator.resetSmoothing();
          this.setFrozen(false);
          const bf = document.getElementById('btn-card-freeze');
          if (bf) bf.textContent = t('card.freeze');
        }
      });
    }

    if (sliderCardSize) {
      sliderCardSize.addEventListener('input', () => {
        const px = parseFloat(sliderCardSize.value);
        // Stored as a ratio against the face-derived prediction, so the marking keeps
        // holding once the patient shifts toward or away from the camera
        this.hudRenderer.setCardWidthPx(px);
        if (valCardSize) valCardSize.textContent = `${Math.round(px)} px`;
        this.opticalCalculator.resetSmoothing();
      });
    }

    if (btnCardReset) {
      btnCardReset.addEventListener('click', () => {
        this.hudRenderer.resetCardAdjust();
        this.opticalCalculator.resetSmoothing();
      });
    }

    // Freezing removes tracking jitter while the operator marks the card edges — the
    // largest accuracy gain available here, since a moving target cannot be marked to
    // the pixel.
    const btnFreeze = document.getElementById('btn-card-freeze');
    if (btnFreeze) {
      btnFreeze.addEventListener('click', () => {
        this.setFrozen(!this.isFrozen);
        // The KEY is what changes, not the words. Writing the words directly is what
        // used to strand this button in whichever language was active at first click:
        // applyTranslations repaints from data-i18n, so the two have to stay in step.
        const key = this.isFrozen ? 'card.resume' : 'card.freeze';
        btnFreeze.setAttribute('data-i18n', key);
        btnFreeze.textContent = t(key);
      });
    }

    // Scale is read back from the rectangle the operator actually matched to the card
    this.hudRenderer.onCardCalibrated = (scaleMMPerNorm: number) => {
      this.opticalCalculator.customScaleMMPerNorm = scaleMMPerNorm;
    };

    // Returning to this tab is exactly the moment a freshly generated GLB appears on
    // disk, because the operator has just come back from the Gradio panel. So re-check
    // for the model instead of reinstating the procedural frame — the previous behaviour
    // silently threw away an already-loaded generated model on every tab switch.
    let lastFocusTime = 0;
    window.addEventListener('focus', async () => {
      const now = Date.now();
      if (now - lastFocusTime < 1000) return;
      lastFocusTime = now;
      await this.loadGLBModel(this.activeSKU, { keepCurrentOnFailure: true });
    });

    // SKU Cards selector
    const skuCards = document.querySelectorAll('.sku-card');
    skuCards.forEach((card) => {
      card.addEventListener('click', async () => {
        skuCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        
        const sku = card.getAttribute('data-sku')!;
        const widthAttr = card.getAttribute('data-width');
        const nameElem = card.querySelector('.sku-name');
        
        this.activeSKU = sku;
        if (widthAttr) this.activeSKUWidth = parseFloat(widthAttr);
        if (nameElem) this.activeSKUName = nameElem.textContent || sku;

        this.updateStatus('loading', t('status.loadingFrame'));
        await this.loadSKU(sku);
        this.updateStatus('detecting', t('status.ready'));
      });
    });
  }

  private loadRequestId = 0;

  /**
   * Called when selecting or refreshing a SKU card.
   * Loads the default procedural frame immediately for instant, stable rendering.
   * Clicking "Reload Active Frame" will load and substitute the generated 3D GLB model.
   */
  private async loadSKU(sku: string): Promise<void> {
    this.updateReferenceCard(sku);
    // Uploads are per SKU, so the name shown must follow the selection
    this.paintUserModelChip(this.userModels.get(sku)?.name ?? null);
    // The spec sheet follows too, and its verdict is dropped: it was about the previous
    // frame, and a stale verdict beside a new model is worse than no verdict.
    this.paintDescriptorChip(this.frameDescriptors.get(sku)?.fileName ?? null);
    this.renderEvaluation(null);
    this.renderOpticalHeights();
    this.sceneManager.clearEyewearModels();
    this.createFallbackMesh();
    this.showingFallback = true;
    this.modelSignature = null; // re-baseline the watcher for the new SKU
    this.updateStatus('detecting', t('status.defaultFrame', { sku }));

    // Then try to substitute the generated model. Selecting a frame used to stop at the
    // procedural mesh, so a GLB produced in Gradio only ever appeared if the operator
    // happened to press "Reload active frame" by hand.
    await this.loadGLBModel(sku, { keepCurrentOnFailure: true });
  }

  /**
   * Called by the Reload button — fetches and installs the actual GLB from disk.
   * Shows the AI-generated model when available, fallback when not.
   */
  private async loadGLBModel(
    sku: string,
    opts: { keepCurrentOnFailure?: boolean; ignoreUserModel?: boolean } = {}
  ): Promise<void> {
    const requestId = ++this.loadRequestId;
    this.updateReferenceCard(sku);

    // A frame the operator supplied outranks anything on the server. Every path into
    // this method — SKU selection, the Reload button, the file watcher, window focus —
    // therefore re-installs it instead of reaching for models/{sku}.glb.
    const supplied = this.userModels.get(sku);
    if (supplied && !opts.ignoreUserModel) {
      await this.installUserModel(sku, supplied, requestId);
      return;
    }

    let model: THREE.Object3D | null = null;
    let failure: string | null = null;
    let missing = false;

    try {
      const modelUrl = `./models/${sku}.glb?t=${Date.now()}`;
      console.log(`[VTO] [Req #${requestId}] Fetching GLB: ${modelUrl}`);
      model = await this.sceneManager.loadEyewearModel(modelUrl);
    } catch (e: any) {
      failure = e?.message || String(e);
      // 'missing' means this SKU simply has no generated model yet, which is a normal
      // state. Anything else is a real fault and must not be reported as an absent model.
      missing = e?.code === 'missing';
      console.warn(`[VTO] [Req #${requestId}] GLB load failed for "${sku}": ${failure}`);
    }

    // A newer request superseded this one while it was in flight
    if (requestId !== this.loadRequestId) {
      if (model) this.sceneManager.disposeObject(model);
      return;
    }

    if (model) {
      // Same width convention the default frame uses, so a generated GLB sits on the
      // face at the size its SKU declares instead of whatever scale it arrived with
      this.sceneManager.installEyewearModel(model, this.activeSKUWidth);
      this.refreshMeasuredLensHeight();
      this.showingFallback = false;
      this.vtoManager.resetSmoothing();
      this.updateStatus('detecting', t('status.aiModel', { sku }));
      this.setModelSource('generated');
      console.log(`[VTO] ✓ [Req #${requestId}] Generated model installed: ${sku}`);
      return;
    }

    // Nothing loaded. An opportunistic refresh leaves the scene exactly as it was —
    // otherwise a transient failure would tear down a perfectly good generated model.
    // An explicit Reload does reset to the procedural frame, so the operator always
    // ends up in a known state.
    if (!opts.keepCurrentOnFailure) {
      this.sceneManager.clearEyewearModels();
      this.createFallbackMesh();
      this.showingFallback = true;
      this.updateStatus('detecting', t('status.defaultFrame', { sku }));
      this.setModelSource(missing ? 'default' : 'error', failure ?? undefined);
      return;
    }

    // The scene was left untouched. Only restate the source when the procedural frame is
    // what is actually on screen — a generated model still showing must never be
    // described as absent just because a refresh failed.
    if (this.showingFallback) {
      this.setModelSource(missing ? 'default' : 'error', failure ?? undefined);
    }
  }

  /**
   * Polls the active SKU's GLB and swaps it in as soon as the file changes on disk.
   * This is what makes a model generated in Gradio appear in the try-on by itself.
   */
  private startModelWatcher(): void {
    if (this.modelWatchTimer !== null) return;
    this.modelWatchTimer = window.setInterval(() => {
      void this.checkForModelChange();
    }, 4000);
  }

  /**
   * Fingerprints models/{sku}.glb with a HEAD request. A static server answers a missing
   * file with an HTML page rather than a 404, so the content type is part of the check.
   */
  private async checkForModelChange(): Promise<void> {
    if (document.hidden) return;

    const sku = this.activeSKU;
    let signature = 'missing';

    try {
      const res = await fetch(`./models/${sku}.glb?probe=${Date.now()}`, {
        method: 'HEAD',
        cache: 'no-store',
      });
      const type = res.headers.get('content-type') || '';
      if (res.ok && !type.includes('text/html')) {
        signature = [
          res.headers.get('etag') ?? '',
          res.headers.get('last-modified') ?? '',
          res.headers.get('content-length') ?? '',
        ].join('|');
      }
    } catch {
      return; // transient network hiccup: keep the previous baseline
    }

    // First tick after a SKU change only records the current state
    if (this.modelSignature === null) {
      this.modelSignature = signature;
      return;
    }

    // The operator's own file is not something a background poll gets to replace. The
    // baseline is still moved forward, so removing the upload later does not
    // immediately fire on a change that happened while it was in place.
    if (this.userModels.has(sku)) {
      this.modelSignature = signature;
      return;
    }
    if (signature === this.modelSignature) return;

    this.modelSignature = signature;

    // The file was removed. Leave the scene as it is rather than yanking the frame away
    // mid-fitting; selecting the SKU again returns to the default frame.
    if (signature === 'missing') return;

    // Guard against reacting to our own in-flight load
    if (sku !== this.activeSKU) return;

    console.log(`[VTO] New GLB detected for "${sku}" — substituting.`);
    await this.loadGLBModel(sku, { keepCurrentOnFailure: true });
  }

  /**
   * States which frame the scene is actually showing and why. Load failures used to be
   * swallowed into a console warning, so a broken GLB looked identical to a SKU that
   * simply has no generated model yet.
   */
  private setModelSource(
    state: 'generated' | 'default' | 'error' | 'uploaded',
    detail?: string
  ): void {
    const el = document.getElementById('model-source');
    if (!el) return;

    el.classList.remove('src-generated', 'src-default', 'src-error', 'src-uploaded');
    el.classList.add(`src-${state}`);
    el.textContent =
      state === 'generated'
        ? t('model.generated')
        : state === 'uploaded'
          ? t('model.uploaded', { file: detail ?? '' })
          : state === 'default'
            ? t('model.default')
            : t('model.error', { detail: detail ?? '' });

    this.lastModelSource = { state, detail };
  }

  /**
   * Takes a GLB/GLTF the operator picked from disk and makes it the model for the SKU
   * currently selected.
   *
   * The file never leaves the browser: it is parsed in memory through the same loader
   * the served models use, so a Draco-compressed frame from the generation pipeline and
   * one exported by hand behave identically.
   */
  private async loadUserModel(file: File): Promise<void> {
    const sku = this.activeSKU;
    const name = file.name;

    if (!/\.(glb|gltf)$/i.test(name)) {
      this.updateStatus('lost', t('catalog.glbBadType'));
      this.setModelSource('error', t('catalog.glbBadType'));
      return;
    }

    this.updateStatus('loading', t('status.loadingUserModel', { file: name }));

    let buffer: ArrayBuffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (error: any) {
      this.setModelSource('error', error?.message || String(error));
      return;
    }

    if (buffer.byteLength === 0) {
      this.setModelSource('error', t('catalog.glbEmpty'));
      this.updateStatus('detecting', t('catalog.glbEmpty'));
      return;
    }

    const entry = { buffer, name };
    const requestId = ++this.loadRequestId;
    const installed = await this.installUserModel(sku, entry, requestId);

    // Only remember a file that actually parsed: a broken upload must not shadow the
    // served model on every later refresh.
    if (installed) this.userModels.set(sku, entry);
  }

  /** Parses and installs a stored upload. Returns whether it made it onto the face. */
  private async installUserModel(
    sku: string,
    entry: { buffer: ArrayBuffer; name: string },
    requestId: number
  ): Promise<boolean> {
    let model: THREE.Object3D;
    try {
      model = await this.sceneManager.parseEyewearBuffer(entry.buffer);
    } catch (error: any) {
      const detail = error?.message || String(error);
      console.warn(`[VTO] User GLB "${entry.name}" failed to parse: ${detail}`);
      this.setModelSource('error', detail);
      this.updateStatus('detecting', t('catalog.glbError', { file: entry.name }));
      // A failed upload leaves the previous one — and the frame on screen — in place,
      // so the chip must go on naming whatever is actually installed.
      this.paintUserModelChip(this.userModels.get(sku)?.name ?? null);
      return false;
    }

    // A newer load superseded this one while the file was parsing
    if (requestId !== this.loadRequestId) {
      this.sceneManager.disposeObject(model);
      return false;
    }

    this.sceneManager.installEyewearModel(model, this.activeSKUWidth);
    this.refreshMeasuredLensHeight();
    this.showingFallback = false;
    this.vtoManager.resetSmoothing();
    this.setModelSource('uploaded', entry.name);
    this.updateStatus('detecting', t('status.userModel', { sku }));
    this.paintUserModelChip(entry.name);
    console.log(`[VTO] ✓ User model installed for "${sku}": ${entry.name}`);
    return true;
  }

  /** Drops the uploaded frame and falls back to whatever the server has for this SKU. */
  private async removeUserModel(): Promise<void> {
    const sku = this.activeSKU;
    if (!this.userModels.delete(sku)) return;

    this.paintUserModelChip(null);
    this.sceneManager.clearEyewearModels();
    this.createFallbackMesh();
    this.showingFallback = true;
    // Re-baseline the watcher: the served file may have changed while the upload was in
    // place, and that change should now be picked up rather than skipped.
    this.modelSignature = null;
    this.updateStatus('loading', t('status.loadingSku', { sku }));
    await this.loadGLBModel(sku, { keepCurrentOnFailure: true, ignoreUserModel: true });
  }

  /** Shows or hides the name of the uploaded file, with its remove button. */
  private paintUserModelChip(name: string | null): void {
    const box = document.getElementById('glb-loaded');
    const label = document.getElementById('glb-name');
    if (!box || !label) return;

    box.classList.toggle('hidden', name === null);
    label.textContent = name ?? '';
    label.title = name ?? '';
  }

  /**
   * Adopts a reference sheet the operator picked, in the same shape as the files under
   * glass_reference/: a single record, a bare array, or an object wrapping `frames`.
   *
   * The result message is deliberately about coverage rather than success. A file that
   * parses but names no SKU the catalogue offers changes nothing on screen, and without
   * saying so the operator is left staring at an unchanged panel wondering why.
   */
  private async loadUserReference(file: File): Promise<void> {
    if (!/\.json$/i.test(file.name)) {
      this.paintReferenceUpload(t('ref.uploadBadType'), 'bad');
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch (error: any) {
      this.paintReferenceUpload(
        t('ref.uploadBadJson', { detail: error?.message || String(error) }),
        'bad'
      );
      return;
    }

    const result = this.referenceChecker.loadUserReference(parsed, file.name);
    if (!result.ok) {
      this.paintReferenceUpload(result.error ?? t('ref.uploadNoRecords'), 'bad');
      return;
    }

    await this.updateReferenceCard(this.activeSKU);

    const covers = this.referenceChecker.userCovers(this.activeSKU);
    const parts = [t('ref.uploadOk', { n: result.count })];
    if (result.skipped > 0) parts.push(t('ref.uploadSkipped', { n: result.skipped }));
    parts.push(
      covers
        ? t('ref.uploadCovers', { sku: this.activeSKU })
        : t('ref.uploadNoMatch', { sku: this.activeSKU, skus: result.skus.join(', ') })
    );
    if (!result.persisted) parts.push(t('ref.uploadNotStored'));

    this.paintReferenceUpload(parts.join(' '), covers ? 'ok' : 'warn');
  }

  /**
   * Shows the sheet in force and the outcome of the last import.
   *
   * Called with null for the message to repaint just the file chip — on startup, and
   * after the sheet is dropped.
   */
  private paintReferenceUpload(
    message: string | null,
    state: 'ok' | 'warn' | 'bad' = 'ok'
  ): void {
    const box = document.getElementById('ref-loaded');
    const label = document.getElementById('ref-file-name');
    const out = document.getElementById('ref-upload-msg');

    const current = this.referenceChecker.getUserReference();
    if (box && label) {
      box.classList.toggle('hidden', current === null);
      label.textContent = current ? `${current.name} · ${current.count}` : '';
      label.title = current?.name ?? '';
    }

    if (!out) return;
    if (message === null) {
      // Restored from a previous session: state it without pretending it just happened
      out.textContent = current ? t('ref.uploadRestored', { name: current.name }) : '';
      out.className = 'ref-upload-msg' + (current ? ' ok' : '');
      return;
    }
    out.textContent = message;
    out.className = `ref-upload-msg ${state}`;
  }

  private async updateReferenceCard(sku: string): Promise<void> {
    if (!this.referenceCard) return;

    const specs = await this.referenceChecker.getSpecsForSKU(sku);
    this.activeSKULensHeightB = specs.lensHeightBNominal ?? null;

    if (!specs.found) {
      this.referenceCard.innerHTML = `<div class="ref-notice">${specs.message}</div>`;
      return;
    }

    // A dimension the catalogue does not publish is shown as such. Filling it in with
    // another frame's number is what made every SKU report the same specs before.
    const mm = (v: number | null | undefined) =>
      v === null || v === undefined
        ? `<span class="ref-missing">${t('ref.notPublished')}</span>`
        : `${v} mm`;

    const rows: Array<[string, string]> = [
      [t('ref.brandModel'), `${specs.brandName} (${specs.modelName})`],
      [t('ref.totalWidth'), mm(specs.totalFrontWidthNominal)],
      [t('ref.lensWidth'), mm(specs.lensWidthNominal)],
      [t('ref.bridge'), mm(specs.bridgeNominal)],
      [t('ref.lensHeight'), mm(specs.lensHeightBNominal)],
      [t('ref.templeLength'), mm(specs.templeLengthNominal)],
      [
        t('ref.shapeMaterial'),
        `${specs.lensShape}${specs.materials?.length ? ` (${specs.materials.join(', ')})` : ''}`,
      ],
    ];

    const warning =
      specs.lensHeightBNominal === null
        ? `<div class="ref-warning">${t('ref.demoWarning')}</div>`
        : '';

    // Which catalogue these figures came out of. An uploaded sheet and a bundled demo
    // entry carry very different authority, and the panel must not blur them.
    const origin =
      specs.source === 'uploaded'
        ? `<div class="ref-origin">${specs.message}</div>`
        : '';

    this.referenceCard.innerHTML =
      origin +
      rows
        .map(
          ([label, value]) =>
            `<div class="ref-item"><span class="ref-label">${label}</span><span class="ref-val">${value}</span></div>`
        )
        .join('') + warning;
  }

  /**
   * Generates a 3D wayfarer-style fallback glasses model when custom GLB is missing.
   * NOTE: loadSKU already calls clearEyewearModels() — do NOT call it again here.
   */
  private createFallbackMesh(): void {
    
    // Dimensions (local units; group scaled so total width = 0.14m in world space)
    const LW = 0.30, LH = 0.22, RIM = 0.025, GAP = 0.05;
    const lCx = -(GAP + LW / 2);
    const rCx =  (GAP + LW / 2);

    // Materials
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, metalness: 0.15, roughness: 0.4, side: THREE.DoubleSide });
    const goldMat  = new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.9, roughness: 0.1, side: THREE.DoubleSide });
    const templeMat = new THREE.MeshStandardMaterial({ color: 0x2d2d44, metalness: 0.15, roughness: 0.4, side: THREE.DoubleSide });
    const lensMat  = new THREE.MeshPhysicalMaterial({
      color: 0x93c5fd, roughness: 0.05, metalness: 0.0,
      transmission: 0.85, transparent: true, opacity: 0.45, clearcoat: 1.0, side: THREE.DoubleSide,
    });

    const fallbackGroup = new THREE.Group();
    fallbackGroup.name = "fallback-glasses";

    // Rounded-rect rim helper
    const makeRim = (cx: number): THREE.Mesh => {
      const shape = new THREE.Shape();
      const r = 0.04, hw = LW / 2, hh = LH / 2;
      shape.moveTo(-hw+r,-hh); shape.lineTo(hw-r,-hh); shape.quadraticCurveTo(hw,-hh,hw,-hh+r);
      shape.lineTo(hw,hh-r);   shape.quadraticCurveTo(hw,hh,hw-r,hh);
      shape.lineTo(-hw+r,hh);  shape.quadraticCurveTo(-hw,hh,-hw,hh-r);
      shape.lineTo(-hw,-hh+r); shape.quadraticCurveTo(-hw,-hh,-hw+r,-hh);
      const pts = shape.getPoints(48);
      const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p.x, p.y, 0)), true);
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, RIM / 2, 8, true), frameMat);
      m.position.set(cx, 0, 0);
      return m;
    };
    fallbackGroup.add(makeRim(lCx), makeRim(rCx));

    // Lenses (rounded rect fill)
    const ls = new THREE.Shape();
    const r2 = 0.04, lw = LW/2 - RIM, lh = LH/2 - RIM;
    ls.moveTo(-lw+r2,-lh); ls.lineTo(lw-r2,-lh); ls.quadraticCurveTo(lw,-lh,lw,-lh+r2);
    ls.lineTo(lw,lh-r2);   ls.quadraticCurveTo(lw,lh,lw-r2,lh);
    ls.lineTo(-lw+r2,lh);  ls.quadraticCurveTo(-lw,lh,-lw,lh-r2);
    ls.lineTo(-lw,-lh+r2); ls.quadraticCurveTo(-lw,-lh,-lw+r2,-lh);
    const lensGeom = new THREE.ShapeGeometry(ls);
    const lL = new THREE.Mesh(lensGeom, lensMat); lL.position.set(lCx, 0, 0);
    const rL = new THREE.Mesh(lensGeom, lensMat); rL.position.set(rCx, 0, 0);
    fallbackGroup.add(lL, rL);

    // Bridge — connects left and right rims solidly
    const bridgeLength = GAP * 2 + RIM * 1.5; // overlaps inside rims for a seamless join
    const bG = new THREE.CylinderGeometry(0.016, 0.016, bridgeLength, 12);
    bG.rotateZ(Math.PI / 2);
    const br = new THREE.Mesh(bG, goldMat);
    br.position.set(0, LH * 0.12, 0);
    fallbackGroup.add(br);

    // Temples — straight length up to ears (TL = 0.95) flared outward to stay outside the face
    const TL = 0.95, TW = 0.03, TH = 0.025;
    const tG = new THREE.BoxGeometry(TW, TH, TL);

    // Left temple & hinge assembly
    const leftTempleGroup = new THREE.Group();
    leftTempleGroup.position.set(lCx - LW/2 - TW/2, 0, 0); // pivot at hinge
    leftTempleGroup.rotation.y = 0.08; // flare outward around head
    const lT = new THREE.Mesh(tG, templeMat);
    lT.position.set(0, 0, -TL / 2); // extend into -Z (toward ears)
    leftTempleGroup.add(lT);

    // Right temple & hinge assembly
    const rightTempleGroup = new THREE.Group();
    rightTempleGroup.position.set(rCx + LW/2 + TW/2, 0, 0); // pivot at hinge
    rightTempleGroup.rotation.y = -0.08; // flare outward around head
    const rT = new THREE.Mesh(tG, templeMat);
    rT.position.set(0, 0, -TL / 2); // extend into -Z (toward ears)
    rightTempleGroup.add(rT);

    fallbackGroup.add(leftTempleGroup, rightTempleGroup);

    // Gold hinges at rim-temple junction
    const hG = new THREE.CylinderGeometry(0.025, 0.025, TH + 0.008, 10);
    hG.rotateZ(Math.PI / 2);
    const lH = new THREE.Mesh(hG, goldMat); lH.position.set(lCx - LW/2 - TW/2, 0, 0);
    const rH = new THREE.Mesh(hG, goldMat); rH.position.set(rCx + LW/2 + TW/2, 0, 0);
    fallbackGroup.add(lH, rH);

    fallbackGroup.renderOrder = 2;
    fallbackGroup.traverse(n => {
      if (n instanceof THREE.Mesh) { n.renderOrder = 2; n.visible = true; }
    });

    // Through the same fitter as a loaded GLB rather than the hand-computed scale it used
    // to carry. It is built in the right orientation already, so the fit only sizes it to
    // the active SKU and puts its pupil line on the anchor — which is exactly what makes
    // swapping between the procedural frame and a generated one a like-for-like comparison
    // instead of two frames sitting at two different heights.
    this.sceneManager.installEyewearModel(fallbackGroup, this.activeSKUWidth);
    this.refreshMeasuredLensHeight();
    this.vtoManager.resetSmoothing();
  }

  /**
   * Writes a clinical figure, marking it provisional when the calculator had to clamp it
   * into range — an estimate must not look like a measurement on the optician's panel.
   */
  private setOpticalValue(el: HTMLElement | null, value: number, provisional: boolean): void {
    if (!el) return;
    el.textContent = `${provisional ? '~' : ''}${value} mm`;
    el.classList.toggle('opt-provisional', provisional);
    el.title = provisional ? t('opt.provisionalTitle') : '';
  }

  /**
   * Lets the operator fold any sidebar section away, so the scrolling column keeps only
   * the panels that particular fitting needs.
   *
   * Built from the markup rather than declared in it: every section already carries a
   * heading (a plain title, or a banner wrapping one), and that heading is what stays
   * visible when the body is folded. A section without a heading — the stats strip — has
   * nothing to fold behind and is skipped. The choice is remembered per section, because
   * an operator who hides a panel means it, and having it come back on every reload is
   * the same as not having the control.
   */
  private setupSectionCollapse(): void {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    let stored: Record<string, boolean> = {};
    try {
      stored = JSON.parse(localStorage.getItem('rubilens.foldedSections') || '{}');
    } catch {
      stored = {};
    }

    const sections = Array.from(sidebar.querySelectorAll<HTMLElement>(':scope > section'));

    sections.forEach((section, index) => {
      const head =
        section.querySelector<HTMLElement>(':scope > .panel-header-banner') ??
        section.querySelector<HTMLElement>(':scope > .section-title');
      if (!head) return;

      head.classList.add('section-head');
      // data-mtab is unique among the sections that have a heading, so it survives a
      // reorder of the column; the index is only a fallback for a section without one.
      const key = section.dataset.mtab ?? `s${index}`;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'section-fold';
      head.appendChild(button);

      const apply = (collapsed: boolean): void => {
        section.dataset.collapsed = String(collapsed);
        button.setAttribute('aria-expanded', String(!collapsed));
        button.textContent = collapsed ? '▸' : '▾';
        // Re-read on a language switch: applyTranslations() drives the label from here
        const labelKey = collapsed ? 'section.expand' : 'section.collapse';
        button.dataset.i18nAriaLabel = labelKey;
        button.setAttribute('aria-label', t(labelKey));
      };

      button.addEventListener('click', () => {
        const collapsed = section.dataset.collapsed !== 'true';
        apply(collapsed);
        stored[key] = collapsed;
        try {
          localStorage.setItem('rubilens.foldedSections', JSON.stringify(stored));
        } catch {
          /* private browsing: folding still works, it just will not be remembered */
        }
      });

      apply(Boolean(stored[key]));
      if (section.dataset.mtab) this.sectionToggles.set(section.dataset.mtab, apply);
    });
  }

  /**
   * Makes the two header readouts jump to the panel they mirror: the right tab on a
   * phone, the section unfolded if it was put away, and scrolled into view.
   */
  private setupHeaderChips(): void {
    document.querySelectorAll<HTMLElement>('.hchip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const tab = chip.dataset.tab;
        if (tab) {
          this.selectMobileTab?.(tab);
          this.sectionToggles.get(tab)?.(false);
        }
        const target = chip.dataset.el ? document.getElementById(chip.dataset.el) : null;
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  }

  /**
   * Publishes the header's measured height as --header-h.
   *
   * The phone layout used to hardcode it, so the pose banner sat at a fixed 64px. The
   * header now carries a second row on a narrow screen, and a hardcoded offset would put
   * the banner underneath it.
   */
  private trackHeaderHeight(): void {
    const header = document.querySelector<HTMLElement>('.header-panel');
    if (!header) return;

    const publish = (): void => {
      const height = Math.round(header.getBoundingClientRect().height);
      if (height > 0) document.body.style.setProperty('--header-h', `${height}px`);
    };

    publish();
    if ('ResizeObserver' in window) new ResizeObserver(publish).observe(header);
    window.addEventListener('resize', publish);
    window.addEventListener('orientationchange', publish);
  }

  /**
   * Wires the ES/EN switch. Anything rendered from JavaScript rather than from a
   * data-i18n attribute is re-rendered here, so a switch mid-session updates everything.
   */
  private setupLanguageSwitch(): void {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.lang-btn'));

    const paint = () => {
      const active = getLang();
      buttons.forEach((b) => b.classList.toggle('active', b.dataset.lang === active));
    };

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => setLang(btn.dataset.lang as Lang));
    });

    onLangChange(() => {
      paint();
      this.opticalCalculator.refreshLocale();
      this.refreshDynamicText();
    });

    document.documentElement.lang = getLang();
    applyTranslations();
    paint();
    this.refreshDynamicText();
  }

  /** Re-renders the strings that JavaScript owns rather than the markup. */
  private refreshDynamicText(): void {
    const toggleHud = this.btnToggleHud;
    if (toggleHud) {
      toggleHud.textContent = this.hudRenderer.isEnabled
        ? t('opt.hideOverlay')
        : t('opt.showOverlay');
    }

    const btnCardCalib = document.getElementById('btn-toggle-card-calib');
    if (btnCardCalib) {
      btnCardCalib.textContent = this.hudRenderer.isCardCalibrationEnabled
        ? t('catalog.cardCalibActive')
        : t('catalog.cardCalib');
    }

    const btnFreeze = document.getElementById('btn-card-freeze');
    if (btnFreeze) {
      btnFreeze.textContent = this.isFrozen ? t('card.resume') : t('card.freeze');
    }

    // Built from JavaScript, so it needs re-rendering in the new language
    if (this.lastModelSource) {
      this.setModelSource(this.lastModelSource.state, this.lastModelSource.detail);
    }

    // The reference panel is built as markup, so it must be rebuilt on a language switch
    this.updateReferenceCard(this.activeSKU);
  }

  /** Fold/unfold callbacks for every collapsible sidebar section, keyed by its tab. */
  private sectionToggles = new Map<string, (collapsed: boolean) => void>();

  private sheetState: SheetState = 'half';

  /** Set once the sheet is wired, so other handlers can bring a section into view. */
  private selectMobileTab: ((tab: string) => void) | null = null;

  /**
   * Drives the phone bottom sheet: three heights, a tab strip, and a handle that can be
   * dragged or tapped.
   *
   * The sheet is the only place the panels can live on a phone, so it must never be the
   * reason a figure cannot be read. Two rules follow from that: PD and FPS are painted
   * on the handle, which is on screen at every height, and the tabs only choose which
   * section the sheet shows — every section stays in the document, and with this code
   * disabled the sidebar degrades to a plain scrolling column with all of them.
   *
   * The listeners are attached unconditionally. Above 900px the handle and the tabs are
   * display:none, so nothing here can fire, and the body attributes it sets are only
   * read from inside the phone media query.
   */
  private setupMobileSheet(): void {
    const sheet = document.getElementById('vto-sheet');
    const grip = document.getElementById('sheet-grip');
    const tabs = document.getElementById('sheet-tabs');
    if (!sheet || !grip || !tabs) return;

    const tabButtons = Array.from(tabs.querySelectorAll<HTMLButtonElement>('.sheet-tab'));
    const sidebar = document.querySelector<HTMLElement>('.sidebar');

    // Must mirror the sheet's media query in style.css, or the drag handle would
    // refuse to work on the wide-but-short viewports the sheet now covers.
    const isMobile = () =>
      window.matchMedia('(max-width: 900px), (max-height: 500px) and (pointer: coarse)').matches;
    // Folded height: the handle and the tab strip, nothing else
    const peekHeight = () => grip.offsetHeight + tabs.offsetHeight;
    const maxHeight = () => window.innerHeight * 0.9;

    const applyState = (state: SheetState): void => {
      this.sheetState = state;
      document.body.dataset.sheet = state;
      // Drop any height left behind by a drag so the CSS value for the state wins
      document.body.style.removeProperty('--sheet-h');

      const labelKey = state === 'peek' ? 'sheet.expand' : 'sheet.collapse';
      grip.setAttribute('aria-expanded', String(state !== 'peek'));
      grip.dataset.i18nAriaLabel = labelKey;
      grip.setAttribute('aria-label', t(labelKey));
    };

    const selectTab = (tab: string): void => {
      document.body.dataset.tab = tab;
      tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
      // Asking for a section while the sheet is folded is a request to see it
      if (this.sheetState === 'peek') applyState('half');
      if (sidebar) sidebar.scrollTop = 0;
    };

    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => selectTab(btn.dataset.tab || 'frames'));
    });

    // ---- Handle: drag to resize, tap to fold ----
    let dragging = false;
    let startY = 0;
    let startHeight = 0;
    let travelled = 0;

    grip.addEventListener('pointerdown', (e) => {
      if (!isMobile()) return;
      dragging = true;
      travelled = 0;
      startY = e.clientY;
      startHeight = sheet.getBoundingClientRect().height;
      document.body.dataset.sheetDragging = 'true';
      grip.setPointerCapture(e.pointerId);
    });

    grip.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = startY - e.clientY; // dragging upward grows the sheet
      travelled = Math.max(travelled, Math.abs(dy));
      const h = Math.min(maxHeight(), Math.max(peekHeight(), startHeight + dy));
      document.body.style.setProperty('--sheet-h', `${Math.round(h)}px`);
    });

    const endDrag = (): void => {
      if (!dragging) return;
      dragging = false;
      const height = sheet.getBoundingClientRect().height;
      delete document.body.dataset.sheetDragging;

      // Under ~8px the gesture was a tap on the handle, which folds and unfolds
      if (travelled < 8) {
        applyState(this.sheetState === 'peek' ? 'half' : 'peek');
        return;
      }

      // Otherwise settle on whichever of the three heights is closest to the finger
      const vh = window.innerHeight;
      const stops: Array<[SheetState, number]> = [
        ['peek', peekHeight()],
        ['half', vh * 0.52],
        ['full', vh * 0.9],
      ];
      const nearest = stops.reduce((best, stop) =>
        Math.abs(stop[1] - height) < Math.abs(best[1] - height) ? stop : best
      );
      applyState(nearest[0]);
    };

    grip.addEventListener('pointerup', endDrag);
    grip.addEventListener('pointercancel', endDrag);

    grip.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      applyState(this.sheetState === 'peek' ? 'half' : 'peek');
    });

    this.selectMobileTab = selectTab;
    selectTab('frames');
    applyState('half');
  }

  /**
   * Abandons an inference path that never detects anything.
   *
   * A face that comes and goes is normal — the patient steps out of shot. What is not
   * normal is a delegate that has been fed live video for seconds and has NEVER once
   * returned a face. On the Galaxy S25 Plus the GPU delegate did exactly that: `face NO`
   * and zero frames per second for as long as the page stayed open, while the same build
   * on the CPU path tracked at 23 fps and put the frame on the patient.
   *
   * The window only starts once the camera is actually delivering pixels, and it is armed
   * once: a device where the GPU works detects within the first second and never reaches
   * this. The cost of a false positive is running on the CPU, which is a little slower and
   * entirely correct; the cost of not acting is a try-on that never works at all.
   */
  private watchForDeadDelegate(now: number): void {
    if (this.everDetected || this.faceTracker.hasFallenBackToCpu) return;

    const video = this.faceTracker.videoElement;
    if (!video || video.videoWidth <= 0) return; // no pixels yet: the clock has not started

    if (this.firstDetectAt === 0) {
      this.firstDetectAt = now;
      return;
    }
    if (now - this.firstDetectAt < VTOApp.SILENT_MS_BEFORE_CPU) return;

    console.warn(
      `[VTO] ${this.faceTracker.delegate} delegate produced no detection in ` +
      `${Math.round(now - this.firstDetectAt)} ms. Rebuilding the tracker on the CPU.`
    );
    // Give the new path its own window rather than judging it on the old one's clock
    this.firstDetectAt = 0;
    void this.faceTracker.fallBackToCpu();
  }

  /**
   * Are these landmarks in the space every downstream calculation assumes?
   *
   * MediaPipe hands back arrays that are VIEWS into its WASM heap, and a later detect
   * call is free to overwrite or invalidate that memory. Read afterwards, the same array
   * yields whatever bytes are there now, reinterpreted as floats. On a Galaxy S25 Plus
   * that surfaced as coordinates around 1.2e19 instead of the [0,1] the pipeline is built
   * on: the millimetre scale collapsed to zero, the depth with it, and the frame was
   * placed nowhere at all — the symptom being "the glasses never appear".
   *
   * Nothing downstream can survive that, and no amount of clamping further along would
   * recover it, so the frame is rejected here and treated as a miss. A handful of spread
   * out points is enough: this corruption is wholesale, never a single stray value.
   *
   * The band is deliberately loose. Landmarks legitimately fall a little outside the
   * frame when the head is partly out of shot, and rejecting those would throw away good
   * captures; 1e19 is caught either way.
   */
  private static landmarksAreSane(landmarks: any[]): boolean {
    if (!Array.isArray(landmarks) || landmarks.length < 468) return false;

    for (const i of [1, 33, 133, 168, 263, 362]) {
      const p = landmarks[i];
      if (!p) return false;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
      if (p.x < -1 || p.x > 2 || p.y < -1 || p.y > 2) return false;
    }
    return true;
  }

  /**
   * A copy of the current detection that owns its own memory, taken at the moment of
   * freezing. Holding MediaPipe's own object still would leave the frozen measurements
   * reading a buffer the tracker may reuse the instant the video resumes.
   */
  private snapshotResults(results: any): any | null {
    const lm = results?.faceLandmarks?.[0];
    if (!lm) return null;

    const matrix = results?.facialTransformationMatrixes?.[0]?.data;
    return {
      faceLandmarks: [lm.map((p: any) => ({ x: p.x, y: p.y, z: p.z }))],
      facialTransformationMatrixes: matrix ? [{ data: Array.from(matrix) }] : undefined,
    };
  }

  /**
   * Freezes the capture: snapshots the current frame over the live feed and stops
   * feeding new detections, so both the image and the landmarks hold still while the
   * operator marks the card edges. Pausing the video element is not used — a paused
   * MediaStream resumes on its own in some browsers.
   */
  private setFrozen(frozen: boolean): void {
    const canvas = document.getElementById('freeze-canvas') as HTMLCanvasElement | null;
    const video = this.faceTracker.videoElement;
    if (!canvas) return;

    if (frozen && video.videoWidth > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')!.drawImage(video, 0, 0);
      canvas.classList.remove('hidden');
      // Detach from MediaPipe's buffers before holding this detection across frames
      this.lastResults = this.snapshotResults(this.lastResults) ?? this.lastResults;
      this.isFrozen = true;
    } else {
      canvas.classList.add('hidden');
      this.isFrozen = false;
      this.lastResults = null;
    }
  }

  /** Shows the capture distance and warns when it falls outside the recommended band. */
  private updateDistanceReadout(measurements: OpticalMeasurements): void {
    const el = document.getElementById('opt-distance');
    const note = document.getElementById('opt-distance-note');
    const card = document.getElementById('distance-card');
    const d = measurements.captureDistance;
    if (!el || !note || !card) return;

    if (d.centimetres === null) {
      el.textContent = '— cm';
      note.textContent = d.note;
      card.classList.remove('dist-warn');
      this.paintChip('distance', '— cm', d.note, 'idle');
      return;
    }

    const reading = `${d.centimetres.toFixed(1)} cm`;
    const detail = d.withinRecommendedRange
      ? t('opt.distanceRange', {
          min: d.recommendedRangeMM.min / 10,
          max: d.recommendedRangeMM.max / 10,
        })
      : d.note;

    el.textContent = reading;
    note.textContent = detail;
    card.classList.toggle('dist-warn', !d.withinRecommendedRange);

    // Same reading, same caveat, in the header
    this.paintChip('distance', reading, detail, d.withinRecommendedRange ? 'ok' : 'bad');
  }

  /**
   * Header mirror of the capture scale.
   *
   * Deliberately separate from updateCardScaleReadout, which only runs while the card
   * panel is open: the scale in force is worth stating at all times, and the message is
   * the calculator's own precisionStatus — accepted, rejected with the reason, or the
   * standard facial estimator — so the header can never disagree with the panel.
   */
  private updateScaleChip(measurements: OpticalMeasurements): void {
    const cal = measurements.creditCardCalibration;
    if (!cal) return;

    const state = !cal.active ? 'idle' : cal.accepted ? 'ok' : 'bad';
    this.paintChip('scale', cal.precisionStatus, cal.precisionStatus, state);
  }

  /** Writes one header chip: its value, its full message as a tooltip, and its state. */
  private paintChip(
    chip: 'distance' | 'scale',
    value: string,
    detail: string,
    state: 'ok' | 'bad' | 'idle'
  ): void {
    const host = document.getElementById(`hchip-${chip}`);
    const out = document.getElementById(`hchip-${chip}-value`);
    if (!host || !out) return;

    out.textContent = value;
    host.title = detail;
    host.classList.toggle('hchip-ok', state === 'ok');
    host.classList.toggle('hchip-bad', state === 'bad');
  }

  /**
   * Mirrors the marking back to the operator: the measured span, the implied PD, and
   * whether the plausibility gate accepted the calibration.
   */
  private updateCardScaleReadout(measurements: OpticalMeasurements): void {
    if (!this.hudRenderer.isCardCalibrationEnabled) return;

    const px = this.hudRenderer.cardApparentWidthPx;
    const slider = document.getElementById('slider-card-size') as HTMLInputElement | null;
    const sizeOut = document.getElementById('val-card-size');
    if (px !== null) {
      // Keep the slider in step with a drag-driven or freshly seeded marking
      if (slider && document.activeElement !== slider) slider.value = String(Math.round(px));
      if (sizeOut) sizeOut.textContent = `${Math.round(px)} px`;
      this.opticalCalculator.cardApparentWidthPx = Math.round(px);
    }

    const cal = measurements.creditCardCalibration;
    const spanOut = document.getElementById('val-card-scale');
    const pdOut = document.getElementById('val-card-pd');
    const verdict = document.getElementById('card-calib-verdict');
    if (!cal || !spanOut || !pdOut || !verdict) return;

    spanOut.textContent = px !== null ? `${Math.round(px)} px` : '—';
    pdOut.textContent = cal.impliedPdMM !== null ? `${cal.impliedPdMM.toFixed(1)} mm` : '—';

    verdict.textContent = cal.precisionStatus;
    verdict.classList.toggle('ok', cal.accepted);
    verdict.classList.toggle('bad', !cal.accepted);
  }

  private updateStatus(state: 'loading' | 'detecting' | 'lost', message: string): void {
    this.statusBadge.className = `status-badge status-${state}`;
    this.statusText.textContent = message;

    if (state === 'detecting') {
      this.faceGuide.classList.add('fade-out');
    } else if (state === 'lost') {
      this.faceGuide.classList.remove('fade-out');
      this.setStat('pd', t('stats.calculating'));
      this.hudRenderer.clear();
      this.poseWarning.classList.add('hidden');
    }
  }

  /**
   * Main animation and tracking execution loop
   */
  private loop(now: number): void {
    requestAnimationFrame(this.loop.bind(this));

    // 1. Calculate FPS
    this.frameCount++;
    this.lastFrameTime = now;

    if (now - this.lastFpsUpdate > this.fpsInterval) {
      const fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
      this.setStat('fps', fps.toString());
      this.frameCount = 0;
      this.lastFpsUpdate = now;
    }

    // 2. Refresh the frame-to-viewport crop mapping. The frame size is only known once
    //    the stream has started, and the viewport moves under the browser chrome on a
    //    phone, so this is cheap enough to redo every frame rather than guess when it
    //    changed.
    const feed = this.faceTracker.videoElement;
    const stage = document.getElementById('app');
    const stageW = stage?.clientWidth || window.innerWidth;
    const stageH = stage?.clientHeight || window.innerHeight;
    const frameW = feed?.videoWidth ?? 0;
    const frameH = feed?.videoHeight ?? 0;

    // On a phone the camera frame is never cropped.
    //
    // `cover` fills the screen by throwing away whatever does not fit, and in an upright
    // viewport that is most of the frame width: measured against a face spanning 35% of
    // the frame, cover puts it at 138% of the screen width with a landscape stream and
    // 44% with a portrait one, where the desktop shows 35%. `contain` returns 35% in
    // every case — the same framing the desktop gives — at the cost of letterboxing.
    // For a measurement tool that is the right trade: the operator can see the whole
    // field the tracker is working from.
    const phoneLayout = window.matchMedia('(max-width: 900px), (max-height: 500px) and (pointer: coarse)').matches;
    const fit =
      phoneLayout || ViewTransform.coverIsExcessive(frameW, frameH, stageW, stageH)
        ? 'contain'
        : 'cover';
    if (fit !== this.appliedFit) {
      this.appliedFit = fit;
      document.body.classList.toggle('feed-contain', fit === 'contain');
    }

    viewTransform.update(frameW, frameH, stageW, stageH, fit);

    // 2b. Match the virtual camera to the real one.
    //
    //     The frame is a rigid object 150 mm deep, so how much its temples converge on
    //     their way back to the ears is decided entirely by the camera's field of view.
    //     Nothing in the plane of the lenses depends on it — that is why a wrong value
    //     looks like a frame that sits perfectly on the eyes with arms that miss the ears.
    //
    //     The stream's own field comes from the measured distance and scale, falling back
    //     to the configured assumption until a face resolves. What the 3D canvas has to
    //     reproduce is the field actually PAINTED, so the half-angle is divided by the
    //     factor the fit magnified the frame by — greater than 1 where `cover` cropped it
    //     away, less than 1 where `contain` letterboxed it in.
    const streamHFovDeg =
      this.opticalCalculator.resolvedCameraHFovDeg ??
      FITTING_CONFIG.captureDistance.assumedHorizontalFovDeg;
    const paintedHalfTan =
      Math.tan((streamHFovDeg * Math.PI) / 360) / Math.max(1e-6, viewTransform.scaleX);
    this.sceneManager.setCaptureHorizontalFov((2 * Math.atan(paintedHalfTan) * 180) / Math.PI);

    // 3. Perform landmark tracking. While frozen, the last detection is reused so the
    //    measurements stop moving under the operator's marking.
    let results: any;
    if (this.isFrozen) {
      results = this.lastResults;
    } else {
      results = this.faceTracker.detectFrame(now);
      if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
        this.lastResults = results;
        this.everDetected = true;
      }
      this.watchForDeadDelegate(now);
    }

    // Landmarks must arrive normalized. Anything else is not a face, whatever it claims.
    const rawLandmarks = results?.faceLandmarks?.[0];

    if (rawLandmarks && !VTOApp.landmarksAreSane(rawLandmarks)) {
      // Corrupt detection. HOLD, do not reset.
      //
      // Reporting "no face" here would be worse than useless: it would yank the frame off
      // the patient every time the tracker handed back a bad buffer. Leaving the scene
      // exactly as it was rides straight over an intermittent glitch, and if the
      // corruption is permanent the counter below says so out loud instead of leaving a
      // silent blank where the glasses should be.
      this.corruptFrames++;
      this.consecutiveCorrupt++;
      this.lastCorruptSample = String(rawLandmarks[1]?.x ?? 'n/a');
      if (this.corruptFrames === 1 || this.corruptFrames % 120 === 0) {
        console.warn(
          `[VTO] Landmarks outside the normalized range (${this.corruptFrames} frames so far). ` +
          `Sample x=${this.lastCorruptSample}. Holding the last good pose.`
        );
      }

      // Sustained corruption is a broken inference path, not a glitch to ride out.
      //
      // A driver that decodes tensors into nonsense does not recover on its own, and no
      // guard downstream can reconstruct a face from 1e19. Once the corruption has held
      // for a stretch rather than flickered, the only lever left is to stop using that
      // path — so the tracker is rebuilt on the CPU, once, and never in a loop. A healthy
      // device never reaches this line because the counter resets on every good frame.
      if (
        this.consecutiveCorrupt >= VTOApp.CORRUPT_FRAMES_BEFORE_CPU &&
        !this.faceTracker.hasFallenBackToCpu
      ) {
        this.consecutiveCorrupt = 0;
        void this.faceTracker.fallBackToCpu().then((ok) => {
          if (ok) this.corruptFrames = 0;
        });
      }
      this.sceneManager.render();
      return;
    }

    const haveFace = !!rawLandmarks;

    if (haveFace) {
      this.consecutiveCorrupt = 0;
      const landmarks = rawLandmarks;
      // The frame is drawn at its true physical width, so the pose solver needs the same
      // millimetre scale the panel reports. It is one frame behind — the calculator runs
      // below — which is invisible at 30 fps and keeps the two from ever disagreeing.
      this.vtoManager.mmPerNormUnit = this.opticalCalculator.resolvedScaleMMPerNorm;
      this.vtoManager.captureDistanceMM = this.opticalCalculator.resolvedDistanceMM;
      // Same one-frame lag, same reason: the head that hides the temples is the patient's
      // own, measured across the ears by the calculator below.
      this.vtoManager.headWidthMM =
        this.lastMeasurements?.ergonomicsAndEarFit.headWidthMM ?? null;
      // The pose angles compare a normalized-y against a normalized-x, which are fractions
      // of different dimensions until this is applied.
      if (frameW > 0 && frameH > 0) this.vtoManager.frameAspect = frameH / frameW;
      const { fitStatus, poseInfo } = this.vtoManager.updatePose(landmarks);
      
      // Check Frontal Pose alignment
      if (!poseInfo.isFrontal) {
        this.updateStatus('detecting', t('status.nonFrontal'));
        if (this.poseWarningText) {
          // The banner already renders its own .warning-icon — no second glyph here
          this.poseWarningText.textContent = t('pose.warning', {
            detail: poseInfo.warningMessage || t('pose.alignAhead'),
          });
        }
        this.poseWarning.classList.remove('hidden');
      } else {
        this.updateStatus('detecting', t('status.faceDetected'));
        this.poseWarning.classList.add('hidden');
      }

      // Calculate optical metrics
      const video = this.faceTracker.videoElement;
      if (video) this.opticalCalculator.setImageSize(video.videoWidth, video.videoHeight);


      const measurements = this.opticalCalculator.calculateFromLandmarks(landmarks, {
        name: this.activeSKUName,
        width: this.activeSKUWidth,
        lensHeightBMM: this.activeSKULensHeightB,
        measuredLensHeightBMM: this.measuredLensHeightBMM,
      }, fitStatus, results.facialTransformationMatrixes?.[0]?.data ?? null);

      // Render 2D HUD Measurement Overlay on Face
      this.hudRenderer.renderOverlay(landmarks, measurements);

      // Update HUD text elements in real time
      this.setStat('pd', `${measurements.pupillaryDistance.pdTotal} mm`);
      if (this.optPdTotal) this.optPdTotal.textContent = `${measurements.pupillaryDistance.pdTotal} mm`;
      const flags = measurements.outOfRange;
      this.setOpticalValue(this.optPdDer, measurements.pupillaryDistance.pdRight, flags.pdRight);
      this.setOpticalValue(this.optPdIzq, measurements.pupillaryDistance.pdLeft, flags.pdLeft);
      this.setOpticalValue(this.optAltDer, measurements.fittingHeight.heightRight, flags.heightRight);
      this.setOpticalValue(this.optAltIzq, measurements.fittingHeight.heightLeft, flags.heightLeft);
      if (this.optEarStatus) this.optEarStatus.textContent = fitStatus;

      this.updateDistanceReadout(measurements);
      this.updateCardScaleReadout(measurements);
      this.updateScaleChip(measurements);

      // Published for the AI measurement panel; nothing else reads these
      this.lastLandmarks = landmarks;
      this.lastMeasurements = measurements;
      this.lastPoseFrontal = poseInfo.isFrontal;
      this.lastPoseWarning = poseInfo.warningMessage || '';

    } else {
      if (this.statusText.textContent !== 'Loading frame...') {
        this.updateStatus('lost', t('status.searchingFace'));
      }
      this.hudRenderer.clear();
      this.poseWarning.classList.add('hidden');
      this.opticalCalculator.resetSmoothing();
      this.lastLandmarks = null;
      this.lastMeasurements = null;
      this.lastPoseFrontal = false;

      // With no face there is no capture geometry: the header must say so rather than
      // keep showing the last good reading
      this.paintChip('distance', '— cm', t('dist.noFace'), 'idle');

      // Keep glasses model smoothly centered in view at Z = -0.65m when searching for face
      const previewPos = new THREE.Vector3(0, 0, -0.65);
      const previewRot = new THREE.Quaternion(0, 0, 0, 1);
      const previewScale = new THREE.Vector3(1, 1, 1);

      this.vtoManager.currentPosition.lerp(previewPos, 0.1);
      this.vtoManager.currentQuaternion.slerp(previewRot, 0.1);
      this.vtoManager.currentScale.lerp(previewScale, 0.1);

      this.sceneManager.vtoGroup.position.copy(this.vtoManager.currentPosition);
      this.sceneManager.vtoGroup.quaternion.copy(this.vtoManager.currentQuaternion);
      this.sceneManager.vtoGroup.scale.copy(this.vtoManager.currentScale);
      this.sceneManager.vtoGroup.visible = true;

      // Carry the occluder along, or it stays parked where the face was last seen and
      // eats the preview frame from the side
      this.sceneManager.updateOccluder(
        this.vtoManager.currentPosition,
        this.vtoManager.currentQuaternion,
        this.vtoManager.currentScale.y
      );
    }

    // 4. Render ThreeJS scene
    this.sceneManager.render();

    this.updateDebugOverlay();
  }

  /**
   * Numbers-on-glass diagnostic, off unless the page is opened with `?debug=1`.
   *
   * A frame that misbehaves only on one handset cannot be chased from a desk: the values that
   * would identify it — what the camera actually returned, how the frame is fitted, the
   * field of view in force, the scale the frame ended up with — are all invisible from
   * outside. This puts them on screen so a single screenshot from the device settles it.
   */
  private updateDebugOverlay(): void {
    if (!this.debugEnabled) return;

    if (!this.debugPanel) {
      const el = document.createElement('div');
      el.id = 'vto-debug';
      el.style.cssText =
        'position:fixed;left:6px;top:6px;z-index:9999;pointer-events:none;' +
        'font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#7CFFB2;' +
        'background:rgba(0,0,0,.72);padding:6px 8px;border-radius:6px;white-space:pre;' +
        'max-width:70vw;';
      document.body.appendChild(el);
      this.debugPanel = el;
    }

    const v = this.faceTracker.videoElement;
    const cam = this.sceneManager.camera;
    const pos = this.vtoManager.currentPosition;
    const sc = this.vtoManager.currentScale;
    const m = this.opticalCalculator.getMeasurements();

    this.debugPanel.textContent = [
      `build   ${BUILD_STAMP}`,
      `stream  ${v?.videoWidth ?? 0}x${v?.videoHeight ?? 0}   fit ${viewTransform.fit}`,
      `view    ${Math.round(viewTransform.viewWidth)}x${Math.round(viewTransform.viewHeight)}`,
      `scale   x${viewTransform.scaleX.toFixed(3)} y${viewTransform.scaleY.toFixed(3)} oy${viewTransform.offsetY.toFixed(3)}`,
      `hfov    ${this.opticalCalculator.resolvedCameraHFovDeg?.toFixed(1) ?? 'null'}  camFov ${cam.fov.toFixed(1)} asp ${cam.aspect.toFixed(3)}`,
      `dist    ${m.captureDistance.centimetres ?? '—'} cm   PD ${m.pupillaryDistance.pdTotal} mm`,
      `pos     ${pos.x.toFixed(3)} ${pos.y.toFixed(3)} ${pos.z.toFixed(3)}`,
      `scale3d ${sc.x.toFixed(3)} ${sc.y.toFixed(3)}`,
      `rulers  pupil ${this.vtoManager.lastProjectedPupilDist.toFixed(4)}  span ${this.vtoManager.lastSpanEstimate.toFixed(4)}`,
      `anchor  x ${this.vtoManager.lastAnchorX.toFixed(3)}  y ${this.vtoManager.lastAnchorY.toFixed(3)}  pdN ${this.vtoManager.lastPupilDistNorm.toFixed(3)}`,
      `halfW   ${this.vtoManager.lastHalfWidth.toFixed(4)}`,
      `health  ${this.corruptFrames === 0 ? 'ok' : `RECHAZADOS ${this.corruptFrames} (x=${this.lastCorruptSample})`}`,
      `infer   ${this.faceTracker.delegate}${this.faceTracker.hasFallenBackToCpu ? ' (fallback)' : ''}`,
      `method  ${m.captureDistance.method}`,
      `face    ${this.lastResults?.faceLandmarks?.length ? 'yes' : 'NO'}   fps ${this.mValFps?.textContent ?? this.valFps.textContent}`,
    ].join('\n');
  }
}

// Start application on page load
window.addEventListener('DOMContentLoaded', () => {
  const app = new VTOApp();
  app.start();
});

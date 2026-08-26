/**
 * Shared renderer for a multimodal measurement run.
 *
 * The side panel and the standalone report page draw the SAME markup from here. Two
 * copies would drift, and a clinical figure that reads differently depending on which
 * window the optician happens to have open is worse than no second window at all.
 *
 * Every function is pure: it takes a result and returns an HTML string. The only wiring
 * either caller has to do afterwards is `attachRawToggles`.
 */

import { getLang, t } from './i18n';
import {
  CapriResult,
  InputsCheck,
  CostBreakdown,
  MeasureResult,
  Measurements,
  ProgressiveResult,
  TryOnResult,
} from './vision_measure_client';

/** Fields rendered in the facial table, in the order of the printed optician report. */
export const FACIAL_ORDER: Array<keyof Measurements['facial']> = [
  'pdTotalMM',
  'pdRightMM',
  'pdLeftMM',
  'corridorHeightRightMM',
  'corridorHeightLeftMM',
  'pupilCenterHeightMM',
  'pantoscopicAngleDeg',
  'wrapAngleDeg',
  'faceWidthMM',
];

export const FRAME_NUMERIC_ORDER: Array<keyof Measurements['frame']> = [
  'lensWidthMM',
  'bridgeMM',
  'templeLengthMM',
  'lensHeightMM',
  'totalFrontWidthMM',
];

const DEGREE_FIELDS = new Set(['pantoscopicAngleDeg', 'wrapAngleDeg']);

/**
 * How much detail to draw.
 *
 * The side panel is a 400px column beside a live camera; the report page is a printable
 * record. `verbose` only ever ADDS — the figures, their order and their flags are
 * identical either way, so the two views can never disagree about a measurement. What it
 * adds is the provenance note behind each confidence badge, which otherwise exists only
 * as a tooltip and therefore does not exist at all on paper.
 */
export interface RenderOptions {
  verbose?: boolean;
  /**
   * The Capri identifier the operator asked for, when they asked for one. Carried so the
   * report can say "the protocol ran for DC210 and established nothing" rather than
   * quietly omitting the section, which reads identical to never having run it.
   */
  frameId?: string;
}

export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** i18n label for a measurement field; falls back to the raw field name. */
export function fieldLabel(field: string): string {
  const key = `ai.f.${field}`;
  const translated = t(key);
  return translated === key ? field : translated;
}

export function scoreClass(score: number): string {
  if (score >= 80) return 'good';
  if (score >= 55) return 'fair';
  return 'poor';
}

function renderRow(
  field: string,
  value: number | null,
  m: Measurements,
  opts: RenderOptions = {}
): string {
  const conf = m.confidence[field];
  const flagged = m.outOfRange.includes(field);
  const unit = DEGREE_FIELDS.has(field) ? '°' : ' mm';

  // Loose ==, on purpose: this page renders runs saved by OLDER builds of the panel,
  // and a field that did not exist back then arrives undefined rather than null. A
  // strict check turned that into a crash, which blanked the whole report — the exact
  // failure a record meant to be consulted later must not have.
  const shown =
    value == null
      ? `<span class="ai-null">${t('ai.notEstablished')}</span>`
      : `${value.toFixed(1)}${unit}`;

  const badge = conf
    ? `<span class="ai-conf ai-conf-${escapeHtml(conf.level)}" title="${escapeHtml(conf.note)}">${escapeHtml(conf.source)}</span>`
    : '';

  // On paper a tooltip is nothing at all, so the note is written out
  const note =
    opts.verbose && conf?.note
      ? `<p class="ai-row-note">${escapeHtml(conf.note)}</p>`
      : '';

  return `
    <div class="ai-row${flagged ? ' ai-row-flagged' : ''}">
      <span class="ai-row-label">${fieldLabel(field)}</span>
      <span class="ai-row-value">${shown}${flagged ? ` <span class="ai-flag" title="${t('ai.outOfRangeTitle')}">!</span>` : ''}</span>
      ${badge}
    </div>${note}`;
}

function renderList(title: string, items: string[], cls: string): string {
  if (!items.length) return '';
  return `
    <div class="ai-listblock ${cls}">
      <span class="ai-listtitle">${title}</span>
      <ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
    </div>`;
}

function renderRaw(result: MeasureResult): string {
  if (!result.rawText) return '';
  return `
    <button type="button" class="ai-raw-toggle">${t('ai.showRaw')}</button>
    <pre class="ai-raw hidden">${escapeHtml(result.rawText)}</pre>`;
}

/**
 * Token spend and estimated price of one call.
 *
 * Reasoning tokens are shown but NOT added on top: every vendor here already counts them
 * inside the output total, so adding them would double-bill the expensive half. They are
 * listed because they are usually the reason a bill is larger than expected.
 */
/**
 * The message for a failure, translated and safe to show to whoever is running the
 * try-on right now — which, with VITE_ENABLE_TRY_ON on, can be an anonymous customer,
 * not just the optician who set the service up. So every coded branch here is a plain,
 * generic sentence pointing at the site administrator, never an env var name, a vendor
 * status code, or a config knob nobody browsing the store could act on. Anything
 * without a code falls back to the server's own sentence, which is better than a
 * generic apology when the server already said something useful.
 */
/** Must match .oc-photo-wrap's `aspect-ratio` in style.css (width / height). */
const OC_PHOTO_ASPECT = 3 / 4;

/**
 * Maps a normalized (0..1) point on the full source image to its position within a
 * container that `object-fit: cover` has cropped it into, anchored at `object-position`
 * (also 0..1 fractions, matching CSS's own convention).
 *
 * `object-fit: cover` scales the image so it fully fills whichever dimension is the
 * tighter fit and crops the other — a plain percentage of the source image is only
 * ever correct again if this crop is undone the same way the browser applied it.
 * Returns null when the point falls outside the visible crop entirely: with the crop
 * centred on the pupil midpoint this should not happen for a pupil itself, but a
 * mark that COULD end up off-frame is worth dropping rather than clamping into a
 * wrong-looking position at the edge.
 */
function mapCoverPoint(
  px: number,
  py: number,
  imageAspect: number,
  containerAspect: number,
  posX: number,
  posY: number
): { left: number; top: number } | null {
  let x = px;
  let y = py;

  if (imageAspect >= containerAspect) {
    // The image is relatively wider than the box: height fills it, width is cropped.
    const visibleFraction = containerAspect / imageAspect;
    const start = posX * (1 - visibleFraction);
    x = (px - start) / visibleFraction;
  } else {
    // The image is relatively taller than the box: width fills it, height is cropped.
    const visibleFraction = imageAspect / containerAspect;
    const start = posY * (1 - visibleFraction);
    y = (py - start) / visibleFraction;
  }

  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { left: x * 100, top: y * 100 };
}

export function failureMessage(error?: string, errorCode?: string): string {
  switch (errorCode) {
    case 'timeout':
      return `${t('ai.timeoutTitle')} ${t('ai.timeoutBody')}`;
    case 'missing-api-key':
      return t('ai.keyMissingBoth');
    case 'quota-exceeded':
      return t('ai.quotaExceeded');
    case 'provider-unavailable':
    case 'network-error':
      // Same message as a vendor outage: from where a customer stands, "the service
      // can't be reached" and "the vendor is down" call for the exact same action.
      return t('ai.providerUnavailable');
    default:
      return error || t('ai.unknownError');
  }
}

export function renderCostHtml(cost?: CostBreakdown): string {
  if (!cost) return '';

  const n = (v: number | null) => (v === null || v === undefined ? '—' : v.toLocaleString());
  const usd = (v: number | null) =>
    v === null || v === undefined ? '—' : `$${v.toFixed(v < 0.01 ? 5 : 4)}`;

  const rows = [
    [t('ai.costInput'), n(cost.inputTokens), usd(cost.inputCost)],
    [t('ai.costOutput'), n(cost.outputTokens), usd(cost.outputCost)],
  ];
  if (cost.thinkingTokens) {
    rows.push([t('ai.costThinking'), n(cost.thinkingTokens), t('ai.costIncluded')]);
  }

  const rates =
    cost.inputRatePerMTok !== null && cost.outputRatePerMTok !== null
      ? `<div class="ai-cost-rates">${t('ai.costRates', {
          input: String(cost.inputRatePerMTok),
          output: String(cost.outputRatePerMTok),
          date: escapeHtml(cost.ratesCheckedOn),
        })}</div>`
      : '';

  return `
    <details class="ai-cost">
      <summary>
        <span>${t('ai.costTitle')}</span>
        <strong>${usd(cost.totalCost)}</strong>
        <span class="ai-cost-tokens">${n(cost.totalTokens)} tok</span>
      </summary>
      <div class="ai-cost-body">
        <div class="ai-cost-table">
          ${rows
            .map(
              ([label, tokens, price]) =>
                `<div class="ai-cost-row"><span>${label}</span><span>${tokens}</span><span>${price}</span></div>`
            )
            .join('')}
        </div>
        ${rates}
        ${cost.note ? `<p class="ai-cost-note">${escapeHtml(cost.note)}</p>` : ''}
        <p class="ai-cost-note">${t('ai.costDisclaimer')}</p>
      </div>
    </details>`;
}

/**
 * The progressive-lens verdict, given its own block at the top of the card.
 *
 * For a varifocal this is the number the whole fitting turns on: too little height and
 * the corridor does not fit inside the lens, so the wearer never reaches the reading
 * zone. Buried among nine facial figures it was easy to miss — and one of those figures
 * was not even defined, which is why three of them used to come back identical.
 */
/**
 * The Capri protocol's summary table, rendered FIRST.
 *
 * When a specific model is being fitted these are the numbers the optician reads before
 * anything else: the supplier's A and B, the three fitting heights derived from them,
 * and how the frame has to sit on that nose. Everything else in the card is context for
 * these.
 *
 * Empty when no frame identifier was given, so the ordinary report is unchanged.
 */
/**
 * The capture context: everything the local pipeline measured at the instant of the shot.
 *
 * It was already being stored with every run and never displayed anywhere. On a report
 * meant to be consulted months later that is the difference between "PD 62 mm" and
 * "PD 62 mm, measured with an ISO card at 47 cm on a frontal pose" — the second can be
 * judged, the first has to be taken on faith.
 *
 * Read defensively: this is a snapshot written by an older version of the panel as often
 * as by the current one.
 */
/**
 * Second presentation of the same run: the optician's card.
 *
 * The detailed view lists every figure the model returned, with provenance and
 * confidence, and is meant to be audited. This one is meant to be HANDED OVER — to the
 * patient, to the lab, into a file — so it shows the handful of numbers a fitting turns
 * on, large, beside the two photographs, in the layout the practice already uses on
 * paper.
 *
 * Neither view computes anything: both read the same stored run, so a figure cannot say
 * one thing here and another there. What changes is how much is shown and how big.
 */
/**
 * The model's verdict on the two photographs, above everything it measured.
 *
 * A report whose inputs were wrong is not a report with a few doubtful figures; it is a
 * report about the wrong subject. That has to be the first thing read, not a note at the
 * bottom.
 */
export function renderInputsHtml(inputs?: InputsCheck): string {
  if (!inputs) return '';

  const problems: string[] = [];
  if (inputs.faceImageShowsOnePerson === false) problems.push(t('ai.inputBadFace'));
  if (inputs.frameImageShowsEyewear === false) problems.push(t('ai.inputBadFrame'));
  if (problems.length === 0) return '';

  return `
    <div class="ai-input-alert">
      ${problems.map((p) => `<div>${p}</div>`).join('')}
      ${inputs.problem ? `<p class="ai-hint">${escapeHtml(inputs.problem)}</p>` : ''}
    </div>`;
}

export function renderOpticianCardHtml(run: {
  finishedAt: string;
  patient?: string;
  /** The practice's own name, as it heads their printed sheet. */
  practice?: string;
  /** Thumbnail of the frame photograph, shown beside its own dimensions. */
  frameImage?: string;
  results: MeasureResult[];
  tryOn: TryOnResult | null;
  tryOnProfile?: TryOnResult | null;
  context: Record<string, unknown> | null;
}): string {
  const best = run.results.find((r) => r.ok && r.measurements) ?? run.results[0];
  const m = best?.measurements;
  if (!m) return `<div class="ai-error">${t('ai.noResults')}</div>`;

  const capri = m.capri ?? {};
  const frame = m.frame ?? ({} as Measurements['frame']);
  const prog = m.progressive ?? ({} as Measurements['progressive']);

  // The card prefers the Capri block when a model number was given, because those are
  // supplier-published figures; otherwise it falls back to what the model read off the
  // photograph. Same numbers as the detailed view either way.
  const pick = <T,>(...values: Array<T | null | undefined>): T | undefined =>
    values.find((v) => v !== null && v !== undefined) as T | undefined;

  const lensWidth = pick<number>(capri.lensWidthAMM, frame.lensWidthMM);
  const bridge = pick<number>(capri.bridgeDBLMM, frame.bridgeMM);
  const temple = pick<number>(capri.templeLengthMM, frame.templeLengthMM);
  const model = pick<string>(capri.model, frame.model, capri.frameId);
  const brand = pick<string>(capri.brand, frame.brand);
  const colour = pick<string>(capri.color, frame.color);

  const mm = (v: number | null | undefined, digits = 0) =>
    v == null ? '—' : `${v.toFixed(digits)}`;

  // Keeps the decimal only when there IS one: 50 stays "50", 53.8 stays "53.8".
  //
  // Rounding a measured A to a whole number was quietly making the problem worse. The
  // supplier publishes A = 53.8 and, separately, a nominal eye size of 51 in the boxed
  // code; printing "54" beside "51-19-145" reads as one number contradicting itself
  // rather than as two measurements taken by different conventions.
  const mmExact = (v: number | null | undefined) => {
    if (v == null) return '—';
    const rounded = Math.round(v * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
  };

  // The first field of a boxed size is the NOMINAL eye size — the value stamped on the
  // temple. It is not the same measurement as A, and on this supplier's own pages the
  // two differ by a couple of millimetres.
  const nominalEye = (code: string | undefined): number | null => {
    const first = (code ?? '').match(/\d+(?:[.,]\d+)?/);
    if (!first) return null;
    const value = Number(first[0].replace(',', '.'));
    return Number.isFinite(value) ? value : null;
  };

  // The corridor height IS the fitting height for progressives; the card leads with it
  // because that is the measurement the lateral photograph exists to justify.
  const corridor = pick<number>(
    prog.fittingHeightRightMM,
    m.facial?.corridorHeightRightMM,
    m.facial?.corridorHeightLeftMM
  );
  const minimum = pick<number>(prog.minimumRequiredMM, 18);


  const sizeCode =
    pick<string>(capri.commercialSize, frame.sizeCode) ??
    (lensWidth != null && bridge != null && temple != null
      ? `${mm(lensWidth)}□${mm(bridge)}-${mm(temple)}`
      : '—');

  // Only when the two genuinely disagree does the card explain itself. When they match —
  // the ordinary case — it stays exactly as the supplied template draws it.
  const nominal = nominalEye(sizeCode);
  const sizeDiffers =
    lensWidth != null && nominal != null && Math.abs(lensWidth - nominal) >= 0.5;

  // Pupil crosshairs, from the landmarks the local pipeline measured against the RAW
  // capture. Only render_local_overlay's composite is guaranteed to share that exact
  // framing (it pastes the frame onto the same photo the landmarks came from, at the
  // same aspect ratio) — an AI-generated frontal is a reinterpretation that can crop or
  // reframe however the model chose to, so the same coordinates would land who-knows-
  // where on it. Drawing a confident line in the wrong place is worse than drawing none.
  const isLocalFrontal = run.tryOn?.method === 'local-overlay';
  const lm = isLocalFrontal ? (run.context as any)?.landmarksNormalized : null;
  const capture = (run.context as any)?.capture;
  const pupils: Array<{ x: number; y: number }> = ['rightPupil', 'leftPupil']
    .map((key) => lm?.[key])
    .filter((p) => p && typeof p.x === 'number' && typeof p.y === 'number');

  // Zooms the displayed crop in on the face rather than the frame's geometric centre —
  // matters because the raw capture is framed however far the patient happened to be
  // sitting from the camera, and a card meant to show frame-and-face detail should not
  // inherit that by accident. Centred on the true pupil midpoint when it is known (the
  // local composite); a fixed, slightly-above-centre default otherwise, which is where a
  // head normally sits in a portrait-oriented photo.
  const posX = pupils.length === 2 ? (pupils[0].x + pupils[1].x) / 2 : 0.5;
  const posY = pupils.length === 2 ? (pupils[0].y + pupils[1].y) / 2 : 0.38;
  const facePosition = `${(posX * 100).toFixed(1)}% ${(posY * 100).toFixed(1)}%`;

  // .oc-photo now crops with `object-fit: cover` into a fixed box (see style.css), so a
  // point's normalized position on the FULL source image is no longer its position on
  // screen — the crop has to be undone the same way the browser applies it, or the
  // marks land wherever they would have BEFORE zooming in, ignoring it entirely.
  const imageAspect =
    capture?.imageWidthPx > 0 && capture?.imageHeightPx > 0
      ? capture.imageWidthPx / capture.imageHeightPx
      : null;
  const marks = (imageAspect && pupils.length === 2
    ? pupils
        .map((p) => mapCoverPoint(p.x, p.y, imageAspect, OC_PHOTO_ASPECT, posX, posY))
        .filter((m): m is { left: number; top: number } => m !== null)
    : []
  )
    .map(
      (m) =>
        `<span class="oc-pupil" style="left:${m.left.toFixed(2)}%;top:${m.top.toFixed(2)}%"></span>
         <span class="oc-plumb" style="left:${m.left.toFixed(2)}%"></span>`
    )
    .join('');

  const frontal = run.tryOn?.imageDataUrl
    ? `<img class="oc-photo" src="${run.tryOn.imageDataUrl}" alt="${t('card.front')}" style="object-position:${facePosition}">${marks}`
    : `<div class="oc-nophoto">${t('card.noPhoto')}</div>`;

  const lateral = run.tryOnProfile?.imageDataUrl
    ? `<img class="oc-photo" src="${run.tryOnProfile.imageDataUrl}" alt="${t('card.side')}" style="object-position:50% 38%">`
    : `<div class="oc-nophoto">${t('card.noProfile')}</div>`;

  // The frame beside its own dimensions. This is what lets a reader confirm the numbers
  // describe the frame in front of them rather than a different one sharing a code — the
  // whole reason the supplier sheet carries a picture at all. Absent on runs saved by
  // older builds, so the panel has to read correctly without it.
  const framePhoto = run.frameImage
    ? `<figure class="oc-frame-figure">
         <img src="${run.frameImage}" alt="${t('card.frameInfo')}">
       </figure>`
    : '';

  const row = (label: string, value: string) =>
    `<div class="oc-row"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`;

  // The sheet is the practice's own document, so it carries their name. Falls back to a
  // neutral label rather than inventing a business that does not exist.
  const practice = run.practice?.trim() || t('card.practiceFallback');

  const when = new Date(run.finishedAt);

  // The practice's mark: an eye ringed by two sweeps, one red and one blue, as on the
  // sheet the client supplied. Inline SVG so it prints sharp and needs nothing external.
  const logo = (size: number) => `
    <div class="oc-logo">
      <span class="oc-logo-mark" aria-hidden="true">
        <svg viewBox="0 0 52 44" width="${size}" height="${Math.round((size * 44) / 52)}">
          <path d="M4 22 A22 17 0 0 1 48 22" fill="none" stroke="#d93a2b"
                stroke-width="5" stroke-linecap="round"/>
          <path d="M48 22 A22 17 0 0 1 4 22" fill="none" stroke="#1d5fa8"
                stroke-width="5" stroke-linecap="round"/>
          <path d="M11 22 Q26 9 41 22 Q26 35 11 22 z" fill="#ffffff"
                stroke="#0d2c5f" stroke-width="1.5" stroke-linejoin="round"/>
          <circle cx="26" cy="22" r="7.2" fill="#1d5fa8"/>
          <circle cx="26" cy="22" r="3.2" fill="#0d2c5f"/>
          <circle cx="28.3" cy="19.7" r="1.5" fill="#ffffff"/>
        </svg>
      </span>
      <span class="oc-logo-text">
        <strong>${escapeHtml(practice)}</strong>
        <em>${t('card.brandLine')}</em>
      </span>
    </div>`;

  const bar = (icon: string, label: string) =>
    `<h3 class="oc-bar"><span class="oc-ico" aria-hidden="true">${icon}</span>${label}</h3>`;

  const ICON_FRAME = `<svg viewBox="0 0 26 12" width="21" height="10">
      <circle cx="6.5" cy="6" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <circle cx="19.5" cy="6" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <path d="M11.5 5.4h3" stroke="currentColor" stroke-width="1.5"/>
      <path d="M1.5 5h-1M25.5 5h1" stroke="currentColor" stroke-width="1.5"/>
    </svg>`;
  const ICON_INFO = `<svg viewBox="0 0 20 20" width="15" height="15">
      <circle cx="10" cy="10" r="8.8" fill="none" stroke="currentColor" stroke-width="1.6"/>
      <path d="M10 8.8v5.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <circle cx="10" cy="5.8" r="1.1" fill="currentColor"/>
    </svg>`;
  const ICON_NOTES = `<svg viewBox="0 0 18 20" width="14" height="15">
      <rect x="2" y="2.5" width="14" height="15" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/>
      <path d="M5.5 7.5h7M5.5 11h7M5.5 14.5h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    </svg>`;

  return `
  <article class="optician-card">
    <header class="oc-head">
      <div class="oc-head-title">
        <h2>${t('card.title')}</h2>
        <p>${t('card.subtitle')}</p>
      </div>
      ${logo(40)}
    </header>

    <div class="oc-photos">
      <section class="oc-photo-panel">
        <span class="oc-tab">${t('card.front')}</span>
        <div class="oc-photo-wrap">
          ${frontal}
          <div class="oc-callout">
            <span>${t('card.pd')}</span>
            <strong>${mm(m.facial?.pdTotalMM)} mm</strong>
          </div>
        </div>
      </section>

      <section class="oc-photo-panel">
        <span class="oc-tab">${t('card.side')}</span>
        <div class="oc-photo-wrap">
          ${lateral}
          <div class="oc-callout oc-callout-corridor">
            <span>${t('card.corridor')}</span>
            <strong>${mm(corridor, 1)} mm</strong>
            <em>${t('card.corridorNote')}</em>
            <i>${t('card.corridorCriterion')}</i>
          </div>
        </div>
      </section>
    </div>

    <!-- Two columns, grouped as the supplied sheet groups them: the frame and its own
         three published dimensions on the left, what the measurement means and the
         caveats about it on the right. The strip belongs under the frame panel, not
         across the page: those three numbers describe the frame, nothing else. -->
    <div class="oc-lower">
      <div class="oc-col">
        <section class="oc-panel">
          ${bar(ICON_FRAME, t('card.frameInfo'))}
          <div class="oc-body oc-frame-body">
            <div class="oc-frame-specs">
              ${row(t('card.model'), [model, brand ? `(${brand})` : ''].filter(Boolean).join(' ') || '—')}
              ${row(t('card.colour'), colour ?? '—')}
              ${row(t('card.material'), frame.material ?? '—')}
              ${row(t('card.rimType'), frame.rimType ?? '—')}
              ${row(t('card.shape'), frame.shape ?? '—')}
              ${row(t('card.size'), sizeCode)}
              <p class="oc-fine">${t('card.sizeLegend')}</p>
              ${sizeDiffers ? `<p class="oc-fine oc-fine-note">${t('card.sizeVsMeasured', {
                nominal: mmExact(nominal),
                measured: mmExact(lensWidth),
              })}</p>` : ''}
            </div>
            ${framePhoto}
          </div>
        </section>

        <div class="oc-strip">
          <div class="oc-strip-cell">
            <span class="oc-strip-head">${t('card.lensWidth')}</span>
            <div class="oc-strip-body">
              <svg viewBox="0 0 60 26" class="oc-strip-ico" aria-hidden="true">
                <rect x="1.5" y="5" width="25" height="16" rx="7"
                      fill="none" stroke="currentColor" stroke-width="1.8"/>
                <rect x="33.5" y="5" width="25" height="16" rx="7"
                      fill="none" stroke="currentColor" stroke-width="1.8"/>
                <path d="M26.5 9 q3.5 -2.5 7 0" fill="none" stroke="currentColor"
                      stroke-width="1.8" stroke-linecap="round"/>
                <path d="M5 13 h18" stroke="currentColor" stroke-width="1.5"/>
                <path d="M7.6 10.6 5 13 7.6 15.4M20.4 10.6 23 13 20.4 15.4" fill="none"
                      stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                      stroke-linejoin="round"/>
              </svg>
              <strong>${mmExact(lensWidth)} mm</strong>
            </div>
          </div>
          <div class="oc-strip-cell">
            <span class="oc-strip-head">${t('card.bridge')}</span>
            <div class="oc-strip-body">
              <svg viewBox="0 0 60 26" class="oc-strip-ico" aria-hidden="true">
                <path d="M1 6 h11 a6 6 0 0 1 5 6.5 a7 7 0 0 1 -7 7.5 h-9"
                      fill="none" stroke="currentColor" stroke-width="1.8"
                      stroke-linecap="round"/>
                <path d="M59 6 h-11 a6 6 0 0 0 -5 6.5 a7 7 0 0 0 7 7.5 h9"
                      fill="none" stroke="currentColor" stroke-width="1.8"
                      stroke-linecap="round"/>
                <path d="M12 6.4 q18 -5 36 0" fill="none" stroke="currentColor"
                      stroke-width="2" stroke-linecap="round"/>
                <path d="M18 17 h24" stroke="currentColor" stroke-width="1.5"/>
                <path d="M20.6 14.6 18 17 20.6 19.4M39.4 14.6 42 17 39.4 19.4" fill="none"
                      stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                      stroke-linejoin="round"/>
              </svg>
              <strong>${mmExact(bridge)} mm</strong>
            </div>
          </div>
          <div class="oc-strip-cell">
            <span class="oc-strip-head">${t('card.temple')}</span>
            <div class="oc-strip-body">
              <svg viewBox="0 0 60 26" class="oc-strip-ico" aria-hidden="true">
                <path d="M3 3.5 v9" stroke="currentColor" stroke-width="2"
                      stroke-linecap="round"/>
                <path d="M3 7 h39 q11 0 12.5 7 t-4.5 8" fill="none" stroke="currentColor"
                      stroke-width="2.1" stroke-linecap="round"/>
                <path d="M4.5 18 h46" stroke="currentColor" stroke-width="1.5"/>
                <path d="M7.1 15.6 4.5 18 7.1 20.4M47.9 15.6 50.5 18 47.9 20.4" fill="none"
                      stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                      stroke-linejoin="round"/>
              </svg>
              <strong>${mmExact(temple)} mm</strong>
            </div>
          </div>
        </div>
      </div>

      <div class="oc-col">
        <section class="oc-panel">
          ${bar(ICON_INFO, t('card.reference'))}
          <div class="oc-body oc-ref">
            <div class="oc-ref-figure" aria-hidden="true">
              <span class="oc-ref-label oc-ref-label-top">${t('card.refPupil')}</span>
              <span class="oc-ref-label oc-ref-label-bottom">${t('card.refRim')}</span>
              <svg viewBox="0 0 150 96" class="oc-ref-svg">
                <path d="M38 30 Q70 8 102 30 Q70 52 38 30 z"
                      fill="#ffffff" stroke="#1c4a8f" stroke-width="2" stroke-linejoin="round"/>
                <circle cx="70" cy="30" r="11" fill="#cfe0f4" stroke="#1c4a8f" stroke-width="1.6"/>
                <circle cx="70" cy="30" r="4.6" fill="#0d2c5f"/>
                <circle cx="72.4" cy="27.4" r="1.6" fill="#ffffff"/>
                <path d="M36 26 Q70 2 104 26" fill="none" stroke="#1c4a8f" stroke-width="1.4"
                      stroke-linecap="round" opacity="0.55"/>
                <path d="M24 66 Q70 84 116 66" fill="none" stroke="#1c4a8f" stroke-width="3"
                      stroke-linecap="round"/>
                <line x1="18" y1="30" x2="122" y2="30" stroke="#d4322b" stroke-width="1.1"
                      stroke-dasharray="5 4"/>
                <line x1="18" y1="74" x2="122" y2="74" stroke="#d4322b" stroke-width="1.1"
                      stroke-dasharray="5 4"/>
                <line x1="70" y1="32" x2="70" y2="72" stroke="#d4322b" stroke-width="1.8"/>
                <path d="M66.6 35.4 70 31 73.4 35.4M66.6 68.6 70 73 73.4 68.6" fill="none"
                      stroke="#d4322b" stroke-width="1.8" stroke-linecap="round"
                      stroke-linejoin="round"/>
              </svg>
            </div>
            <p class="oc-ref-caption">${t('card.referenceBody')}</p>
            <p class="oc-ref-formula">${t('card.referenceFormula')}</p>
          </div>
        </section>

        <section class="oc-panel oc-notes">
          ${bar(ICON_NOTES, t('card.notes'))}
          <div class="oc-body">
            <ul>
              <li>${t('card.noteMonoPd', {
                od: mm(m.facial?.pdRightMM, 1),
                os: mm(m.facial?.pdLeftMM, 1),
              })}</li>
              <li>${t('card.noteProgressive', {
                min: mm(minimum, 0),
                value: mm(corridor, 1),
              })}</li>
              <li>${t('card.noteSource')}</li>
            </ul>
          </div>
        </section>
      </div>
    </div>

    <footer class="oc-foot">
      <div class="oc-foot-item">
        <span class="oc-ico" aria-hidden="true">
          <svg viewBox="0 0 18 18" width="14" height="14">
            <rect x="2" y="3.5" width="14" height="12.5" rx="2" fill="none" stroke="currentColor"
                  stroke-width="1.6"/>
            <path d="M2 7.6h14M6 2v3M12 2v3" stroke="currentColor" stroke-width="1.6"
                  stroke-linecap="round"/>
          </svg>
        </span>
        <span class="oc-foot-label">${t('card.date')}:</span>
        <strong>${when.toLocaleDateString(getLang() === 'es' ? 'es-ES' : 'en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}</strong>
      </div>
      <div class="oc-foot-item">
        <span class="oc-ico" aria-hidden="true">
          <svg viewBox="0 0 18 18" width="14" height="14">
            <circle cx="9" cy="6" r="3.4" fill="none" stroke="currentColor" stroke-width="1.6"/>
            <path d="M2.6 16a6.4 6.4 0 0 1 12.8 0" fill="none" stroke="currentColor" stroke-width="1.6"/>
          </svg>
        </span>
        <span class="oc-foot-label">${t('card.patient')}:</span>
        <strong>${escapeHtml(run.patient || '—')}</strong>
      </div>
      <div class="oc-foot-logo">${logo(32)}</div>
    </footer>
  </article>`;
}

export function renderContextHtml(context: Record<string, unknown> | null): string {
  if (!context) return `<p class="ai-hint">${t('report.noContext')}</p>`;

  const get = (path: string): unknown =>
    path.split('.').reduce<any>((acc, key) => (acc == null ? acc : acc[key]), context);

  const num = (v: unknown, digits = 1, unit = '') =>
    typeof v === 'number' && isFinite(v)
      ? `${v.toFixed(digits)}${unit}`
      : `<span class="ai-null">${t('ai.notEstablished')}</span>`;

  const rows: Array<[string, string]> = [
    [t('report.ctxScale'), num(get('scale.millimetresPerNormalizedXUnit'), 2, ' mm/u')],
    [t('report.ctxScaleSource'), String(get('scale.source') ?? '—')],
    [
      t('report.ctxCard'),
      get('scale.cardAccepted') ? t('report.ctxCardYes') : t('report.ctxCardNo'),
    ],
    [t('report.ctxDistance'), num(get('captureDistance.millimetres'), 0, ' mm')],
    [t('report.ctxDistanceMethod'), String(get('captureDistance.method') ?? '—')],
    [
      t('report.ctxPose'),
      get('pose.isFrontal') ? t('report.ctxPoseFrontal') : t('report.ctxPoseNotFrontal'),
    ],
    [t('report.ctxPantoscopic'), num(get('pose.pantoscopicTiltDeg'), 1, '°')],
    [t('ai.f.pdTotalMM'), num(get('measuredFacial.pdTotalMM'), 1, ' mm')],
    [t('ai.f.pdRightMM'), num(get('measuredFacial.pdRightMM'), 1, ' mm')],
    [t('ai.f.pdLeftMM'), num(get('measuredFacial.pdLeftMM'), 1, ' mm')],
    [t('report.ctxHeightR'), num(get('measuredFacial.fittingHeightRightMM'), 1, ' mm')],
    [t('report.ctxHeightL'), num(get('measuredFacial.fittingHeightLeftMM'), 1, ' mm')],
    [t('report.ctxHeadWidth'), num(get('measuredFacial.headWidthMM'), 1, ' mm')],
    [t('report.ctxTempleReach'), num(get('measuredFacial.templeReachDepthMM'), 1, ' mm')],
    [
      t('report.ctxImage'),
      `${get('capture.imageWidthPx') ?? '—'} × ${get('capture.imageHeightPx') ?? '—'} px`,
    ],
  ];

  const landmarks = get('landmarksNormalized') as Record<string, any> | undefined;
  const landmarkRows =
    landmarks && typeof landmarks === 'object'
      ? Object.entries(landmarks)
          .filter(([, v]) => v && typeof v === 'object' && 'x' in v)
          .map(
            ([name, pt]) =>
              `<div class="ai-row"><span class="ai-row-label">${escapeHtml(name)}</span>` +
              `<span class="ai-row-value">${(pt.x as number).toFixed(4)}, ${(pt.y as number).toFixed(4)}</span></div>`
          )
          .join('')
      : '';

  const frame = get('catalogFrameOnScreen') as Record<string, any> | undefined;
  const frameLine =
    frame && frame.name
      ? `<p class="ai-hint">${t('report.ctxCatalogFrame', {
          name: escapeHtml(String(frame.name)),
          mm: String(frame.totalFrontWidthMM ?? '—'),
        })}</p>`
      : '';

  return `
    <div class="ai-table">
      ${rows
        .map(
          ([label, value]) =>
            `<div class="ai-row"><span class="ai-row-label">${label}</span><span class="ai-row-value">${value}</span></div>`
        )
        .join('')}
    </div>
    ${frameLine}
    ${
      landmarkRows
        ? `<h4 class="ai-sub">${t('report.ctxLandmarks')}</h4>
           <p class="ai-hint">${t('report.ctxLandmarksNote')}</p>
           <div class="ai-table">${landmarkRows}</div>`
        : ''
    }`;
}

/**
 * Says whether the supplier page was actually read.
 *
 * This is the difference between a dimension quoted from the manufacturer and one the
 * model produced with no source in front of it. Both look identical in the table, so the
 * provenance has to be stated separately or it is not stated at all.
 */
/**
 * Says whether the supplier page was actually read.
 *
 * This is the difference between a dimension quoted from the manufacturer and one the
 * model produced with no source in front of it. Both look identical in the table, so the
 * provenance has to be stated separately or it is not stated at all.
 *
 * The green verdict demands a page on the SAME HOST we asked for. A model that searched
 * the web and cited a blog has still not read the supplier's technical table, and saying
 * "supplier page read" there would be the exact false reassurance this box exists to
 * prevent — so those citations are shown, but under the warning.
 */
export function renderRetrievalHtml(
  browseUrls?: string[],
  retrieval?: Array<{ url: string; status: string }>,
  browsingSupported?: boolean
): string {
  if (!browseUrls || browseUrls.length === 0) return '';

  // "Could not" and "could, but did not" are different findings. The first is a reason to
  // switch provider; the second is a reason to retry or check the identifier.
  if (browsingSupported === false) {
    return `
      <div class="ai-retrieval ai-retrieval-bad">
        <span class="ai-retrieval-mark">⃠</span>
        <div>
          <strong>${t('ai.retrievalUnsupported')}</strong>
          <p class="ai-hint">${t('ai.retrievalUnsupportedHint')}</p>
        </div>
      </div>`;
  }

  const host = (raw: string): string => {
    try {
      return new URL(raw).host.replace(/^www\./, '').toLowerCase();
    } catch {
      return '';
    }
  };
  const wanted = new Set(browseUrls.map(host).filter(Boolean));

  // What counts as "read": Gemini reports a retrieval status containing SUCCESS; OpenAI
  // reports either a citation (SUCCESS) or an opened page (OPENED). Asking OpenAI for a
  // bare JSON object means there are no citations to find at all -- those live in prose
  // -- so demanding one would report every successful lookup as a failure.
  const READ = /SUCCESS|OPENED/i;
  const entries = retrieval ?? [];
  const onTarget = entries.filter(
    (r) => READ.test(r.status) && wanted.has(host(r.url))
  );

  if (onTarget.length > 0) {
    return `
      <div class="ai-retrieval ai-retrieval-ok">
        <span class="ai-retrieval-mark">✓</span>
        <div>
          <strong>${t('ai.retrievalOk')}</strong>
          ${onTarget.map((r) => `<p class="ai-hint">${escapeHtml(r.url)}</p>`).join('')}
        </div>
      </div>`;
  }

  // Whatever it did consult is worth showing: it is the difference between a model that
  // never looked and one that looked in the wrong place.
  const elsewhere = entries.length
    ? `<p class="ai-hint">${t('ai.retrievalElsewhere')}</p>${entries
        .map((r) => `<p class="ai-hint">${escapeHtml(r.url)} — ${escapeHtml(r.status)}</p>`)
        .join('')}`
    : '';

  return `
    <div class="ai-retrieval ai-retrieval-bad">
      <span class="ai-retrieval-mark">✕</span>
      <div>
        <strong>${t('ai.retrievalNone')}</strong>
        <p class="ai-hint">${t('ai.retrievalNoneHint')}</p>
        ${elsewhere}
      </div>
    </div>`;
}

export function renderCapriHtml(
  c?: CapriResult,
  frameId?: string,
  browseUrls?: string[],
  urlRetrieval?: Array<{ url: string; status: string }>,
  browsingSupported?: boolean
): string {
  const retrieval = renderRetrievalHtml(browseUrls, urlRetrieval, browsingSupported);

  // Whether the page was actually opened decides WHICH explanation is true. Printing the
  // "no internet access" one under a green "supplier page read" badge is a panel arguing
  // with itself, and it sends the operator after a cause that is not there.
  const pageWasRead = (urlRetrieval ?? []).some((r) => /SUCCESS|OPENED/i.test(r.status));
  const has = (v: unknown) => v !== null && v !== undefined;

  // `notes`, `confidence` and `bSource` are always populated by the normalizer, so they
  // say nothing about whether anything was actually established. Only the measurements
  // and the identity count.
  const METADATA = new Set(['notes', 'confidence', 'bSource']);
  const substantive = c
    ? Object.entries(c).some(([key, value]) => !METADATA.has(key) && has(value))
    : false;
  const empty = !substantive;

  // An all-null Capri block used to render as nothing at all, which is the worst of the
  // three possible answers: the optician cannot tell "the protocol ran and established
  // nothing" from "the protocol never ran". NOT DETECTED is a result, and it has to be
  // said out loud — that was the whole point of the rule. Only a run that never asked for
  // the protocol stays silent.
  if (empty || !c) {
    if (!frameId) return '';
    return `
    <div class="ai-capri ai-capri-empty">
      <div class="ai-capri-head">
        <span class="ai-capri-title">${t('ai.capriTitle')}</span>
        <span class="ai-capri-id">${escapeHtml(frameId)}</span>
      </div>
      <p class="ai-null-block">${t('ai.capriNotDetected')}</p>
      ${retrieval}
      <p class="ai-hint">${t(pageWasRead ? 'ai.capriReadButEmpty' : 'ai.capriNoBrowsing')}</p>
    </div>`;
  }

  const conf = (field: string) => {
    const level = c.confidence?.[field];
    return level ? `<span class="ai-conf ai-conf-${escapeHtml(level.toLowerCase())}">${escapeHtml(level)}</span>` : '';
  };

  const row = (field: string, value: number | null | undefined, unit = ' mm') =>
    `<div class="ai-row">
       <span class="ai-row-label">${fieldLabel(field)}</span>
       <span class="ai-row-value">${
         has(value) ? `${(value as number).toFixed(1)}${unit}` : `<span class="ai-null">${t('ai.notEstablished')}</span>`
       }</span>
       ${conf(field)}
     </div>`;

  const identity = [
    c.brand ? `<strong>${escapeHtml(c.brand)}</strong>` : '',
    c.model || c.frameId ? escapeHtml(String(c.model || c.frameId)) : '',
    c.color ? escapeHtml(c.color) : '',
    c.commercialSize ? escapeHtml(c.commercialSize) : '',
  ].filter(Boolean).join(' · ');

  const source = c.sourceUrl
    ? `<p class="ai-hint">${escapeHtml(c.sourceUrl)}</p>`
    : '';

  const fallback =
    c.bSource === 'fallback_b_equals_a'
      ? `<p class="ai-hint ai-bad">${t('ai.capriFallbackB')}</p>`
      : '';

  return `
    <div class="ai-capri">
      <div class="ai-capri-head">
        <span class="ai-capri-title">${t('ai.capriTitle')}</span>
        ${identity ? `<span class="ai-capri-id">${identity}</span>` : ''}
      </div>
      ${retrieval}

      <h4 class="ai-sub">${t('ai.capriHeights')}</h4>
      <div class="ai-capri-grid">
        <div><span>${t('ai.f.monofocalHeightMM')}</span><strong>${
          has(c.monofocalHeightMM) ? `${c.monofocalHeightMM!.toFixed(1)} mm` : '—'
        }</strong></div>
        <div><span>${t('ai.f.bifocalHeightMM')}</span><strong>${
          has(c.bifocalHeightMM) ? `${c.bifocalHeightMM!.toFixed(1)} mm` : '—'
        }</strong></div>
        <div><span>${t('ai.f.progressiveHeightMM')}</span><strong>${
          has(c.progressiveHeightMM) ? `${c.progressiveHeightMM!.toFixed(1)} mm` : '—'
        }</strong></div>
      </div>
      <p class="ai-hint">${t('ai.capriHeightsNote')}</p>

      <h4 class="ai-sub">${t('ai.capriFrame')}</h4>
      <div class="ai-table">
        ${row('lensWidthAMM', c.lensWidthAMM)}
        ${row('lensHeightBMM', c.lensHeightBMM)}
        ${row('edMM', c.edMM)}
        ${row('circMM', c.circMM)}
        ${row('bridgeDBLMM', c.bridgeDBLMM)}
        ${row('templeLengthMM', c.templeLengthMM)}
      </div>
      ${fallback}
      ${source}

      <h4 class="ai-sub">${t('ai.capriPlacement')}</h4>
      <div class="ai-table">
        ${row('personNasalBridgeWidthMM', c.personNasalBridgeWidthMM)}
        ${row('bridgeWidthDifferenceMM', c.bridgeWidthDifferenceMM)}
        ${row('verticalOffsetAboveBridgeMM', c.verticalOffsetAboveBridgeMM)}
        ${row('pixelsPerMM', c.pixelsPerMM, ' px/mm')}
        ${row('verticalOffsetPx', c.verticalOffsetPx, ' px')}
        ${row('horizontalAdjustmentPx', c.horizontalAdjustmentPx, ' px')}
        ${row('verticalAdjustmentPx', c.verticalAdjustmentPx, ' px')}
      </div>
      ${c.headRotationNote ? `<p class="ai-hint">${escapeHtml(c.headRotationNote)}</p>` : ''}
      ${renderList(t('ai.notes'), c.notes ?? [], 'ai-list-notes')}
      <p class="ai-hint">${t('ai.capriDisclaimer')}</p>
    </div>`;
}

export function renderProgressiveHtml(p?: ProgressiveResult): string {
  if (!p) return '';

  const heights = [p.fittingHeightRightMM, p.fittingHeightLeftMM];
  if (heights.every((h) => h == null)) return '';

  const mm = (v: number | null) =>
    v == null ? `<span class="ai-null">${t('ai.notEstablished')}</span>` : `${v.toFixed(1)} mm`;

  const state = p.suitable === true ? 'good' : p.suitable === false ? 'bad' : 'unknown';
  const verdict =
    p.suitable === true
      ? t('ai.progOk')
      : p.suitable === false
        ? t('ai.progNo')
        : t('ai.progUnknown');

  return `
    <div class="ai-prog ai-prog-${state}">
      <div class="ai-prog-head">
        <span class="ai-prog-title">${t('ai.progTitle')}</span>
        <span class="ai-prog-verdict">${verdict}</span>
      </div>
      <div class="ai-prog-grid">
        <div><span>${t('ai.progRight')}</span><strong>${mm(p.fittingHeightRightMM)}</strong></div>
        <div><span>${t('ai.progLeft')}</span><strong>${mm(p.fittingHeightLeftMM)}</strong></div>
        <div><span>${t('ai.progMin')}</span><strong>${mm(p.minimumRequiredMM)}</strong></div>
      </div>
      ${p.note ? `<p class="ai-hint">${escapeHtml(p.note)}</p>` : ''}
    </div>`;
}

export function renderResultCard(result: MeasureResult, opts: RenderOptions = {}): string {
  const head = `
    <div class="ai-result-head">
      <span class="ai-badge ai-badge-${result.strategy.toLowerCase()}">${t('ai.proposal')} ${result.strategy}</span>
      <span class="ai-engine">${escapeHtml(result.providerLabel)} · ${escapeHtml(result.model)}</span>
      ${result.latencyMs !== undefined ? `<span class="ai-latency">${(result.latencyMs / 1000).toFixed(1)} s</span>` : ''}
    </div>`;

  if (!result.ok || !result.measurements) {
    return `
      <article class="ai-result ai-result-failed">
        ${head}
        <div class="ai-error">${escapeHtml(
          failureMessage(result.error, result.errorCode)
        )}</div>
        ${renderCostHtml(result.cost)}
        ${renderRaw(result)}
      </article>`;
  }

  const m = result.measurements;

  const facialRows = FACIAL_ORDER.map((field) =>
    renderRow(field, m.facial[field], m, opts)
  ).join('');
  const frameRows = FRAME_NUMERIC_ORDER.map((field) =>
    renderRow(field as string, m.frame[field] as number | null, m, opts)
  ).join('');

  const identity = (['brand', 'model', 'color', 'sizeCode', 'shape', 'material'] as const)
    .map((field) => {
      const value = m.frame[field];
      if (!value) return '';
      return `<div class="ai-id-item"><span>${fieldLabel(field)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
    })
    .join('');

  const score = m.fit.score;
  const fitBlock = `
    <div class="ai-fit">
      <div class="ai-fit-head">
        <span class="ai-fit-title">${t('ai.fitTitle')}</span>
        ${score !== null ? `<span class="ai-score ${scoreClass(score)}">${Math.round(score)}/100</span>` : ''}
      </div>
      ${m.fit.verdict ? `<p class="ai-verdict">${escapeHtml(m.fit.verdict)}</p>` : ''}
      ${renderList(t('ai.issues'), m.fit.issues, 'ai-list-issues')}
      ${renderList(t('ai.recommendations'), m.fit.recommendations, 'ai-list-recs')}
    </div>`;

  const warnings = m.warnings.length
    ? `<div class="ai-warnings">${m.warnings.map((w) => `<div>⚠️ ${escapeHtml(w)}</div>`).join('')}</div>`
    : '';

  const usage = result.usage?.totalTokens
    ? `<div class="ai-usage">${t('ai.tokens', { n: String(result.usage.totalTokens) })}</div>`
    : '';

  return `
    <article class="ai-result">
      ${head}
      ${renderInputsHtml(m.inputs)}
      ${renderCapriHtml(
        m.capri,
        opts.frameId,
        result.browseUrls,
        result.urlRetrieval,
        result.browsingSupported
      )}
      ${warnings}
      ${renderProgressiveHtml(m.progressive)}
      <h4 class="ai-sub">${t('ai.facialTable')}</h4>
      <div class="ai-table">${facialRows}</div>
      <h4 class="ai-sub">${t('ai.frameTable')}</h4>
      ${identity ? `<div class="ai-identity">${identity}</div>` : ''}
      <div class="ai-table">${frameRows}</div>
      ${fitBlock}
      ${renderList(t('ai.notes'), m.notes, 'ai-list-notes')}
      ${usage}
      ${renderCostHtml(result.cost)}
      ${renderRaw(result)}
    </article>`;
}

export function renderResultsHtml(
  results: MeasureResult[],
  opts: RenderOptions = {}
): string {
  if (results.length === 0) return `<div class="ai-error">${t('ai.noResults')}</div>`;
  return results.map((r) => renderResultCard(r, opts)).join('');
}

/**
 * The picture of the patient wearing the frame.
 *
 * It carries its own provenance line: a deterministic composite and a generated image
 * are not interchangeable evidence, and the operator must be able to tell at a glance
 * which one they are looking at.
 */
/**
 * Explains an absent picture without inventing a cause.
 *
 * An image can be missing for two unrelated reasons: the provider never produced one, or
 * it did and the browser had nowhere to keep it. Reporting the second as the first is
 * what made a perfectly good run look like a vendor failure.
 */
function renderMissingImage(view: TryOnResult): string {
  if (view.imageDropped) {
    return `<div class="ai-notice">${t('ai.imageDropped')}</div>`;
  }
  return `<div class="ai-error">${escapeHtml(
    failureMessage(view.error, view.errorCode)
  )}</div>`;
}

export function renderTryOnHtml(
  tryOn: TryOnResult | null,
  saveButtonId?: string,
  profile?: TryOnResult | null
): string {
  if (!tryOn) return renderProfileHtml(profile);

  if (!tryOn.ok || !tryOn.imageDataUrl) {
    return `
      <div class="ai-tryon-card ai-tryon-failed">
        <span class="ai-sub">${t('ai.tryOnTitle')}</span>
        ${renderMissingImage(tryOn)}
      </div>
      ${renderProfileHtml(profile)}`;
  }

  const isLocal = tryOn.method === 'local-overlay';
  const geometry = tryOn.geometry
    ? `<div class="ai-tryon-geo">
         <span>${t('ai.tryOnFrameWidth', {
           mm: (tryOn.geometry.frameTotalWidthMM ?? 0).toFixed(1),
         })}</span>
         <span>${escapeHtml(tryOn.geometry.frameWidthSource ?? '')}</span>
         <span>${t('ai.tryOnRoll', { deg: (tryOn.geometry.rollAngleDeg ?? 0).toFixed(1) })}</span>
       </div>`
    : '';

  const saveButton = saveButtonId
    ? `<button type="button" class="btn btn-secondary" id="${saveButtonId}">${t('ai.tryOnSave')}</button>`
    : '';

  return `
    <div class="ai-tryon-card">
      <div class="ai-tryon-head">
        <span class="ai-sub">${t('ai.tryOnTitle')}</span>
        <span class="ai-badge ${isLocal ? 'ai-badge-local' : 'ai-badge-gen'}">
          ${isLocal ? t('ai.tryOnLocal') : t('ai.tryOnGenerated')}
        </span>
      </div>
      <img class="ai-tryon-img" src="${tryOn.imageDataUrl}" alt="${t('ai.tryOnTitle')}">
      ${geometry}
      ${tryOn.note ? `<p class="ai-hint">${escapeHtml(tryOn.note)}</p>` : ''}
      ${saveButton}
    </div>
    ${renderProfileHtml(profile)}`;
}

/**
 * The side view, when one was asked for.
 *
 * Kept visually distinct from the frontal composite and labelled as extrapolated,
 * because it is: no side photograph of the patient exists anywhere in this flow. It
 * shows how the temple would run to the ear and how the front would tilt — useful to
 * show a patient, worthless as evidence.
 */
export function renderProfileHtml(profile?: TryOnResult | null): string {
  if (!profile) return '';

  if (!profile.ok || !profile.imageDataUrl) {
    return `
      <div class="ai-tryon-card ai-tryon-profile ai-tryon-failed">
        <span class="ai-sub">${t('ai.profileTitle')}</span>
        ${renderMissingImage(profile)}
      </div>`;
  }

  return `
    <div class="ai-tryon-card ai-tryon-profile">
      <div class="ai-tryon-head">
        <span class="ai-sub">${t('ai.profileTitle')}</span>
        <span class="ai-badge ai-badge-gen">${t('ai.profileExtrapolated')}</span>
      </div>
      <img class="ai-tryon-img" src="${profile.imageDataUrl}" alt="${t('ai.profileTitle')}">
      ${profile.note ? `<p class="ai-hint">${escapeHtml(profile.note)}</p>` : ''}
    </div>`;
}

/** Wires the raw-answer disclosures inside a container that was just filled. */
export function attachRawToggles(root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>('.ai-raw-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pre = btn.nextElementSibling as HTMLElement | null;
      if (pre) pre.classList.toggle('hidden');
    });
  });
}

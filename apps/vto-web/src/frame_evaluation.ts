/**
 * Answers one question: DOES THIS GLB REPRESENT THIS FRAME?
 *
 * The model is measured by `frame_metrology`, the frame is declared by
 * `frame_descriptor`, and this module puts the two side by side. It is the "Evaluar"
 * step — and the gate the measured fitting height (F4) is allowed through, because
 * measuring a height on a model that does not match its own spec sheet is worse than
 * the heuristic it replaces: the number looks measured.
 *
 * THE SCALE QUESTION COMES FIRST, AND IT DECIDES WHAT ELSE IS PROVABLE
 * The glTF specification fixes the unit of distance at the METRE. When a file honours
 * that, its front width is an absolute measurement and every dimension below can be
 * checked against the descriptor independently — the descriptor is not needed to read
 * the model. When it does not (generators routinely emit arbitrary units), the only
 * scale available is the declared width, and checking a converted width against the
 * number that produced it proves nothing. Rather than hide that, the evaluation states
 * which regime it is in and marks the rows that stop being independent.
 *
 * Proportions survive either way. B/A and DBL/A are scale-free, so they test the
 * model's shape against the published shape no matter how it was exported. In the
 * arbitrary-units regime they are the only real evidence there is.
 */

import {
  END_PIECE_OVERHANG_MM,
  type Confidence,
  type FrameDescriptor,
  type MeasurementRange,
} from './frame_descriptor';
import type { FrameMetrology } from './frame_metrology';

/**
 * Front width band, in mm, within which a file read as metres is taken to be metric.
 * Deliberately wider than the clinical range (schema.py uses 105-165) because this is
 * only separating "metres" from "arbitrary units", not judging the frame.
 */
const METRIC_PLAUSIBLE_FRONT_WIDTH_MM = { min: 95, max: 175 } as const;

/**
 * Largest left/right difference tolerated on a lens opening, in mm. Eyewear is
 * symmetric by construction, so anything past this is a defect in the mesh.
 */
const SYMMETRY_TOLERANCE_MM = 1.5;

export type RowVerdict =
  /** Measured value sits inside the declared range. */
  | 'ok'
  /** Measured value sits outside the declared range. */
  | 'out-of-range'
  /** The descriptor declares nothing to compare against. */
  | 'no-data'
  /** The model could not be measured here. */
  | 'not-measured'
  /**
   * Comparable only because the descriptor supplied the scale, so the comparison is
   * circular and carries no evidence. Shown, never counted as a pass.
   */
  | 'not-independent';

export interface EvaluationRow {
  /** Operator-facing label, Spanish. */
  label: string;
  /** What the model measures. Null when it could not be measured. */
  measured: number | null;
  /** What the descriptor declares. */
  declaredMin: number | null;
  declaredMax: number | null;
  declaredNominal: number | null;
  /** Units for display: 'mm' or '' for a bare ratio. */
  unit: 'mm' | '';
  verdict: RowVerdict;
  /** Confidence the descriptor published this figure under. */
  confidence: Confidence;
  /** Extra explanation for this row, when one is warranted. */
  note: string | null;
}

export type ScaleRegime = 'metric' | 'arbitrary' | 'unmeasurable';

export interface ScaleFinding {
  regime: ScaleRegime;
  /** Front width read as glTF metres. Null when the model has no measurable width. */
  asMetresMM: number | null;
  /** mm per native unit once the declared width is imposed. Null without a declared width. */
  impliedScale: number | null;
  /**
   * Factor `normalizeFrameWidth` will apply. ~1 means the generator got the scale right;
   * a large value means the model arrived at a scale that means nothing.
   */
  correctionFactor: number | null;
  message: string;
}

export type OverallVerdict = 'usable' | 'suspect' | 'unusable';

export interface FrameEvaluation {
  identity: string;
  scale: ScaleFinding;
  rows: EvaluationRow[];
  /** Left/right difference on the lens openings, in mm. Null when either is missing. */
  symmetryDeltaMM: number | null;
  overall: OverallVerdict;
  /** Why the overall verdict came out as it did. */
  reasons: string[];
  /**
   * Whether F4 may read a fitting height off this model. False when the evaluation
   * found the model unusable or could not establish its axes.
   */
  heightMeasurementAllowed: boolean;
  /** The circularity caveat, in the words the panel must print. */
  caveat: string;
}

function hasRange(r: MeasurementRange): boolean {
  return r.min !== null || r.max !== null || r.nominal !== null;
}

/** Widest interval the descriptor allows, falling back to the nominal when needed. */
function interval(r: MeasurementRange): { lo: number; hi: number } | null {
  const lo = r.min ?? r.nominal;
  const hi = r.max ?? r.nominal;
  if (lo === null || hi === null) return null;
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

function buildRow(
  label: string,
  measured: number | null,
  declared: MeasurementRange,
  unit: 'mm' | '',
  opts: { independent: boolean; padLo?: number; padHi?: number; note?: string | null } = {
    independent: true,
  }
): EvaluationRow {
  const base: EvaluationRow = {
    label,
    measured,
    declaredMin: declared.min,
    declaredMax: declared.max,
    declaredNominal: declared.nominal,
    unit,
    verdict: 'no-data',
    confidence: declared.confidence,
    note: opts.note ?? null,
  };

  if (measured === null) return { ...base, verdict: 'not-measured' };
  if (!hasRange(declared)) return { ...base, verdict: 'no-data' };
  if (!opts.independent) return { ...base, verdict: 'not-independent' };

  const iv = interval(declared);
  if (!iv) return { ...base, verdict: 'no-data' };

  const lo = iv.lo - (opts.padLo ?? 0);
  const hi = declared.openEnded ? Infinity : iv.hi + (opts.padHi ?? 0);
  return { ...base, verdict: measured >= lo && measured <= hi ? 'ok' : 'out-of-range' };
}

/** A scale-free ratio row, built from two declared dimensions. */
function ratioRow(
  label: string,
  measured: number | null,
  numerator: MeasurementRange,
  denominator: MeasurementRange,
  note: string | null
): EvaluationRow {
  const n = interval(numerator);
  const d = interval(denominator);
  const declared: MeasurementRange = {
    raw: null,
    // The widest ratio the two published ranges allow.
    min: n && d && d.hi > 0 ? n.lo / d.hi : null,
    max: n && d && d.lo > 0 ? n.hi / d.lo : null,
    nominal:
      numerator.nominal !== null && denominator.nominal ? numerator.nominal / denominator.nominal : null,
    openEnded: false,
    confidence: numerator.confidence,
    note: null,
  };
  return buildRow(label, measured, declared, '', { independent: true, note });
}

/**
 * Checks the model against the boxing identity
 *     front = 2A + DBL + 2 x (outer rim) + end pieces
 *
 * It exists to catch the failure the whole aperture approach is exposed to: if the flood
 * fill latches onto something smaller than the real lens opening, A comes out too small
 * and the leftover width blows up — which no comparison against a spec sheet would
 * distinguish from "this is simply a different frame".
 *
 * THE RIM TERM IS NOT OPTIONAL. An earlier version tested the leftover against the
 * dataset's bare 2-6 mm end-piece figure, which silently assumes a thin rim. Measured on
 * the sample model that reported 27 mm against a 12 mm ceiling and read as a detection
 * failure — but the widest empty run in that half of the front is 43.3 mm against a
 * detected 44.2 mm opening, so the aperture was right and the frame is simply thick and
 * flared. The same false alarm would fire on `up327`, a 7.5 mm acetate cat-eye in the
 * catalogue itself: its rims alone account for 15 mm. The published
 * `derived_total_front_width = 2A + DBL` omits the rim as well as the end pieces, so the
 * rim has to be added back before the leftover means anything.
 *
 * When the descriptor declares no rim (a rimless frame genuinely has none) the bare
 * end-piece band is the right expectation.
 */
function coherenceRow(
  m: FrameMetrology,
  d: FrameDescriptor,
  k: number | null
): EvaluationRow {
  const od = m.sides.od.aperture;
  const os = m.sides.os.aperture;
  const measurable =
    od.confidence === 'measured' &&
    os.confidence === 'measured' &&
    m.nativeBridge !== null &&
    m.nativeFrontWidth > 0 &&
    k !== null;

  const leftover = measurable
    ? (m.nativeFrontWidth - (od.width + os.width + (m.nativeBridge as number))) * (k as number)
    : null;

  const rim = d.geometry.rimThicknessMM ?? 0;
  const lo = END_PIECE_OVERHANG_MM.min + 2 * rim;
  // The upper bound is generous on purpose: the rim thickness is a `heuristic` figure and
  // a flared front is widest at its corners, where the bounding box reads it.
  const hi = END_PIECE_OVERHANG_MM.max * 2 + 2 * rim;

  const impliedRim = leftover !== null ? (leftover - END_PIECE_OVERHANG_MM.min) / 2 : null;

  const base: EvaluationRow = {
    label: 'Sobrante frontal',
    measured: leftover,
    declaredMin: lo,
    declaredMax: hi,
    declaredNominal: null,
    unit: 'mm',
    // Internal to the model, so it is never 'not-independent' — but it is only in
    // millimetres once a scale exists, which is why it still needs k.
    verdict: 'not-measured',
    // Never stronger than the rim figure it leans on.
    confidence: rim > 0 ? d.geometry.confidence : 'estimated',
    note:
      'Comprobación de descomposición: lo que sobra del frente tras restar las dos lentes ' +
      'y el puente son los aros exteriores y los terminales' +
      (rim > 0 ? ` (aro declarado ${rim} mm por lado).` : ' (la ficha no declara aro).') +
      (impliedRim !== null ? ` El sobrante medido implica ~${impliedRim.toFixed(1)} mm de aro por lado.` : '') +
      ' Muy por encima del rango significa que la apertura detectada es menor que la lente real.',
  };

  if (leftover === null) return base;
  return { ...base, verdict: leftover >= lo && leftover <= hi ? 'ok' : 'out-of-range' };
}

/**
 * Decides whether the file honours the glTF metre and, either way, what scale the
 * declared width implies.
 */
function assessScale(m: FrameMetrology, d: FrameDescriptor): ScaleFinding {
  const declaredWidth = interval(d.measurements.totalFrontWidth);

  if (!(m.nativeFrontWidth > 0)) {
    return {
      regime: 'unmeasurable',
      asMetresMM: null,
      impliedScale: null,
      correctionFactor: null,
      message: 'El modelo no tiene un frente medible, así que no se puede establecer su escala.',
    };
  }

  const asMetresMM = m.nativeFrontWidth * 1000;
  const band = METRIC_PLAUSIBLE_FRONT_WIDTH_MM;
  const isMetric = asMetresMM >= band.min && asMetresMM <= band.max;

  const impliedScale =
    declaredWidth !== null ? ((declaredWidth.lo + declaredWidth.hi) / 2) / m.nativeFrontWidth : null;
  const correctionFactor = impliedScale !== null ? impliedScale / 1000 : null;

  if (isMetric) {
    return {
      regime: 'metric',
      asMetresMM,
      impliedScale,
      correctionFactor,
      message:
        `El fichero respeta el metro del estándar glTF: su frente mide ${asMetresMM.toFixed(1)} mm ` +
        `leído tal cual. Las medidas de abajo son absolutas y NO dependen de la ficha, ` +
        `así que la comparación es una comprobación real.`,
    };
  }

  return {
    regime: 'arbitrary',
    asMetresMM,
    impliedScale,
    correctionFactor,
    message:
      `El fichero NO está en metros: leído tal cual, su frente mediría ${asMetresMM.toFixed(1)} mm. ` +
      `La única escala disponible es el ancho declarado por la ficha, así que las medidas en ` +
      `mm son conversiones, no comprobaciones. Fíjate en las proporciones.`,
  };
}

const CAVEAT_METRIC =
  'Las medidas en mm salen del propio fichero (metro glTF), no de la ficha: son ' +
  'independientes. Aun así, el ancho declarado se impondrá al instalar el modelo.';

const CAVEAT_ARBITRARY =
  'ADVERTENCIA DE CIRCULARIDAD: la escala de la escena procede del ancho declarado en la ' +
  'ficha, así que contrastar una medida en mm contra esa misma ficha no demuestra nada. ' +
  'Solo las proporciones (B/A, DBL/A, simetría) son evidencia aquí.';

/**
 * Compares a measured model against its declared spec sheet.
 *
 * Nothing is rejected outright: an evaluation that refuses to produce a table is far
 * less useful than one that shows exactly which rows failed and why.
 */
export function evaluateFrame(
  metrology: FrameMetrology,
  descriptor: FrameDescriptor
): FrameEvaluation {
  const scale = assessScale(metrology, descriptor);
  const reasons: string[] = [];

  // In the metric regime the model reads in millimetres on its own. Otherwise every
  // absolute figure is a conversion through the descriptor's own width.
  const independent = scale.regime === 'metric';
  const k =
    scale.regime === 'metric'
      ? 1000
      : scale.impliedScale !== null
        ? scale.impliedScale
        : null;
  const toMM = (native: number | null): number | null =>
    native === null || k === null ? null : native * k;

  const md = descriptor.measurements;
  const od = metrology.sides.od.aperture;
  const os = metrology.sides.os.aperture;
  const bothApertures = od.confidence === 'measured' && os.confidence === 'measured';

  const meanA = bothApertures ? (od.width + os.width) / 2 : null;
  const meanB = bothApertures ? (od.height + os.height) / 2 : null;

  const apertureNote = bothApertures
    ? null
    : 'No se localizó la apertura de lente en al menos un lado; ver las notas de la medición.';

  const rows: EvaluationRow[] = [
    buildRow('Ancho frontal total', toMM(metrology.nativeFrontWidth), md.totalFrontWidth, 'mm', {
      independent,
      // The published formula is 2*A + DBL, which leaves out the end-piece overhang; the
      // dataset states the real total runs 2-6 mm larger, so only the upper side is padded.
      padHi: END_PIECE_OVERHANG_MM.max,
      note:
        'La fórmula publicada (2·A + DBL) excluye el saliente de las bisagras, así que se ' +
        `admiten hasta ${END_PIECE_OVERHANG_MM.max} mm por encima del rango.`,
    }),
    buildRow('Ancho de lente (A)', toMM(meanA), md.lensWidthA, 'mm', {
      independent,
      note: apertureNote,
    }),
    buildRow('Altura de lente (B)', toMM(meanB), md.lensHeightB, 'mm', {
      independent,
      note: apertureNote,
    }),
    buildRow('Puente (DBL)', toMM(metrology.nativeBridge), md.bridgeDBL, 'mm', {
      independent,
      note: apertureNote,
    }),
    buildRow('Varilla / fondo total', toMM(metrology.nativeTotalDepth), md.templeLength, 'mm', {
      independent,
      note:
        'El fondo del modelo incluye la curvatura del terminal, así que se compara contra ' +
        'la varilla publicada solo como orden de magnitud.',
    }),
    coherenceRow(metrology, descriptor, k),
    ratioRow(
      'Proporción B/A',
      metrology.bRatio,
      md.lensHeightB,
      md.lensWidthA,
      'Sin escala: es evidencia real incluso cuando las medidas en mm no lo son.'
    ),
    ratioRow(
      'Proporción DBL/A',
      metrology.bridgeRatio,
      md.bridgeDBL,
      md.lensWidthA,
      'Sin escala: es evidencia real incluso cuando las medidas en mm no lo son.'
    ),
  ];

  // Symmetry is checked against the frame itself, so it needs neither scale nor descriptor.
  const symmetryDeltaMM =
    bothApertures && k !== null ? Math.abs(od.height - os.height) * k : null;

  if (metrology.confidence !== 'oriented') {
    reasons.push(
      'No se pudieron determinar los ejes del modelo, así que ninguna medida está anclada ' +
        'a una orientación conocida.'
    );
  }
  if (scale.regime === 'arbitrary') {
    reasons.push(
      'El modelo no está en metros: las medidas absolutas no son verificables contra su ficha.'
    );
  }
  if (!bothApertures) {
    reasons.push('No se localizaron las dos aperturas de lente.');
  }
  if (symmetryDeltaMM !== null && symmetryDeltaMM > SYMMETRY_TOLERANCE_MM) {
    reasons.push(
      `Las dos lentes difieren en altura ${symmetryDeltaMM.toFixed(1)} mm; una montura real es simétrica.`
    );
  }

  const failures = rows.filter((r) => r.verdict === 'out-of-range');
  for (const row of failures) {
    reasons.push(`«${row.label}» cae fuera del rango declarado.`);
  }

  // A model whose axes are unknown cannot support any measurement; one that merely fails
  // a dimension is suspect but still readable, and saying so is more useful than refusing.
  let overall: OverallVerdict;
  if (metrology.confidence !== 'oriented') {
    overall = 'unusable';
  } else if (failures.length > 0 || reasons.length > 0) {
    overall = 'suspect';
  } else {
    overall = 'usable';
  }

  return {
    identity: descriptor.modelName || descriptor.sku || descriptor.id || 'sin nombre',
    scale,
    rows,
    symmetryDeltaMM,
    overall,
    reasons,
    heightMeasurementAllowed: overall !== 'unusable',
    caveat: scale.regime === 'metric' ? CAVEAT_METRIC : CAVEAT_ARBITRARY,
  };
}

/** Compact one-line summary for a status area. */
export function describeEvaluation(e: FrameEvaluation): string {
  const ok = e.rows.filter((r) => r.verdict === 'ok').length;
  const bad = e.rows.filter((r) => r.verdict === 'out-of-range').length;
  const skipped = e.rows.length - ok - bad;
  const verdict =
    e.overall === 'usable' ? 'utilizable' : e.overall === 'suspect' ? 'dudoso' : 'inutilizable';
  return `${e.identity}: ${verdict} — ${ok} dentro de rango, ${bad} fuera, ${skipped} sin contrastar (${e.scale.regime}).`;
}

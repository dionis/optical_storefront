/**
 * Optical fitting heights derived from the frame's own spec sheet, per the client's
 * specification:
 *
 *     Monofocal   = B / 2
 *     Bifocal     = (B / 2) - 5
 *     Progressive = B - 11
 *
 * These sit ALONGSIDE the MediaPipe-derived fitting height, never replacing it. The two
 * disagree, and the disagreement is the point: one is read off the patient's face, the
 * other off the frame's published dimensions, and an optician is entitled to see both
 * before deciding which to trust.
 *
 * THE REFERENCE EDGE — a correction to the specification.
 * The specification states that all heights are measured from the TOP edge of the lens.
 * Taken literally the three formulas contradict each other and contradict the
 * specification's own prose:
 *
 *   - It says the bifocal height is "5 mm below the geometric center", yet (B/2) - 5
 *     measured from the top lands 5 mm ABOVE the centre.
 *   - A bifocal segment top belongs at the lower lid, below the pupil; a progressive
 *     fitting cross belongs at the pupil, above the centre. Measured from the top, the
 *     formulas invert both.
 *
 * Read from the BOTTOM edge every formula becomes coherent: B/2 is the centre,
 * (B/2) - 5 is 5 mm below it, and B - 11 sits above it. The rule `B - 11 >= 18` then
 * reproduces the usual "this lens is too shallow for a standard progressive" threshold,
 * which is also what `FITTING_CONFIG.plausibleRange.minMM` encodes.
 *
 * So this module measures from the BOTTOM, and says so on screen. It is the same edge
 * `frame_fitter` and `optical_calculator` already use, which is what makes the two
 * readings comparable at all.
 */

import type { FrameDescriptor } from './frame_descriptor';

/** Where B came from, in decreasing order of authority. */
export type BSource =
  /** Measured on the lens opening of the model on screen. */
  | 'measured'
  /** `measurements_mm.lens_height_b.nominal` from the spec sheet. */
  | 'catalog'
  /**
   * The specification's mandatory fallback: B = A when no lens height is published.
   * Geometrically crude — dc384 publishes A 48-50 against B 31-40, so the substitution
   * overstates the height by roughly a third on that frame alone — so it is reported
   * loudly rather than folded in silently.
   */
  | 'fallback-a'
  | 'none';

/** Minimum corridor a standard progressive needs, in mm. Matches plausibleRange.minMM. */
const STANDARD_PAL_MINIMUM_MM = 18;

export interface HeightSet {
  /** The B the three figures were computed from, in mm. */
  bMM: number;
  bSource: BSource;
  monofocalMM: number;
  bifocalMM: number;
  progressiveMM: number;
  /** True when the progressive height falls below what a standard PAL needs. */
  progressiveTooShallow: boolean;
}

export interface OpticalHeightsReport {
  /** Frame identity, for the panel header. */
  identity: string;
  /** A as published, in mm. Null when the sheet declares none. */
  lensWidthAMM: number | null;
  /** Heights from the spec sheet's own B. Null when neither B nor A is published. */
  fromCatalog: HeightSet | null;
  /** Heights from the opening measured on the installed model. Null with no model. */
  fromMeasured: HeightSet | null;
  /** Operator-facing notes: fallbacks applied, coarse buckets, shallow lenses. */
  notes: string[];
}

function round1(value: number): number {
  return parseFloat(value.toFixed(1));
}

/** Applies the three formulas to one B. */
function heightsFor(bMM: number, bSource: BSource): HeightSet {
  const progressiveMM = round1(bMM - 11);
  return {
    bMM: round1(bMM),
    bSource,
    monofocalMM: round1(bMM / 2),
    bifocalMM: round1(bMM / 2 - 5),
    progressiveMM,
    progressiveTooShallow: progressiveMM < STANDARD_PAL_MINIMUM_MM,
  };
}

/**
 * Builds both columns: what the spec sheet says, and what the model on screen measures.
 *
 * They are kept apart on purpose. Collapsing them into one "best" figure would hide the
 * two things worth seeing — that the published B is a coarse bucket, and that the mesh
 * may not honour it.
 */
export function computeOpticalHeights(
  descriptor: FrameDescriptor,
  measuredBMM: number | null
): OpticalHeightsReport {
  const notes: string[] = [];
  const a = descriptor.measurements.lensWidthA;
  const b = descriptor.measurements.lensHeightB;

  const aNominal = a.nominal ?? null;
  const bNominal = b.nominal ?? null;

  let fromCatalog: HeightSet | null = null;
  if (bNominal !== null) {
    fromCatalog = heightsFor(bNominal, 'catalog');
    if (b.note) {
      notes.push(`B publicada es un valor grueso del proveedor: ${b.note}`);
    } else if (b.min !== null && b.max !== null && b.max - b.min >= 5) {
      notes.push(
        `B publicada es un rango amplio (${b.min}–${b.max} mm): las tres alturas heredan ` +
          `esa holgura, hasta ±${round1((b.max - b.min) / 2)} mm.`
      );
    }
  } else if (aNominal !== null) {
    // The specification makes this substitution mandatory. It is also wrong for most
    // frames, so it never passes silently.
    fromCatalog = heightsFor(aNominal, 'fallback-a');
    notes.push(
      `Respaldo aplicado: la ficha no publica B, así que se usó B = A = ${aNominal} mm. ` +
        `Una lente rara vez es tan alta como ancha, así que estas tres alturas están ` +
        `probablemente sobrestimadas.`
    );
  } else {
    notes.push('La ficha no publica ni B ni A: no hay alturas que calcular desde ella.');
  }

  const fromMeasured = measuredBMM !== null ? heightsFor(measuredBMM, 'measured') : null;
  if (fromMeasured === null) {
    notes.push('Sin apertura legible en el modelo: solo hay la columna de la ficha.');
  }

  for (const set of [fromCatalog, fromMeasured]) {
    if (set?.progressiveTooShallow) {
      const label = set.bSource === 'measured' ? 'la malla' : 'la ficha';
      notes.push(
        `Con la B de ${label} (${set.bMM} mm) el progresivo sale ${set.progressiveMM} mm, ` +
          `bajo el mínimo de ${STANDARD_PAL_MINIMUM_MM} mm de un progresivo estándar.`
      );
    }
  }

  // Worth surfacing: it is the single number that says whether the mesh honours the sheet.
  if (fromCatalog && fromMeasured && fromCatalog.bSource !== 'fallback-a') {
    const delta = round1(Math.abs(fromCatalog.bMM - fromMeasured.bMM));
    if (delta >= 2) {
      notes.push(
        `La B de la ficha (${fromCatalog.bMM} mm) y la medida en la malla ` +
          `(${fromMeasured.bMM} mm) difieren ${delta} mm; las dos columnas divergen por eso.`
      );
    }
  }

  return {
    identity: descriptor.modelName || descriptor.sku || descriptor.id || 'sin nombre',
    lensWidthAMM: aNominal,
    fromCatalog,
    fromMeasured,
    notes,
  };
}

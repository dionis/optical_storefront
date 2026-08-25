/**
 * Reads the fitting height off the frame ACTUALLY ON SCREEN, instead of computing it
 * from a published B measurement the model may not honour.
 *
 * WHAT THIS DOES AND DOES NOT FIX — read before trusting the number.
 *
 * It does NOT remove `pupilHeightRatio`. `frame_fitter` positions the frame by that same
 * constant (`frontCentreY = -(ratio - 0.5) * frontHeight`), so the lower rim lands at
 * `ratio x frontHeight` below the pupil line BY CONSTRUCTION. Measuring it back gives the
 * ratio again. The assumption moved from the arithmetic into the placement; it did not
 * disappear, and only the operator's own vertical adjustment moves the figure off it.
 *
 * What it does fix is worth having anyway:
 *
 *  1. CONSISTENCY. Today the panel reports `ratio x B` using the DESCRIPTOR's aperture
 *     height, while the fitter places the frame using `ratio x frontHeight`, the model's
 *     OUTER height. Two different quantities behind one ratio. On the sample model the
 *     panel says 25.0 mm while the rendered lens groove sits 17.1 mm below the pupil
 *     line — a 7.9 mm disagreement between the figure handed to an optician and the frame
 *     the patient is looking at. Reading the height off the placed model closes that by
 *     construction: the number describes what is rendered.
 *
 *  2. TWO HEIGHTS, BOTH MEASURED. The lowest point of the rim and the bottom of the lens
 *     opening are different places on the frame — 4.5 mm apart on the sample model — and
 *     the printed optician's report distinguishes them. Neither comes from a ratio: they
 *     are read off the geometry.
 *
 *  3. A REAL B. The aperture height is measured from the mesh rather than taken from the
 *     supplier's coarse bucket ("41-50 mm"), which carries +-4.5 mm of slack.
 *
 *  4. THE OPERATOR'S ADJUSTMENT COUNTS. Once the frame is dragged to where it really
 *     sits, the height follows. That is how a fitting is measured in a consulting room —
 *     and it is why the adjustment state travels with the figure.
 */

import * as THREE from 'three';
import { measureFrame, type FrameMetrology } from './frame_metrology';

/**
 * Lens opening height (boxing B) measured on the installed frame, in mm, or null when no
 * aperture could be found.
 *
 * This is the figure that closes the real gap in the reported fitting height. The panel
 * derives that height from B, and with no SKU publishing one, every frame falls back to
 * `defaultLensHeightBMM` (45.5) — so the height reported to the optician is the same
 * constant no matter which frame the patient is wearing. On the sample model the true
 * opening is 29.9 mm, and the 15.6 mm difference accounts for 8.6 mm of reported height:
 * far more than any refinement of the ratio itself is worth.
 *
 * Both sides are averaged: a frame is symmetric, so a left/right split here is mesh
 * noise rather than anatomy, and the per-eye difference the report needs comes from the
 * face, not from the frame.
 */
export function measureLensHeightB(eyewearRoot: THREE.Object3D): number | null {
  const m = measureFrame(eyewearRoot);
  if (m.confidence !== 'oriented') return null;

  const od = m.sides.od.aperture;
  const os = m.sides.os.aperture;
  if (od.confidence !== 'measured' || os.confidence !== 'measured') return null;

  const meanMM = ((od.height + os.height) / 2) * 1000;
  return meanMM > 0 ? parseFloat(meanMM.toFixed(1)) : null;
}

/** Vertical adjustment state the figures were taken under. Without it they are unrepeatable. */
export interface HeightAdjustmentState {
  yOffsetMM: number;
  zOffsetMM: number;
  scale: number;
  templeWidth: number;
}

export interface MeasuredHeightSide {
  /** Pupil line to the lowest point of the frame material, in mm. */
  rimHeightMM: number;
  /** Pupil line to the bottom of the lens opening — the boxing corridor height, in mm. */
  corridorHeightMM: number | null;
  /** Material between the two, i.e. the lower rim. Null when no aperture was found. */
  lowerRimMM: number | null;
  /** Aperture height measured on the mesh, in mm. Null when no aperture was found. */
  measuredBMM: number | null;
}

export interface MeasuredFittingHeight {
  available: boolean;
  od: MeasuredHeightSide | null;
  os: MeasuredHeightSide | null;
  adjustments: HeightAdjustmentState;
  /** Everything the operator must know to read the figures correctly. */
  notes: string[];
  /** The standing caveat about `pupilHeightRatio`, for the panel to print verbatim. */
  provenance: string;
}

const PROVENANCE =
  'Altura leída sobre la montura colocada, no calculada a partir de la B publicada. ' +
  'Aun así, la posición vertical en reposo la fija pupilHeightRatio (fitting_config.ts): ' +
  'sin ajuste manual del operador, la altura al marco inferior es esa razón por la altura ' +
  'del frente. Lo que sí está medido en la malla es la separación entre el marco inferior ' +
  'y el corredor, y la altura de la apertura.';

const UNAVAILABLE: MeasuredFittingHeight = {
  available: false,
  od: null,
  os: null,
  adjustments: { yOffsetMM: 0, zOffsetMM: 0, scale: 1, templeWidth: 1 },
  notes: [],
  provenance: PROVENANCE,
};

/**
 * Measures both heights, per eye, on the installed frame.
 *
 * `eyewearRoot` must be the group the frame is anchored in — `SceneManager.vtoGroup` —
 * whose origin is the pupil midpoint. Everything is expressed in that group's LOCAL
 * space, which is real metres: the group's own scale converts metres to screen units, so
 * reading locally sidesteps it and no unit bookkeeping is needed.
 *
 * `gate` is the evaluation's `heightMeasurementAllowed`. A model whose axes could not be
 * established has no "down", so a height measured on it would be a number with no meaning
 * that nonetheless looks measured — worse than the heuristic it replaces.
 */
export function measureFittingHeight(
  eyewearRoot: THREE.Object3D,
  adjustments: HeightAdjustmentState,
  gate: boolean
): MeasuredFittingHeight {
  if (!gate) {
    return {
      ...UNAVAILABLE,
      adjustments,
      notes: ['La evaluación del modelo no permite medir alturas sobre él.'],
    };
  }

  const m: FrameMetrology = measureFrame(eyewearRoot);
  if (m.confidence !== 'oriented') {
    return {
      ...UNAVAILABLE,
      adjustments,
      notes: [
        'No se pudieron establecer los ejes de la montura colocada, así que no hay un ' +
          '«abajo» contra el que medir.',
        ...m.notes,
      ],
    };
  }

  const notes: string[] = [];
  const toMM = (v: number) => parseFloat((v * 1000).toFixed(1));

  const side = (s: FrameMetrology['sides']['od']): MeasuredHeightSide => {
    const measured = s.aperture.confidence === 'measured';
    return {
      // y = 0 is the pupil line and the rim is below it, so the height is the negated Y.
      rimHeightMM: toMM(-s.rimBottomY),
      corridorHeightMM: measured ? toMM(-s.aperture.apertureBottomY) : null,
      lowerRimMM: measured ? toMM(s.aperture.apertureBottomY - s.rimBottomY) : null,
      measuredBMM: measured ? toMM(s.aperture.height) : null,
    };
  };

  const od = side(m.sides.od);
  const os = side(m.sides.os);

  if (od.corridorHeightMM === null || os.corridorHeightMM === null) {
    notes.push(
      'No se localizó la apertura de lente en al menos un lado: solo hay altura al marco ' +
        'inferior, no altura de corredor.'
    );
  }

  // A frame is symmetric, so a split here is a defect in the mesh, not facial asymmetry —
  // the per-eye difference that belongs in a report comes from the face, not the frame.
  const spread = Math.abs(od.rimHeightMM - os.rimHeightMM);
  if (spread > 1.0) {
    notes.push(
      `Los dos lados de la montura difieren ${spread.toFixed(1)} mm en altura; una montura ` +
        'real es simétrica, así que la diferencia es de la malla.'
    );
  }

  if (adjustments.yOffsetMM !== 0) {
    notes.push(
      `Incluye el ajuste vertical del operador (${adjustments.yOffsetMM > 0 ? '+' : ''}` +
        `${adjustments.yOffsetMM} mm), que forma parte de la medida.`
    );
  } else {
    notes.push(
      'Sin ajuste vertical del operador: la montura está en su posición de reposo, que ' +
        'fija pupilHeightRatio.'
    );
  }

  return { available: true, od, os, adjustments, notes, provenance: PROVENANCE };
}

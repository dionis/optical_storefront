/**
 * Tunable constants behind the vertical (fitting height) calculation.
 *
 * IMPORTANT: every value in this file is a MODELLING ASSUMPTION, not a measured
 * constant. They are collected here — instead of being inlined in the maths — so an
 * optician or optometrist can review and adjust them without reading the algorithm.
 *
 * Reference definitions used throughout:
 *  - Fitting height: vertical distance from the pupil centre down to the LOWEST point
 *    of the frame's lens groove, measured with the patient WEARING the chosen frame.
 *  - B measurement (boxing system, ISO 8624): vertical height of the lens opening.
 *
 * Full rationale, the error budget, the empirical measurements behind each default and
 * the open questions for the specialists:
 * https://claude.ai/code/artifact/673f39af-8ff5-43b7-a3ff-a3fb3ca7b30f
 */

/** Which model produces the fitting height. */
export type FittingHeightMode = 'frame-geometry' | 'anatomical-proxy';

/** How a normalized-Y delta is converted to the physical scale of normalized-X. */
export type VerticalScaleMode = 'auto-aspect' | 'fixed';

/** Reference axis used to split the fitting height between the two eyes. */
export type PerEyeReference = 'ear-line' | 'image-vertical' | 'none';

export interface FittingConfig {
  pdReferenceMM: number;
  pdOffsetMM: number;
  verticalScaleMode: VerticalScaleMode;
  fixedVerticalScale: number;
  mode: FittingHeightMode;
  frameGeometry: {
    defaultLensHeightBMM: number;
    pupilHeightRatio: number;
    perEyeReference: PerEyeReference;
  };
  anatomicalProxy: {
    lidExtrapolationFactor: number;
  };
  plausibleRange: {
    minMM: number;
    maxMM: number;
  };
  designMinimaMM: Record<string, number>;
  pantoscopicDegPerNormUnit: number;
  cardCalibration: {
    cardWidthMM: number;
    cardHeightMM: number;
    apparentWidthRangePx: { min: number; max: number };
    scaleFactorRange: { min: number; max: number };
    faceGapRatio: number;
    impliedPdAcceptedMM: { min: number; max: number };
  };
  captureDistance: {
    method: DistanceMethod;
    mediapipeUnitToMM: number;
    assumedHorizontalFovDeg: number;
    recommendedRangeMM: { min: number; max: number };
  };
  vtoPlacement: {
    frontPlaneAheadOfPupilMM: number;
    minPlausiblePdMM: number;
    maxPlausiblePdMM: number;
    cameraHFovBandDeg: { min: number; max: number };
    templeRestAboveEarLandmarkMM: number;
    pantoscopicRangeDeg: { min: number; max: number };
  };
}

/** How the subject-to-camera distance is estimated. */
export type DistanceMethod = 'mediapipe-transform' | 'pinhole-fov';

export const FITTING_CONFIG: FittingConfig = {
  /**
   * Assumed adult binocular PD, used to convert normalized landmark units into
   * millimetres whenever no external calibration is supplied.
   * Default 63.0 · plausible 58-68 · TO REVIEW: should this vary by gender/age bucket?
   */
  pdReferenceMM: 63.0,

  /**
   * Offset added to the BINOCULAR pupillary distance before it is reported, in mm.
   *
   * Requested by the client. It is a correction applied on top of the reading, not a
   * property of the patient, so it is kept apart from the measurement in every way that
   * matters: it is added AFTER the plausibility clamp, it never touches the card
   * calibration's sanity gate, and the figure travels into the exported report as
   * `pupillaryDistance.appliedOffsetMM` so an optician always sees that the number in
   * front of them is not raw.
   *
   * The value is BINOCULAR. Each monocular PD receives half of it, which is what keeps
   * pdRight + pdLeft = pdTotal — the same coherence rule the multimodal schema enforces
   * (services/vision_measure/schema.py). If the intent was ever "1.5 mm per eye", set
   * this to 3.0 rather than changing the split.
   *
   * Set to 0 to report the measurement untouched.
   */
  pdOffsetMM: 1.5,

  /**
   * MediaPipe normalizes X by image width and Y by image height. A vertical delta must
   * therefore be multiplied by (height/width) before the PD-derived mm-per-unit scale
   * — which was derived from a horizontal distance — can be applied to it.
   *
   * 'auto-aspect' reads the live camera resolution (correct at any aspect ratio).
   * 'fixed'       uses fixedVerticalScale below (legacy behaviour).
   */
  verticalScaleMode: 'auto-aspect',

  /**
   * Legacy vertical scale. 0.75 is exactly 480/640, i.e. correct ONLY for a 4:3 camera.
   * On the 16:9 (1280x720) webcam this project was tested with, the correct value is
   * 0.5625, so the legacy constant inflated every vertical measurement by 1.333x.
   */
  fixedVerticalScale: 0.75,

  /**
   * 'frame-geometry'  derives the height from the frame's B measurement — this matches
   *                   the clinical definition, which is frame-dependent.
   * 'anatomical-proxy' derives it from the lower eyelid margin. Kept for comparison and
   *                   for frames with no published B; see the review document for why it
   *                   systematically under-reads (it measures the wrong anatomy).
   */
  mode: 'frame-geometry',

  frameGeometry: {
    /**
     * Fallback lens height B (mm) used when the reference specs publish none.
     * Default 45.5 = nominal of the DC186 entry in glass_reference.json.
     * TO REVIEW: a per-SKU B is always preferable; this fallback only avoids a crash.
     */
    defaultLensHeightBMM: 45.5,

    /**
     * Fraction of the B measurement that sits ABOVE the bottom groove at pupil level:
     *     fittingHeight = pupilHeightRatio x B
     * It places the pupil above the vertical centre of the lens, which is how a frame
     * sits on an adult face, and it is what the 3D try-on positions the frame with.
     *
     * RAISED FROM 0.55 to 0.65. Two reasons, and the first is a contradiction inside this
     * very file: on the sample frame B measures 29.5 mm, so 0.55 yields a 16.2 mm fitting
     * height — BELOW `plausibleRange.minMM` of 18 below. The panel therefore clamped the
     * figure to 18 and flagged it provisional while the frame was drawn at 16.2, so the
     * picture and the number handed to the optician disagreed. 0.65 gives 19.2 mm, inside
     * the range, and the two now agree by construction. The second reason is simply that
     * the frame read as sitting too high; this lowers it 2.2 mm on the sample frame.
     *
     * Default 0.65 · plausible 0.55-0.70 · STILL NOT VALIDATED against manual
     * measurements. It remains the single most influential constant in the vertical chain
     * and the first thing the specialists should calibrate — with a real fitting height
     * measured on a patient wearing their own frame, which settles it in one reading.
     */
    pupilHeightRatio: 0.65,

    /**
     * How the height is split between OD and OS.
     *
     * 'ear-line'       measures each pupil's perpendicular offset from the ear-to-ear
     *                  axis. Because the temples rest on the ears, that axis rotates with
     *                  the head, so the split stays stable when the patient tilts and
     *                  reflects genuine facial asymmetry only. THIS IS THE DEFAULT.
     * 'image-vertical' uses the raw image Y difference between pupils. Simple, but head
     *                  roll leaks straight into the result — a 10 deg tilt produced an 8 mm
     *                  OD/OS spread in testing, which is not anatomical.
     * 'none'           both eyes share the same height. Use when only a binocular figure
     *                  is wanted.
     *
     * TO REVIEW: is a monocular fitting height even expected from a VTO, or should the
     * report carry one binocular value plus a measured asymmetry flag?
     */
    perEyeReference: 'ear-line',
  },

  anatomicalProxy: {
    /**
     * How far below the lower eyelid margin the groove is assumed to sit, expressed as a
     * multiple of the pupil-to-eyelid gap:
     *     fittingHeight = (1 + lidExtrapolationFactor) x pupilToLowerLidGap
     * Default 1.5 (i.e. an effective 2.5x multiplier) — the value inherited from the
     * original implementation. It has no published basis.
     */
    lidExtrapolationFactor: 1.5,
  },

  /**
   * Values outside this band are clamped and flagged as provisional rather than shown as
   * readings. Default 18-35 mm covers standard progressive fitting heights.
   * TO REVIEW: widen the floor to 14 if short-corridor designs are to be supported.
   */
  plausibleRange: {
    minMM: 18,
    maxMM: 35,
  },

  /**
   * Reference minimum fitting heights per lens design, in mm. Informational only today —
   * nothing consumes them yet. They are the natural basis for a future "this frame is too
   * shallow for the prescribed design" warning.
   */
  designMinimaMM: {
    singleVision: 0,
    shortCorridorPAL: 14,
    standardPAL: 18,
  },

  /**
   * Degrees of pantoscopic tilt per normalized-Y unit of ear-to-eye offset.
   * Default 80 · UNVALIDATED: this is a bare linear fudge factor with no geometric
   * derivation. Flagged for the specialists; see the review document.
   */
  pantoscopicDegPerNormUnit: 80,

  cardCalibration: {
    /**
     * ISO/IEC 7810 ID-1 nominal dimensions. This is the metric ground truth of the whole
     * system and it is NEVER adjustable — the operator never edits these numbers.
     *
     * What the operator does adjust is a different quantity entirely: how many PIXELS the
     * card spans in the image. That is the unknown being measured, and it changes with
     * distance, focal length and resolution. The calibration is simply
     *     mm per pixel = cardWidthMM / apparentWidthPx
     * where the numerator is this constant and the denominator is the measurement.
     */
    cardWidthMM: 85.60,
    cardHeightMM: 53.98,

    /**
     * Bounds for the measured apparent width, in canvas pixels. Wide enough to cover any
     * working distance and resolution; narrow enough to stop an accidental drag producing
     * an absurd scale.
     */
    apparentWidthRangePx: { min: 60, max: 620 },

    /**
     * Bounds for the operator's correction to the face-derived prediction, expressed as
     * a ratio because that is how the correction is stored: the card is held at the
     * plane of the eyes, so it scales with the face and the correction does not depend
     * on the working distance. 1.0 means "exactly where the PD estimate predicted".
     * The band allows a wrong-by-a-third estimate to be marked out, and nothing wilder.
     */
    scaleFactorRange: { min: 0.4, max: 2.5 },

    /**
     * Vertical gap between the subnasal point and the top edge of the guide, as a
     * fraction of the card height. Proportional, not a pixel constant, so the card
     * hugs the face just as closely whether the subject is near or far.
     */
    faceGapRatio: 0.08,

    /**
     * Automatic plausibility gate. Once the scale is known, the patient's PD follows from
     * it; if that implied PD lands outside adult and paediatric range, the marking is
     * wrong (usually the card was not held in the plane of the eyes) and the calibration
     * is rejected rather than silently poisoning every figure in the report.
     * TO REVIEW: confirm the band with the specialists.
     */
    impliedPdAcceptedMM: { min: 50, max: 78 },
  },

  captureDistance: {
    /**
     * 'pinhole-fov'         solves the distance from the apparent scale and an assumed
     *                       field of view. Only as good as assumedHorizontalFovDeg below,
     *                       but self-consistent: deriving the field back out of the
     *                       distance returns the same angle, so the virtual camera can
     *                       never disagree with the distance it was built from. DEFAULT.
     *
     * 'mediapipe-transform' reads the translation of the facial transformation matrix.
     *                       It looks like the model's own metric output, but the unit is
     *                       NOT portable: the same subject at roughly half a metre gave a
     *                       Z of 46.55 on a desktop webcam and 0.25 on a Galaxy S25 Plus,
     *                       a factor of 186. mediapipeUnitToMM was calibrated from a
     *                       single desktop sample and does not generalise, so on the phone
     *                       the capture read 2.5 cm, the field of view was pushed out of
     *                       its band, and the frame ended up drawn 5x oversized 11 cm in
     *                       front of the camera. Needs a per-device unit before it can be
     *                       trusted again.
     */
    method: 'pinhole-fov',

    /**
     * The transformation matrix translation is expressed in centimetres, so it is scaled
     * by 10 to reach millimetres. Measured Z was -46.55 for a subject at roughly half a
     * metre, which is what fixes the unit.
     */
    mediapipeUnitToMM: 10,

    /**
     * Horizontal field of view assumed by the 'pinhole-fov' method. Webcams vary between
     * roughly 55 and 90 degrees and almost none publish the figure, which is why this
     * method is not the default.
     * TO REVIEW: measure it once per clinic device and pin the real value.
     */
    assumedHorizontalFovDeg: 60,

    /**
     * Working distance band considered adequate for capture. Outside it the reading is
     * flagged: too close exaggerates perspective, too far starves the tracker of pixels.
     * TO REVIEW: confirm the band the specialists want to enforce.
     */
    recommendedRangeMM: { min: 400, max: 700 },
  },

  /**
   * Where the 3D frame is put in the live try-on. These are the only numbers that decide
   * whether a loaded GLB looks like it is being worn or like it is floating near the head;
   * everything else about the placement is measured from the patient or from the model.
   */
  vtoPlacement: {
    /**
     * How far in front of the pupil plane the frontmost point of the frame sits, in mm.
     * This is the vertex distance (cornea to the back of the lens, clinically 12-14 mm)
     * plus the thickness of the lens and rim in front of it.
     * Default 15 · plausible 10-20 · TO REVIEW with the specialists.
     */
    frontPlaneAheadOfPupilMM: 15,

    /**
     * Band the PD used for sizing the frame must fall inside. The frame is drawn at its
     * true physical width relative to the measured PD, so a momentarily absurd PD — the
     * tracker losing an iris for a frame or two — would otherwise make the frame jump to
     * an absurd size. Outside the band the previous good value is kept.
     */
    minPlausiblePdMM: 45,
    maxPlausiblePdMM: 85,

    /**
     * Band the measured camera field of view must fall inside before the 3D scene will
     * adopt it. Webcams and phone front cameras run roughly 55-80 degrees horizontally;
     * anything outside this band means the distance or the scale behind it is wrong, and
     * `captureDistance.assumedHorizontalFovDeg` is used instead.
     *
     * This is the number that decides how much the temples converge as they run back to
     * the ears. It changes NOTHING in the plane of the lenses — the front of the frame is
     * placed from the landmarks either way — so a wrong value looks like a well-fitted
     * frame whose arms miss the ears, which is exactly how it was found.
     */
    cameraHFovBandDeg: { min: 40, max: 100 },

    /**
     * How far ABOVE the ear landmark the temple actually comes to rest, in mm.
     *
     * MediaPipe's ear landmarks (234 / 454) sit on the face contour beside the ear canal,
     * roughly at tragion height. A temple does not rest there — it rests higher, where the
     * top of the ear meets the scalp. This is the gap between the two.
     * Default 15 · plausible 10-22 · TO REVIEW: measure it on a few patients wearing their
     * own frames; it sets how high or low the whole frame ends up sitting.
     */
    templeRestAboveEarLandmarkMM: 15,

    /**
     * Bounds on the pantoscopic tilt the try-on will apply, in degrees.
     *
     * Real frames are dispensed between roughly 4 and 14 degrees; the band is opened a
     * little wider on both sides to leave room for genuine facial variation, and closed
     * hard enough that a bad ear landmark cannot cartwheel the frame off the face.
     * Negative tilt (retroscopic) is real but rare, hence the small negative floor.
     */
    pantoscopicRangeDeg: { min: -4, max: 20 },
  },
};

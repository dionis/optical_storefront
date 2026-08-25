import { FITTING_CONFIG, FittingHeightMode, DistanceMethod } from './fitting_config';
import { t } from './i18n';

export interface OpticalMeasurements {
  patientId: string;
  timestamp: string;
  unit: string;
  pupillaryDistance: {
    pdTotal: number;
    pdRight: number;
    pdLeft: number;
    /**
     * Binocular offset added to the measurement before reporting (FITTING_CONFIG.pdOffsetMM).
     * Recorded so the report never presents an adjusted figure as a raw reading.
     */
    appliedOffsetMM: number;
  };
  fittingHeight: {
    heightRight: number;
    heightLeft: number;
    /** Which model produced the figures — they are not interchangeable. */
    source: FittingHeightMode;
    /** Frame B measurement the frame-geometry model was fed, when available. */
    lensHeightBMM: number | null;
    /**
     * 'measured' the B was measured on the 3D model actually on screen. Strongest, and
     *            the only source that is specific to the mesh being rendered.
     * 'catalog'  the B came from the selected frame's published specs — a coarse bucket
     *            in practice ("41-50 mm"), so it carries several mm of slack.
     * 'fallback' the frame publishes no B, so a stand-in was used and the height is NOT
     *            specific to the frame being tried on.
     */
    lensHeightSource: 'measured' | 'catalog' | 'fallback';
    note: string;
  };
  /**
   * Flags the figures that fell outside the plausible clinical range and were clamped
   * to a boundary. They are shown as provisional (~) instead of passing for a reading.
   */
  outOfRange: {
    pdRight: boolean;
    pdLeft: boolean;
    heightRight: boolean;
    heightLeft: boolean;
  };
  creditCardCalibration?: {
    active: boolean;
    /** ISO/IEC 7810 ID-1. Constant — never edited by anyone. */
    standardCardWidthMM: number;
    /** The measured quantity: how many pixels those 85.60 mm span in the image. */
    apparentWidthPx: number | null;
    /** Millimetres per normalized image unit that the marking yields. */
    scaleMMPerNormUnit: number | null;
    calibratedScaleRatio: number;
    /** PD the calibration implies. The automatic sanity check runs against this. */
    impliedPdMM: number | null;
    accepted: boolean;
    precisionStatus: string;
  };
  /**
   * Subject-to-camera distance at the moment of capture. Recorded because every
   * millimetre figure in this report is scale-dependent, so the optician needs to know
   * the geometry the capture was taken under.
   */
  captureDistance: {
    millimetres: number | null;
    centimetres: number | null;
    method: DistanceMethod;
    withinRecommendedRange: boolean;
    recommendedRangeMM: { min: number; max: number };
    note: string;
  };
  frameGeometry: {
    lensWidth: number;
    bridgeWidth: number;
    templeLength: number;
    calculatedTotalWidth: number;
    skuName?: string;
  };
  ergonomicsAndEarFit: {
    headWidthMM: number;
    templeReachDepthMM: number;
    pantoscopicTiltDeg: number;
    earAlignmentRatio: number;
    fitStatus: string;
  };
}

export class OpticalCalculator {
  private currentMeasurements: OpticalMeasurements;
  public customScaleMMPerNorm: number | null = null;
  /** Apparent card width in canvas pixels, recorded for traceability in the report. */
  public cardApparentWidthPx: number | null = null;

  /**
   * Millimetres per normalized landmark unit as resolved on the last frame — the card
   * calibration when one was accepted, the reference-PD estimate otherwise. Read by the
   * 3D try-on so the frame is drawn at the same physical scale this panel reports, rather
   * than at a scale of its own that could disagree with the numbers beside it.
   */
  public resolvedScaleMMPerNorm: number | null = null;

  /**
   * Horizontal field of view of the capture in degrees, measured from the distance and the
   * scale on the last frame; null when the tracker gave no usable distance. The 3D try-on
   * matches its virtual camera to this so the frame is foreshortened exactly as the face
   * in the video was.
   */
  public resolvedCameraHFovDeg: number | null = null;

  /**
   * Subject-to-camera distance in mm as resolved on the last frame. Read by the 3D try-on,
   * which places the face at exactly this depth so the frame's apparent size follows the
   * patient instead of a heuristic.
   */
  public resolvedDistanceMM: number | null = null;

  // Temporal smoothing state: raw landmark noise makes every value jitter frame to
  // frame, which reads as unreliable on a clinical panel.
  private static readonly EMA_ALPHA = 0.18;
  private emaState: Record<string, number> = {};
  private shownState: Record<string, number> = {};

  // Live camera resolution, needed to convert normalized-Y into the physical scale of
  // normalized-X. Zero until the webcam reports its dimensions.
  private imageWidth = 0;
  private imageHeight = 0;

  /** Feeds the live camera resolution used by the 'auto-aspect' vertical scale. */
  public setImageSize(width: number, height: number): void {
    if (width > 0 && height > 0) {
      this.imageWidth = width;
      this.imageHeight = height;
    }
  }

  /**
   * Factor converting a normalized-Y delta into the same physical scale as normalized-X.
   * MediaPipe normalizes Y by image height and X by image width, so the two axes are not
   * directly comparable until this correction is applied.
   */
  private verticalScale(): number {
    if (FITTING_CONFIG.verticalScaleMode === 'auto-aspect' && this.imageWidth > 0) {
      return this.imageHeight / this.imageWidth;
    }
    return FITTING_CONFIG.fixedVerticalScale;
  }

  constructor() {
    this.currentMeasurements = this.getDefaultMeasurements();
  }

  /**
   * Exponential moving average plus a dead band on the displayed value.
   * The EMA kills high-frequency jitter; the dead band stops the rounded figure
   * flipping between two neighbouring steps (e.g. PD TOTAL oscillating 62 <-> 63 mm).
   */
  private smooth(key: string, raw: number, step: number = 1): number {
    const prev = this.emaState[key];
    const value = prev === undefined ? raw : prev + (raw - prev) * OpticalCalculator.EMA_ALPHA;
    this.emaState[key] = value;

    const shown = this.shownState[key];
    if (shown === undefined || Math.abs(value - shown) >= step * 0.6) {
      this.shownState[key] = parseFloat((Math.round(value / step) * step).toFixed(2));
    }
    return this.shownState[key];
  }

  /**
   * Per-eye deviation from the mean fitting height, in mm, one value per eye summing to
   * zero. Measured perpendicular to the ear-to-ear axis, which rotates with the head, so
   * head roll does not leak into the OD/OS split — only genuine facial asymmetry does.
   */
  private perEyeOffsetsMM(
    rightPupil: any, leftPupil: any,
    rightEar: any, leftEar: any,
    mmPerNormUnit: number, vScale: number
  ): [number, number] {
    const ref = FITTING_CONFIG.frameGeometry.perEyeReference;
    if (ref === 'none') return [0, 0];

    // Map into a common physical space: X and Y are normalized against different image
    // dimensions, so Y needs the aspect correction before the two can be mixed.
    const toMM = (p: any) => ({
      x: p.x * mmPerNormUnit,
      y: p.y * mmPerNormUnit * vScale,
    });

    const pR = toMM(rightPupil);
    const pL = toMM(leftPupil);

    let devR: number;
    let devL: number;

    if (ref === 'ear-line' && rightEar && leftEar) {
      const eR = toMM(rightEar);
      const eL = toMM(leftEar);
      const ax = eL.x - eR.x;
      const ay = eL.y - eR.y;
      const len = Math.hypot(ax, ay);
      if (len < 1e-6) return [0, 0];

      // Signed perpendicular distance from the ear axis; positive means higher on the face
      const perp = (p: { x: number; y: number }) =>
        -((ax * (p.y - eR.y) - ay * (p.x - eR.x)) / len);

      devR = perp(pR);
      devL = perp(pL);
    } else {
      // 'image-vertical' fallback: raw image Y, roll and all
      devR = -pR.y;
      devL = -pL.y;
    }

    const mean = (devR + devL) / 2;
    return [devR - mean, devL - mean];
  }

  /**
   * Subject-to-camera distance in mm.
   *
   * 'mediapipe-transform' uses the translation of the facial transformation matrix the
   * tracker already emits — a model output rather than a constant chosen here. Its Z is
   * in centimetres.
   *
   * 'pinhole-fov' solves it from the apparent size instead: with a pinhole camera the
   * scale in mm-per-pixel at the subject plane and the focal length in pixels give
   * distance directly, and the image width cancels out, leaving
   *     distance = mmPerNormUnit / (2 x tan(fov / 2))
   */
  private estimateDistanceMM(
    faceMatrix: Float32Array | number[] | null,
    mmPerNormUnit: number
  ): number | null {
    const cfg = FITTING_CONFIG.captureDistance;

    if (cfg.method === 'mediapipe-transform') {
      if (!faceMatrix || faceMatrix.length < 16) return null;
      const z = Math.abs(faceMatrix[14]);
      if (!isFinite(z) || z <= 0) return null;
      return this.smooth('distance', z * cfg.mediapipeUnitToMM, 5);
    }

    const halfFov = (cfg.assumedHorizontalFovDeg * Math.PI) / 360;
    const t = Math.tan(halfFov);
    if (t <= 0) return null;
    return this.smooth('distance', mmPerNormUnit / (2 * t), 5);
  }

  /**
   * Horizontal field of view of the capture, in degrees, from the distance and the scale.
   *
   * The whole frame spans `mmPerNormUnit` millimetres at the subject plane — that is what
   * "mm per normalized unit" means, normalized x running 0 to 1 — and a pinhole camera at
   * distance D sees 2 D tan(fov / 2) there. Inverting gives the fov with no new assumption:
   * both inputs are already on the panel.
   *
   * This is what the 3D try-on needs to foreshorten the temples by the same amount the
   * webcam foreshortened the face. Getting it wrong does not move anything in the plane of
   * the lenses — it only bends what sticks out in depth, which is why it shows up as
   * temples that miss the ears while the front of the frame looks perfectly placed.
   */
  private estimateCameraHFovDeg(distanceMM: number | null): number | null {
    const band = FITTING_CONFIG.vtoPlacement.cameraHFovBandDeg;

    // Keep the last resolved field rather than reporting nothing.
    //
    // Returning null hands the try-on back to the generic assumption, and a tracker that
    // drops the transformation matrix on the odd frame therefore made the virtual camera
    // flip between the measured field and the assumed one several times a second. Every
    // flip re-projects the scene, so the frame visibly jumps: it is placed for one field
    // of view, then for another. Holding the last good value keeps the projection stable
    // through the gaps.
    if (distanceMM === null || !(distanceMM > 0)) return this.resolvedCameraHFovDeg;

    const scale = this.resolvedScaleMMPerNorm;
    if (scale === null || !(scale > 0)) return this.resolvedCameraHFovDeg;

    const raw = (2 * Math.atan(scale / (2 * distanceMM)) * 180) / Math.PI;
    if (!isFinite(raw)) return this.resolvedCameraHFovDeg;

    // Clamp instead of discarding: a field just outside the band is still much closer to
    // the truth than the generic assumption, and clamping cannot oscillate.
    const clamped = Math.min(band.max, Math.max(band.min, raw));
    return this.smooth('cameraHFov', clamped, 0.1);
  }

  /** Assembles the capture-distance block, including its plain-language caveat. */
  private buildCaptureDistance(
    mm: number | null
  ): OpticalMeasurements['captureDistance'] {
    const cfg = FITTING_CONFIG.captureDistance;
    const range = cfg.recommendedRangeMM;

    if (mm === null) {
      return {
        millimetres: null,
        centimetres: null,
        method: cfg.method,
        withinRecommendedRange: false,
        recommendedRangeMM: range,
        note: cfg.method === 'mediapipe-transform' ? t('dist.noMatrix') : t('dist.noScale'),
      };
    }

    const within = mm >= range.min && mm <= range.max;
    return {
      millimetres: Math.round(mm),
      centimetres: parseFloat((mm / 10).toFixed(1)),
      method: cfg.method,
      withinRecommendedRange: within,
      recommendedRangeMM: range,
      note: within ? t('dist.ok') : mm < range.min ? t('dist.tooClose') : t('dist.tooFar'),
    };
  }

  /**
   * Re-renders the language-dependent notes on the cached measurement after a language
   * switch. Without this, a report exported while no face is detected keeps the notes in
   * whichever language was active when the object was last built.
   */
  public refreshLocale(): void {
    const m = this.currentMeasurements;

    m.fittingHeight.note =
      m.fittingHeight.lensHeightSource === 'measured'
        ? t('fit.sourceMeasured')
        : m.fittingHeight.lensHeightSource === 'catalog'
          ? t('fit.sourceCatalog')
          : t('fit.sourceFallback');

    const cal = m.creditCardCalibration;
    if (cal) {
      const band = FITTING_CONFIG.cardCalibration.impliedPdAcceptedMM;
      cal.precisionStatus = !cal.active
        ? t('card.inactive')
        : cal.accepted
          ? t('card.accepted')
          : t('card.rejected', {
              pd: cal.impliedPdMM?.toFixed(1) ?? '—',
              min: band.min,
              max: band.max,
            });
    }

    const d = m.captureDistance;
    d.note =
      d.millimetres === null
        ? t('dist.noFace')
        : d.withinRecommendedRange
          ? t('dist.ok')
          : d.millimetres < d.recommendedRangeMM.min
            ? t('dist.tooClose')
            : t('dist.tooFar');
  }

  /** Drops smoothing history so a newly detected face does not inherit the previous one. */
  public resetSmoothing(): void {
    this.emaState = {};
    this.shownState = {};
  }

  public getDefaultMeasurements(): OpticalMeasurements {
    return {
      patientId: `PAT-${Math.floor(100000 + Math.random() * 900000)}`,
      timestamp: new Date().toISOString(),
      unit: "mm",
      pupillaryDistance: {
        pdTotal: 65,
        pdRight: 32,
        pdLeft: 33,
        appliedOffsetMM: FITTING_CONFIG.pdOffsetMM,
      },
      fittingHeight: {
        heightRight: 25,
        heightLeft: 26,
        source: FITTING_CONFIG.mode,
        lensHeightBMM: null,
        lensHeightSource: 'fallback',
        note: t('fit.sourceFallback'),
      },
      // The default heights rest on a stand-in B, so they are provisional by definition
      outOfRange: {
        pdRight: false,
        pdLeft: false,
        heightRight: true,
        heightLeft: true,
      },
      creditCardCalibration: {
        active: false,
        standardCardWidthMM: 85.60,
        apparentWidthPx: null,
        scaleMMPerNormUnit: null,
        calibratedScaleRatio: 1.0,
        impliedPdMM: null,
        accepted: false,
        precisionStatus: t('card.inactive'),
      },
      captureDistance: {
        millimetres: null,
        centimetres: null,
        method: FITTING_CONFIG.captureDistance.method,
        withinRecommendedRange: false,
        recommendedRangeMM: FITTING_CONFIG.captureDistance.recommendedRangeMM,
        note: t('dist.noFace'),
      },
      frameGeometry: {
        lensWidth: 55,
        bridgeWidth: 17,
        templeLength: 145,
        calculatedTotalWidth: 142,
        skuName: "Classic Aviator",
      },
      ergonomicsAndEarFit: {
        headWidthMM: 142.5,
        templeReachDepthMM: 135.0,
        pantoscopicTiltDeg: 6.5,
        earAlignmentRatio: 1.0,
        fitStatus: "Optimal - Ears & Face Calibrated",
      },
    };
  }

  /**
   * Computes optical measurements in real-time from MediaPipe 3D face mesh landmarks
   */
  public calculateFromLandmarks(
    landmarks: any[],
    skuInfo?: {
      name: string;
      width: number;
      /** B published by the frame's specs, when it publishes one. */
      lensHeightBMM?: number | null;
      /** B measured on the installed 3D model. Wins over the published figure. */
      measuredLensHeightBMM?: number | null;
    },
    fitStatus?: string,
    faceMatrix?: Float32Array | number[] | null
  ): OpticalMeasurements {
    if (!landmarks || landmarks.length < 468) {
      return this.currentMeasurements;
    }

    const noseMidline = landmarks[168] || landmarks[6];
    
    // Pupil locations
    const rightPupil = landmarks[468] || {
      x: (landmarks[33].x + landmarks[133].x) / 2,
      y: (landmarks[33].y + landmarks[133].y) / 2,
      z: (landmarks[33].z + landmarks[133].z) / 2,
    };

    const leftPupil = landmarks[473] || {
      x: (landmarks[263].x + landmarks[362].x) / 2,
      y: (landmarks[263].y + landmarks[362].y) / 2,
      z: (landmarks[263].z + landmarks[362].z) / 2,
    };

    const rightEar = landmarks[234];
    const leftEar = landmarks[454];

    // Scale factor (use custom Credit Card calibration if available, else facial PD estimate)
    const dxPupils = leftPupil.x - rightPupil.x;
    const dyPupils = leftPupil.y - rightPupil.y;
    const dzPupils = (leftPupil.z || 0) - (rightPupil.z || 0);
    const pupilDistNorm = Math.sqrt(dxPupils * dxPupils + dyPupils * dyPupils + dzPupils * dzPupils);

    const defaultScale = pupilDistNorm > 0 ? FITTING_CONFIG.pdReferenceMM / pupilDistNorm : 450;

    // Plausibility gate. Once the card fixes the scale, the patient's PD follows from it.
    // If that implied PD is anatomically impossible the marking is wrong — almost always
    // because the card was not held in the plane of the eyes — so the calibration is
    // rejected instead of silently rescaling every figure in the report.
    const cardScale = this.customScaleMMPerNorm;
    const impliedPdMM =
      cardScale !== null && pupilDistNorm > 0 ? pupilDistNorm * cardScale : null;
    const band = FITTING_CONFIG.cardCalibration.impliedPdAcceptedMM;
    const cardAccepted =
      impliedPdMM !== null && impliedPdMM >= band.min && impliedPdMM <= band.max;

    const mmPerNormUnit = cardAccepted ? (cardScale as number) : defaultScale;
    this.resolvedScaleMMPerNorm = mmPerNormUnit;

    // Distance is resolved once per frame: it is smoothed, so asking for it twice would
    // advance the filter twice and make the reading lag the patient.
    const distanceMM = this.estimateDistanceMM(faceMatrix ?? null, mmPerNormUnit);
    this.resolvedDistanceMM = distanceMM;
    this.resolvedCameraHFovDeg = this.estimateCameraHFovDeg(distanceMM);

    // 1. Calculate Nasopupillary Distances (PD Right & PD Left)
    const pdRightNorm = Math.abs(noseMidline.x - rightPupil.x);
    const pdLeftNorm = Math.abs(leftPupil.x - noseMidline.x);

    // Clamp into the plausible range instead of snapping to a constant: snapping made
    // the readout jump in discrete steps whenever a frame drifted out of range.
    const pdRightMeasured = this.smooth(
      'pdRight',
      Math.min(42, Math.max(25, pdRightNorm * mmPerNormUnit))
    );
    const pdLeftMeasured = this.smooth(
      'pdLeft',
      Math.min(42, Math.max(25, pdLeftNorm * mmPerNormUnit))
    );

    // The client's offset is applied AFTER the clamp and after smoothing, so neither the
    // plausibility band nor the EMA state is shifted by a correction that is not part of
    // the anatomy. Half per eye keeps pdRight + pdLeft = pdTotal.
    const pdOffset = FITTING_CONFIG.pdOffsetMM;
    const pdRight = parseFloat((pdRightMeasured + pdOffset / 2).toFixed(2));
    const pdLeft = parseFloat((pdLeftMeasured + pdOffset / 2).toFixed(2));
    const pdTotal = Math.round(pdRight + pdLeft);

    // 2. Fitting heights. Every constant below comes from fitting_config.ts so the model
    //    can be reviewed and retuned by a specialist without touching this algorithm.
    const vScale = this.verticalScale();
    // Precedence lives here, in one place: the measured opening describes the mesh the
    // patient is looking at, the catalogue figure describes the model number, and the
    // stand-in describes nothing at all.
    const measuredB = skuInfo?.measuredLensHeightBMM ?? null;
    const catalogB = skuInfo?.lensHeightBMM ?? null;
    const lensHeightBMM = measuredB ?? catalogB;
    const lensHeightSource: 'measured' | 'catalog' | 'fallback' =
      measuredB !== null ? 'measured' : catalogB !== null ? 'catalog' : 'fallback';

    let rawHeightRight: number;
    let rawHeightLeft: number;

    if (FITTING_CONFIG.mode === 'frame-geometry') {
      // Clinical definition: pupil centre down to the lowest point of the lens groove.
      // That distance is a property of the FRAME, so it is derived from the B measurement
      // and then offset per eye by how high each pupil sits relative to the pair.
      const B = lensHeightBMM ?? FITTING_CONFIG.frameGeometry.defaultLensHeightBMM;
      const base = FITTING_CONFIG.frameGeometry.pupilHeightRatio * B;
      const [offR, offL] = this.perEyeOffsetsMM(
        rightPupil, leftPupil, rightEar, leftEar, mmPerNormUnit, vScale
      );

      rawHeightRight = base + offR;
      rawHeightLeft = base + offL;
    } else {
      // Anatomical proxy: extrapolates below the lower eyelid margin to guess the groove.
      const f = FITTING_CONFIG.anatomicalProxy.lidExtrapolationFactor;
      const rightLowerRimY = landmarks[145]
        ? landmarks[145].y + (landmarks[145].y - rightPupil.y) * f
        : rightPupil.y + 0.055;
      const leftLowerRimY = landmarks[374]
        ? landmarks[374].y + (landmarks[374].y - leftPupil.y) * f
        : leftPupil.y + 0.055;

      rawHeightRight = Math.abs(rightLowerRimY - rightPupil.y) * mmPerNormUnit * vScale;
      rawHeightLeft = Math.abs(leftLowerRimY - leftPupil.y) * mmPerNormUnit * vScale;
    }

    const { minMM, maxMM } = FITTING_CONFIG.plausibleRange;
    const heightRight = this.smooth('heightRight', Math.min(maxMM, Math.max(minMM, rawHeightRight)));
    const heightLeft = this.smooth('heightLeft', Math.min(maxMM, Math.max(minMM, rawHeightLeft)));

    // 3. Ergonomics
    let headWidthMM = 142.0;
    let templeReachDepthMM = 135.0;
    let pantoscopicTiltDeg = 6.5;
    let earAlignmentRatio = 1.0;

    if (rightEar && leftEar) {
      const dxEars = Math.abs(leftEar.x - rightEar.x);
      headWidthMM = this.smooth('headWidth', dxEars * mmPerNormUnit);

      const earZAvg = ((rightEar.z || 0) + (leftEar.z || 0)) / 2;
      const noseZ = noseMidline.z || 0;
      templeReachDepthMM = this.smooth(
        'templeReach',
        Math.min(165, Math.max(110, Math.abs(earZAvg - noseZ) * mmPerNormUnit * 2.2))
      );

      const earYAvg = (rightEar.y + leftEar.y) / 2;
      const eyeYAvg = (rightPupil.y + leftPupil.y) / 2;
      pantoscopicTiltDeg = this.smooth(
        'pantoTilt',
        Math.min(15, Math.max(0, (earYAvg - eyeYAvg) * FITTING_CONFIG.pantoscopicDegPerNormUnit)),
        0.1
      );

      earAlignmentRatio = parseFloat((Math.abs(rightEar.y - eyeYAvg) / Math.max(0.001, Math.abs(leftEar.y - eyeYAvg))).toFixed(2));
      if (isNaN(earAlignmentRatio) || earAlignmentRatio > 2 || earAlignmentRatio < 0.5) earAlignmentRatio = 1.0;
    }

    // 4. Frame Geometry
    const frameWidth = skuInfo?.width || 142;
    const bridgeWidth = 17;
    const lensWidth = Math.round((frameWidth - bridgeWidth - 10) / 2);
    const templeLength = Math.round(templeReachDepthMM + 10);

    this.currentMeasurements = {
      patientId: this.currentMeasurements.patientId,
      timestamp: new Date().toISOString(),
      unit: "mm",
      pupillaryDistance: {
        pdTotal,
        pdRight,
        pdLeft,
        appliedOffsetMM: pdOffset,
      },
      fittingHeight: {
        heightRight,
        heightLeft,
        source: FITTING_CONFIG.mode,
        lensHeightBMM,
        lensHeightSource,
        note:
          lensHeightSource === 'measured'
            ? t('fit.sourceMeasured')
            : lensHeightSource === 'catalog'
              ? t('fit.sourceCatalog')
              : t('fit.sourceFallback'),
      },
      creditCardCalibration: {
        active: cardScale !== null,
        standardCardWidthMM: FITTING_CONFIG.cardCalibration.cardWidthMM,
        apparentWidthPx: this.cardApparentWidthPx,
        scaleMMPerNormUnit: cardScale !== null ? parseFloat(cardScale.toFixed(2)) : null,
        calibratedScaleRatio:
          cardScale !== null ? parseFloat((cardScale / defaultScale).toFixed(4)) : 1.0,
        impliedPdMM: impliedPdMM !== null ? parseFloat(impliedPdMM.toFixed(1)) : null,
        accepted: cardAccepted,
        precisionStatus:
          cardScale === null
            ? t('card.inactive')
            : cardAccepted
              ? t('card.accepted')
              : t('card.rejected', {
                  pd: impliedPdMM?.toFixed(1) ?? '—',
                  min: band.min,
                  max: band.max,
                }),
      },
      captureDistance: this.buildCaptureDistance(distanceMM),
      // A value pinned to its boundary is a clamped estimate, not a reading. A height
      // built on a stand-in B is provisional too: it does not belong to this frame.
      outOfRange: {
        // Flagged against the MEASUREMENT, not the reported figure: the flag means the
        // anatomy hit a boundary, and the client's offset is not anatomy.
        pdRight: pdRightMeasured <= 25 || pdRightMeasured >= 42,
        pdLeft: pdLeftMeasured <= 25 || pdLeftMeasured >= 42,
        heightRight: heightRight <= minMM || heightRight >= maxMM || lensHeightBMM === null,
        heightLeft: heightLeft <= minMM || heightLeft >= maxMM || lensHeightBMM === null,
      },
      frameGeometry: {
        lensWidth,
        bridgeWidth,
        templeLength,
        calculatedTotalWidth: frameWidth,
        skuName: skuInfo?.name || "Custom Eyewear Frame",
      },
      ergonomicsAndEarFit: {
        headWidthMM: Math.max(120, Math.min(160, headWidthMM)),
        templeReachDepthMM,
        pantoscopicTiltDeg,
        earAlignmentRatio,
        // Real tracker verdict when available, so the exported report is not a constant
        fitStatus: fitStatus || "Optimal - Ears & Face Calibrated",
      },
    };

    return this.currentMeasurements;
  }

  public getMeasurements(): OpticalMeasurements {
    return this.currentMeasurements;
  }

  /**
   * Exports the current optical measurements as a downloadable JSON file
   */
  public downloadJSON(customFilename?: string): void {
    const jsonString = JSON.stringify(this.currentMeasurements, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement("a");
    a.href = url;
    a.download = customFilename || `optical_prescription_${this.currentMeasurements.patientId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

import * as THREE from 'three';
import { viewTransform } from './view_transform';
import { FITTING_CONFIG } from './fitting_config';

export interface VTOAdjustment {
  scale: number;        // Multiplier (0.7 to 1.3)
  yOffset: number;      // Vertical offset in mm (-50 to 50)
  zOffset: number;      // Depth offset in mm (-50 to 50)
  flipZ: boolean;       // Rotate 180° on Y if AI model temples point forward (+Z instead of -Z)
  templeWidth: number;  // Lateral temple flare opening scale (0.8 to 1.5)
}

export interface FacePoseInfo {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  isFrontal: boolean;
  warningMessage?: string;
}

export class VTOManager {
  private camera: THREE.PerspectiveCamera;
  private glassesGroup: THREE.Group;
  private sceneManager: any; // circular dep avoided with 'any'
  
  // Real-time adjustments from UI
  public adjustments: VTOAdjustment = {
    scale: 1.0,
    yOffset: 0,
    zOffset: 0,
    flipZ: false,
    templeWidth: 1.0
  };

  // Lerping states for smooth transitions
  public currentPosition = new THREE.Vector3(0, 0, -0.65);
  public currentQuaternion = new THREE.Quaternion();
  public currentScale = new THREE.Vector3(1, 1, 1);
  
  private lerpFactor = 0.22;

  /**
   * Millimetres per normalized landmark unit, as the optical calculator last resolved it —
   * from the credit-card guide when the operator has marked one and it passed the
   * plausibility gate, otherwise from the assumed reference PD.
   *
   * The frame is drawn at its TRUE physical size, so this is what ties the model's
   * millimetres to the scene: a 132 mm frame renders visibly narrower than a 148 mm one on
   * the same face, which is the whole point of trying frames on. Left null it falls back to
   * the reference PD, which is exactly what the calculator's own default does.
   */
  public mmPerNormUnit: number | null = null;

  /**
   * Subject-to-camera distance in mm, as resolved by the optical calculator. This is the
   * depth the face is placed at, which is what makes the frame's size follow the patient.
   */
  public captureDistanceMM: number | null = null;

  /** Last accepted PD in mm — reused when a frame's landmarks give an absurd one. */
  private lastGoodPdMM = FITTING_CONFIG.pdReferenceMM;

  /**
   * The patient's width across the ears in mm, as the optical calculator measured it, used
   * to size the head that hides the temples.
   *
   * Only ever taken from a FRONTAL frame. The measurement is a horizontal difference
   * between the two ear landmarks, so it shortens by cos(yaw) as the head turns — and the
   * occluder turns with the head already. Feeding it the shortened number would narrow the
   * skull a second time for the same rotation, and the temples would surface through the
   * side of the head exactly when the patient turns to look at them.
   */
  public headWidthMM: number | null = null;
  private lastFrontalHeadWidthMM: number | null = null;

  /**
   * Pupil separation as a fraction of the forehead-to-chin span, learned while the patient
   * is facing the camera. It is what lets the second, yaw-immune ruler be read in the same
   * units as the first. Null until a frontal frame has been seen.
   */
  private pupilPerFaceSpan: number | null = null;

  // Last frame's two size estimates, exposed for the on-screen diagnostic. Which of the
  // two wins decides the frame's scale, so seeing them side by side is what tells a
  // wrong size apart from a wrong depth.
  public lastProjectedPupilDist = 0;
  public lastSpanEstimate = 0;

  // Raw inputs, exposed for the diagnostic. Everything downstream assumes landmark
  // coordinates arrive normalized to [0,1]; if they do not, every derived figure is
  // meaningless and the frame lands outside the view. These say so directly.
  public lastAnchorX = 0;
  public lastAnchorY = 0;
  public lastPupilDistNorm = 0;
  public lastHalfWidth = 0;

  /**
   * Pantoscopic tilt actually applied to the frame, in radians, smoothed. Held between
   * frames because the ear landmarks are only trustworthy while the patient is frontal —
   * the same reason the head width is.
   */
  private pantoscopicRad = 0;

  /** Height of the ear landmark itself, mm from the pupil line, from the last frontal read. */
  private lastFrontalEarYmm: number | null = null;

  /**
   * Capture frame height divided by its width.
   *
   * MediaPipe normalizes x by the frame's WIDTH and y by its HEIGHT, so the two are not
   * the same physical length until one is rescaled — and the pose angles below are built
   * out of exactly that comparison. Without it a 16:9 stream multiplies the tangent of
   * every roll by 1.78: a relaxed 10 degree head tilt reports as 17, the frontal gate
   * (which allows 8) never opens, and everything hanging off it — the occluder's width,
   * the scale calibration, the pose banner — quietly stops updating.
   */
  public frameAspect = 9 / 16;

  constructor(camera: THREE.PerspectiveCamera, glassesGroup: THREE.Group, sceneManager: any) {
    this.camera = camera;
    this.glassesGroup = glassesGroup;
    this.sceneManager = sceneManager;
  }

  public resetSmoothing(): void {
    this.currentPosition.set(0, 0, -0.65);
    this.currentQuaternion.set(0, 0, 0, 1);
    this.currentScale.set(1, 1, 1);
  }

  /**
   * Calculates 3D Head Pose Orientation Angles (Yaw, Pitch, Roll) and determines if pose is Frontal
   */
  public calculatePoseInfo(landmarks: any[]): FacePoseInfo {
    const rightEye = landmarks[33];
    const leftEye = landmarks[263];
    const forehead = landmarks[10];
    const chin = landmarks[152];

    if (!rightEye || !leftEye || !forehead || !chin) {
      return { yawDeg: 0, pitchDeg: 0, rollDeg: 0, isFrontal: false, warningMessage: "Searching Face" };
    }

    // Normalized y is a fraction of the frame HEIGHT and normalized x a fraction of its
    // WIDTH, so a vertical delta has to be brought onto the horizontal scale before the
    // two can be put in the same triangle. z is normalized against the width, like x.
    const vs = this.frameAspect > 0 ? this.frameAspect : 9 / 16;

    // 1. Yaw (Head turn left/right around vertical Y axis)
    const dxEyes = leftEye.x - rightEye.x;
    const dzEyes = (leftEye.z || 0) - (rightEye.z || 0);
    const yawRad = Math.atan2(dzEyes, dxEyes);
    const yawDeg = Math.round(yawRad * (180 / Math.PI));

    // 2. Pitch (Head tilt up/down around horizontal X axis)
    const dyVert = (chin.y - forehead.y) * vs;
    const dzVert = (chin.z || 0) - (forehead.z || 0);
    const pitchRad = Math.atan2(dzVert, dyVert);
    const pitchDeg = Math.round(pitchRad * (180 / Math.PI));

    // 3. Roll (Head tilt side-to-side around depth Z axis)
    const dyRoll = (leftEye.y - rightEye.y) * vs;
    const dxRoll = leftEye.x - rightEye.x;
    const rollRad = Math.atan2(dyRoll, dxRoll);
    const rollDeg = Math.round(rollRad * (180 / Math.PI));

    // Frontal pose thresholds: Yaw <= 8°, Pitch <= 10°, Roll <= 8°
    const isYawFrontal = Math.abs(yawDeg) <= 8;
    const isPitchFrontal = Math.abs(pitchDeg) <= 10;
    const isRollFrontal = Math.abs(rollDeg) <= 8;

    const isFrontal = isYawFrontal && isPitchFrontal && isRollFrontal;

    let warningMessage = "";
    if (!isFrontal) {
      if (!isYawFrontal) {
        warningMessage = yawDeg > 0 ? "Turn head slightly to your right" : "Turn head slightly to your left";
      } else if (!isPitchFrontal) {
        warningMessage = pitchDeg > 0 ? "Tilt head slightly downward" : "Tilt head slightly upward";
      } else if (!isRollFrontal) {
        warningMessage = "Keep head level horizontally";
      }
    }

    return {
      yawDeg,
      pitchDeg,
      rollDeg,
      isFrontal,
      warningMessage
    };
  }

  /**
   * Pupil centres. The iris landmarks are what the tracker actually resolves them to; the
   * eye-corner midpoint is the same substitute the optical calculator falls back on when a
   * build without iris refinement is running, so the two agree on where the eyes are.
   */
  private pupils(landmarks: any[]): { right: any; left: any } | null {
    const mid = (a: any, b: any) =>
      a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 } : null;

    const right = landmarks[468] || mid(landmarks[33], landmarks[133]);
    const left = landmarks[473] || mid(landmarks[263], landmarks[362]);
    return right && left ? { right, left } : null;
  }

  /**
   * How much the frame has to be pitched to bring its temples onto this patient's ears.
   *
   * Returns the reason instead of the angle whenever it cannot be worked out, because the
   * only thing worse than no tilt is a silent one: every early return here used to leave
   * the frame flat with nothing on screen or in the console to say why.
   */
  private resolveTilt(
    earRest: { y: number; z: number } | null,
    rightEar: any,
    leftEar: any,
    anchor: any,
    vecY: THREE.Vector3,
    halfWidth: number,
    halfHeight: number,
    baseScale: number,
    pose: FacePoseInfo
  ): { rad: number | null; earYmm: number | null; why: string } {
    if (!earRest) return { rad: null, earYmm: null, why: 'the frame has no readable temple bend' };
    if (!rightEar || !leftEar) return { rad: null, earYmm: null, why: 'no ear landmarks' };
    if (!(baseScale > 0)) return { rad: null, earYmm: null, why: 'no scale yet' };

    // Wider than the panel's "frontal" gate: the two ears average out under a moderate
    // turn, and at the strict +/-8 deg the tilt would almost never get a chance to update.
    if (Math.abs(pose.yawDeg) > 20 || Math.abs(pose.pitchDeg) > 12 || Math.abs(pose.rollDeg) > 12) {
      return { rad: null, earYmm: null, why: `pose too turned (yaw ${pose.yawDeg} pitch ${pose.pitchDeg} roll ${pose.rollDeg})` };
    }

    // Screen plane only — no MediaPipe depth anywhere in this measurement.
    const planar = (lm: any) =>
      new THREE.Vector2(
        (0.5 - viewTransform.x(lm.x)) * 2 * halfWidth,
        -(viewTransform.y(lm.y) - 0.5) * 2 * halfHeight
      );
    const earMid = planar(rightEar).add(planar(leftEar)).multiplyScalar(0.5);
    const d = earMid.sub(planar(anchor));

    const upMM = (d.x * vecY.x + d.y * vecY.y) * (1000 / baseScale);
    const earYmm = upMM + FITTING_CONFIG.vtoPlacement.templeRestAboveEarLandmarkMM;
    if (!isFinite(earYmm) || Math.abs(earYmm) > 60) {
      return { rad: null, earYmm, why: `ear height implausible (${earYmm.toFixed(1)} mm)` };
    }

    const depth = -earRest.z;
    const range = FITTING_CONFIG.vtoPlacement.pantoscopicRangeDeg;
    const wanted = Math.atan2(earRest.y, depth) - Math.atan2(earYmm, depth);
    return {
      rad: Math.min((range.max * Math.PI) / 180, Math.max((range.min * Math.PI) / 180, wanted)),
      earYmm,
      why: '',
    };
  }

  private lastPlacementLog = 0;

  /**
   * Prints the numbers the placement is actually built on, at most once every few seconds.
   *
   * Every one of these is an anatomical quantity that can be checked against the patient
   * in the chair — where their ear sits relative to their pupils, how far back it is, what
   * tilt that implies. Without them a report of "it still sits too high" can only be
   * answered by guessing, which is how this went round more than once.
   */
  private logPlacement(
    tilt: { rad: number | null; earYmm: number | null; why: string },
    earRest: { y: number; z: number } | null,
    pdMM: number
  ): void {
    const now = performance.now();
    if (now - this.lastPlacementLog < 3000) return;
    this.lastPlacementLog = now;

    const deg = (r: number) => ((r * 180) / Math.PI).toFixed(1);
    const rest = earRest
      ? `temple rests at y ${earRest.y.toFixed(1)} mm, z ${earRest.z.toFixed(1)} mm`
      : 'temple rest NOT FOUND';
    const ear =
      tilt.earYmm === null ? 'ear height —' : `ear wants y ${tilt.earYmm.toFixed(1)} mm`;

    console.log(
      `[VTO] placement · PD ${pdMM.toFixed(1)} mm · ${rest} · ${ear} · ` +
        `pantoscopic ${deg(this.pantoscopicRad)}°` +
        (tilt.rad === null ? `  (HELD: ${tilt.why})` : '')
    );
  }

  /**
   * Main update routine. Computes 3D transform from MediaPipe landmarks and updates glassesGroup.
   */
  public updatePose(landmarks: any[]): { pd: number; fitStatus: string; poseInfo: FacePoseInfo } {
    const rightEye = landmarks[33];
    const leftEye = landmarks[263];
    const forehead = landmarks[10];
    const chin = landmarks[152];
    const rightEar = landmarks[234];
    const leftEar = landmarks[454];

    const poseInfo = this.calculatePoseInfo(landmarks);
    const pupils = this.pupils(landmarks);

    if (!pupils || !rightEye || !leftEye || !forehead || !chin) {
      return { pd: 0, fitStatus: "Searching Face", poseInfo };
    }

    // The frame hangs off the eyes, so the pupil midpoint is the anchor. It used to be the
    // nose-bridge landmark, which sits higher on the face than the pupils by an amount
    // nobody had measured — so every model rode above the eyes and the operator had to
    // drag the vertical slider down before any frame looked worn.
    const anchor = {
      x: (pupils.right.x + pupils.left.x) / 2,
      y: (pupils.right.y + pupils.left.y) / 2,
      z: ((pupils.right.z || 0) + (pupils.left.z || 0)) / 2,
    };

    // 1. Apparent eye separation, used only to place the face in depth
    const dx = leftEye.x - rightEye.x;
    const dy = leftEye.y - rightEye.y;
    const dz = (leftEye.z || 0) - (rightEye.z || 0);
    const distScreen = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Depth is the measured subject distance.
    //
    // What stood here was `-(1.0 / (distScreen * 10.5))`: two constants tuned by eye
    // against one landscape webcam, driven by the eye-corner separation normalized by
    // FRAME WIDTH. On a portrait phone stream that denominator is a different quantity,
    // so the face was placed around 11 cm instead of 30 — close enough to the near plane
    // for the frame to straddle it, which is why a single temple filled the screen — and
    // the frame's world size stopped tracking the patient moving toward the camera.
    //
    // Using the measured distance makes the chain physical: put the face where it really
    // is and let the projection do the rest. The scale below then resolves to 1.0 on its
    // own, and the model — already normalized to its SKU width in metres — is drawn life
    // size, growing and shrinking with the patient because perspective says so.
    //
    // Falls back to the old heuristic while no distance has resolved yet, so a tracker
    // that has not produced one is no worse off than before.
    const referenceFocalLength = 1.0;
    let targetZ =
      this.captureDistanceMM !== null && this.captureDistanceMM > 0
        ? -(this.captureDistanceMM / 1000)
        : -(referenceFocalLength / (distScreen * 10.5));

    // The frame front rides in front of the eyes, not in their plane.
    //
    // This used to be `targetZ += earDepthNorm * 0.15` — an arbitrary factor on a
    // normalized depth — and it ran AFTER the projection was computed, so the model was
    // sized for one depth and drawn at another. On a Galaxy S25 Plus at 20.5 cm that term
    // came to 39 mm: the frame was scaled for 20.5 cm, placed at 16.6 cm, and rendered 23%
    // oversized, riding above the eyes. The offset is a physical property of wearing
    // glasses — vertex distance plus rim thickness — so it is the millimetre figure the
    // configuration already carries, and it is applied here, before anything is projected.
    targetZ += FITTING_CONFIG.vtoPlacement.frontPlaneAheadOfPupilMM / 1000;

    // 1b. Patient PD in millimetres, on the same scale the optician's panel reports —
    // including the credit-card calibration when one has been accepted. This is what turns
    // the model's own millimetres into scene units further down.
    const pdx = pupils.left.x - pupils.right.x;
    const pdy = pupils.left.y - pupils.right.y;
    const pdz = (pupils.left.z || 0) - (pupils.right.z || 0);
    const pupilDistNorm = Math.sqrt(pdx * pdx + pdy * pdy + pdz * pdz);

    const mmPerNorm = this.mmPerNormUnit ?? (
      pupilDistNorm > 0 ? FITTING_CONFIG.pdReferenceMM / pupilDistNorm : 0
    );
    const rawPdMM = pupilDistNorm * mmPerNorm;
    const { minPlausiblePdMM, maxPlausiblePdMM } = FITTING_CONFIG.vtoPlacement;
    if (rawPdMM >= minPlausiblePdMM && rawPdMM <= maxPlausiblePdMM) {
      this.lastGoodPdMM = rawPdMM;
    }
    const pdMM = this.lastGoodPdMM;
    const pdEstimate = Math.round(pdMM);

    // 2. Map X and Y coordinates to Three.js space
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const halfHeightAtDepth = Math.abs(targetZ) * Math.tan(fovRad / 2);
    const halfWidthAtDepth = halfHeightAtDepth * this.camera.aspect;

    // Landmarks are normalized against the camera frame; the frame is painted with
    // `object-fit: cover`, so every position goes through the crop mapping before it is
    // projected. Without it the frame drifts off the face as soon as the viewport aspect
    // stops matching the stream aspect — which is always, in phone portrait.
    const vt = viewTransform;
    const vx = (lm: any) => vt.x(lm.x);
    const vy = (lm: any) => vt.y(lm.y);

    const targetY = -(vy(anchor) - 0.5) * 2 * halfHeightAtDepth;

    const yOffsetM = this.adjustments.yOffset / 1000.0;
    const zOffsetM = this.adjustments.zOffset / 1000.0;

    // 3. Ear visibility, reported only.
    //
    // This block used to nudge the depth as well. It no longer does: the depth is the
    // measured distance plus the fixed front-plane offset above, and moving it here — after
    // the projection had been computed from it — was what left the frame sized for one
    // distance and drawn at another.
    let fitStatus = poseInfo.isFrontal ? "Frontal Alignment Active" : "⚠️ Align Face Straight Ahead";
    if (rightEar && leftEar && poseInfo.isFrontal) {
      fitStatus = "Optimal - Frontal Face & Ears Calibrated";
    }

    // Position alignment for mirrored camera feed
    const finalX = (0.5 - vx(anchor)) * 2 * halfWidthAtDepth;
    const finalY = targetY + yOffsetM;
    const finalZ = targetZ + zOffsetM;

    // Pupil separation in Three.js coordinates (consistent mirrored X-mapping)
    const leftPupilX = (0.5 - vx(pupils.left)) * 2 * halfWidthAtDepth;
    const leftPupilY = -(vy(pupils.left) - 0.5) * 2 * halfHeightAtDepth;
    const rightPupilX = (0.5 - vx(pupils.right)) * 2 * halfWidthAtDepth;
    const rightPupilY = -(vy(pupils.right) - 0.5) * 2 * halfHeightAtDepth;

    const dxThree = leftPupilX - rightPupilX;
    const dyThree = leftPupilY - rightPupilY;
    const projectedPupilDist = Math.sqrt(dxThree * dxThree + dyThree * dyThree);

    // A SECOND RULER, so the frame stops shrinking when the patient turns.
    //
    // The pupil separation is measured on screen, so it collapses by cos(yaw) as the head
    // turns: at 45 degrees the frame was drawn at 71% of its size, at 75 degrees at 26% —
    // which is why a frame that fitted head-on became a toy pair floating by the eyebrow
    // in profile. The forehead-to-chin span runs along the axis the head is turning about,
    // so yaw does not shorten it at all; pitch does, and pitch does not shorten the pupils.
    //
    // Taking the larger of the two estimates therefore picks whichever ruler is not being
    // foreshortened at that instant. The ratio between them is a property of the face, so
    // it is learned while the pose is frontal and both are trustworthy.
    const foreheadY = -(vy(forehead) - 0.5) * 2 * halfHeightAtDepth;
    const chinY = -(vy(chin) - 0.5) * 2 * halfHeightAtDepth;
    const foreheadX = (0.5 - vx(forehead)) * 2 * halfWidthAtDepth;
    const chinX = (0.5 - vx(chin)) * 2 * halfWidthAtDepth;
    const faceSpanThree = Math.hypot(foreheadX - chinX, foreheadY - chinY);

    if (poseInfo.isFrontal && faceSpanThree > 1e-6 && projectedPupilDist > 1e-6) {
      const ratio = projectedPupilDist / faceSpanThree;
      this.pupilPerFaceSpan =
        this.pupilPerFaceSpan === null
          ? ratio
          : this.pupilPerFaceSpan + (ratio - this.pupilPerFaceSpan) * 0.05;
    }

    // The second ruler may only make up for foreshortening — it may not invent size.
    //
    // The ratio it leans on is learned ONLY while the pose reads as frontal, so on a
    // handset where that never happens it stays frozen at whatever the first frame gave,
    // possibly measured under a different projection than the one in force now. Together
    // with the max() below that made it a one-way ratchet: once the estimate came out
    // inflated it won on every later frame and never recovered. Measured on a Galaxy S25
    // Plus that put the frame at 3.5x its true size, 3.8x wider than the whole visible
    // field at its depth, which is why only a temple crossed the screen.
    //
    // Undoing foreshortening is the entire job here, and pupil separation falls with
    // cos(yaw), so 1 / cos(55 deg) covers every turn the mechanism is meant to rescue.
    // Past that the estimate is not recovering a turned head, it is simply wrong.
    const MAX_SPAN_GAIN = 1.74;
    const spanEstimate =
      this.pupilPerFaceSpan !== null ? faceSpanThree * this.pupilPerFaceSpan : 0;
    const boundedSpan =
      projectedPupilDist > 1e-6
        ? Math.min(spanEstimate, projectedPupilDist * MAX_SPAN_GAIN)
        : spanEstimate;
    const pupilDistThree = Math.max(projectedPupilDist, boundedSpan);

    this.lastProjectedPupilDist = projectedPupilDist;
    this.lastSpanEstimate = spanEstimate;
    this.lastAnchorX = anchor.x;
    this.lastAnchorY = anchor.y;
    this.lastPupilDistNorm = pupilDistNorm;
    this.lastHalfWidth = halfWidthAtDepth;

    // Scene units per metre of real frame.
    //
    // The model that reaches this group has already been fitted to its SKU's true width in
    // metres, so all that is left is a unit conversion: the patient's pupils are pdMM apart
    // in life and pupilDistThree apart in the scene. A 132 mm frame then renders visibly
    // narrower than a 148 mm one, and a credit-card calibration feeds straight through.
    //
    // What this replaces was a fixed 1.40 multiple of the OUTER EYE CORNER separation with
    // the SKU width divided back out by a hard-coded 0.14 m. That drew every frame at the
    // same size regardless of the SKU, and the corner-to-corner distance is around 1.46x the
    // PD, so the product came out roughly a tenth narrower than a real frame on a real face.
    //
    // Resolved here rather than further down because the pantoscopic tilt needs it to read
    // the ear offset in millimetres.
    const baseScale = pdMM > 0 ? (pupilDistThree * 1000) / pdMM : 1;

    // 4. Rigorous 3D Pose Basis Vector Calculation (Mirrored Video Alignment)
    // pLeftEye is anatomical left eye (appears on screen left in mirrored view)
    const pLeftEye = new THREE.Vector3(
      (0.5 - vx(leftEye)) * 2 * halfWidthAtDepth,
      -(vy(leftEye) - 0.5) * 2 * halfHeightAtDepth,
      -vt.z(leftEye.z || 0) * halfWidthAtDepth
    );
    // pRightEye is anatomical right eye (appears on screen right in mirrored view)
    const pRightEye = new THREE.Vector3(
      (0.5 - vx(rightEye)) * 2 * halfWidthAtDepth,
      -(vy(rightEye) - 0.5) * 2 * halfHeightAtDepth,
      -vt.z(rightEye.z || 0) * halfWidthAtDepth
    );
    
    // vecX points Left→Right in screen space (pLeftEye -X → pRightEye +X)
    const vecX = new THREE.Vector3().subVectors(pRightEye, pLeftEye).normalize();

    // Chin -> Forehead (+Y axis)
    const pForehead = new THREE.Vector3(
      (0.5 - vx(forehead)) * 2 * halfWidthAtDepth,
      -(vy(forehead) - 0.5) * 2 * halfHeightAtDepth,
      -vt.z(forehead.z || 0) * halfWidthAtDepth
    );
    const pChin = new THREE.Vector3(
      (0.5 - vx(chin)) * 2 * halfWidthAtDepth,
      -(vy(chin) - 0.5) * 2 * halfHeightAtDepth,
      -vt.z(chin.z || 0) * halfWidthAtDepth
    );
    const vecUp = new THREE.Vector3().subVectors(pForehead, pChin).normalize();

    // Face Normal (+Z axis points out of face toward camera)
    let vecZ = new THREE.Vector3().crossVectors(vecX, vecUp).normalize();
    let vecY = new THREE.Vector3().crossVectors(vecZ, vecX).normalize();

    if (this.adjustments.flipZ) {
      // Rotate 180° around Y axis: negate both X and Z so Y remains pointing UP (+Y)
      vecX.negate();
      vecZ.negate();
    }

    const rotMatrix = new THREE.Matrix4().makeBasis(vecX, vecY, vecZ);
    const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

    // 4b. Pantoscopic tilt — the pitch that puts the temples ON the ears.
    //
    // A frame anchored only at the pupils has nothing at all deciding its tilt, so its
    // temples leave the face horizontally and run off into the air above the ears. Real
    // eyewear is held by two contacts, the nose and the ears, and it is the second one
    // that sets the pitch. So the frame is rotated about the pupil line — which leaves the
    // optical centres exactly where they were — until the point where its temples are
    // built to rest lines up with where this patient's ears actually are.
    //
    // MediaPipe's depth is deliberately NOT used here. Its z is mapped into the scene at
    // half the scale x is (`-vt.z(nz) * halfWidth` against `Δnx * 2 * halfWidth`), so an
    // ear that really sits 95 mm back reads as about 47 mm — and a depth that is wrong by
    // a factor of two puts the angle wrong by the same amount. The ear's HEIGHT, measured
    // in the plane of the picture, is solid; so the measured height is paired with the
    // depth at which THIS frame's temple is built to rest. That is exactly the question
    // being asked: at the depth where this temple comes down, is it at the ear or not?
    const earRest = this.sceneManager?.lastFit?.earRestMM ?? null;
    const tilt = this.resolveTilt(
      earRest, rightEar, leftEar, anchor, vecY,
      halfWidthAtDepth, halfHeightAtDepth, baseScale, poseInfo
    );
    if (tilt.rad !== null) {
      this.pantoscopicRad += (tilt.rad - this.pantoscopicRad) * 0.08;
      // The raw landmark, not the temple-rest height: the puck stands in for the ear
      // itself, which sits `templeRestAboveEarLandmarkMM` BELOW where the arm rests on it.
      this.lastFrontalEarYmm = tilt.earYmm! - FITTING_CONFIG.vtoPlacement.templeRestAboveEarLandmarkMM;
    }
    this.logPlacement(tilt, earRest, pdMM);

    // Positive tilt drops the BACK of the temple, which is why the angle is negated: a
    // rotation of +a about X lifts a point that lies at -Z. It is applied after the pose
    // is smoothed rather than before, because pantoscopicRad carries its own filter and
    // running it through the slerp as well would make the frame lag the head.
    const tiltQuaternion = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      -this.pantoscopicRad
    );

    // 5. Frame size on screen, from the scale resolved above.
    const targetScaleFactor = baseScale * this.adjustments.scale;

    const targetScaleX = targetScaleFactor * (this.adjustments.templeWidth || 1.0);
    const targetScale = new THREE.Vector3(targetScaleX, targetScaleFactor, targetScaleFactor);

    // 6. Apply Smooth Interpolation
    this.currentPosition.lerp(new THREE.Vector3(finalX, finalY, finalZ), this.lerpFactor);
    this.currentQuaternion.slerp(targetQuaternion, this.lerpFactor);
    this.currentScale.lerp(targetScale, this.lerpFactor);

    this.glassesGroup.position.copy(this.currentPosition);
    // The FRAME carries the pantoscopic tilt; the head below does not. currentQuaternion
    // stays the patient's own orientation so the occluder is not pitched along with the
    // eyewear — a skull that tilted every time a frame did would let the temples surface
    // straight through the side of the head.
    this.glassesGroup.quaternion.copy(this.currentQuaternion).multiply(tiltQuaternion);
    this.glassesGroup.scale.copy(this.currentScale);

    // Update the head that hides the temples. It takes the Y scale (which carries no
    // temple-width stretch) divided back by the operator's frame-size slider, so the
    // patient stays the size the patient is while the frame on their face changes.
    if (poseInfo.isFrontal && this.headWidthMM && this.headWidthMM > 0) {
      this.lastFrontalHeadWidthMM = this.headWidthMM;
    }
    this.sceneManager.updateOccluder(
      this.currentPosition,
      this.currentQuaternion,
      this.currentScale.y / (this.adjustments.scale || 1),
      this.lastFrontalHeadWidthMM
    );

    // The ears. Placed at the patient's own measured ear height and head half-width, at
    // the depth this frame's temple comes to rest — which is by definition the point past
    // which the arm should be behind the ear rather than drawn across it.
    this.sceneManager.setEarOccluders(
      earRest && this.lastFrontalEarYmm !== null && this.lastFrontalHeadWidthMM
        ? {
            halfWidthM: this.lastFrontalHeadWidthMM / 2000,
            yM: this.lastFrontalEarYmm / 1000,
            zM: earRest.z / 1000,
          }
        : null
    );

    return { pd: pdEstimate, fitStatus, poseInfo };
  }
}

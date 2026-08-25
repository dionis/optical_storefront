import * as THREE from 'three';
import { FITTING_CONFIG } from './fitting_config';

/**
 * Brings an arbitrary eyewear GLB into the single pose the try-on expects, so a model
 * downloaded from the pipeline, exported by hand from Blender or produced by a generator
 * all land on the face the same way.
 *
 * THE CONVENTION (local space of the object added to vtoGroup, metres):
 *   +X  screen-right    +Y  up    +Z  out of the face, toward the camera
 *   y = 0  is the PUPIL LINE, not the middle of the frame. The front is placed so the
 *          pupil sits at `pupilHeightRatio` of the way up the lens opening — the same
 *          constant the fitting-height figure on the optician's panel is built on.
 *   x = 0  is the horizontal centre of the frame FRONT (temples may flare past it).
 *   z = frontPlaneAheadOfPupilMM  is the frontmost point of the frame.
 * vtoGroup is anchored on the midpoint of the two pupils, so a model in this convention
 * needs no manual nudging to sit on the eyes.
 *
 * Nothing here trusts the file's own axes. A GLB carries no notion of "this is the front
 * of a pair of glasses", and exporters disagree about which axis is up, so the pose is
 * recovered from the geometry itself:
 *
 *  - WIDTH is the mirror-symmetry axis. Eyewear is symmetric left/right about the sagittal
 *    plane and about nothing else, which separates it cleanly from the other two axes.
 *  - HEIGHT vs DEPTH is decided by extent: a frame is roughly 140 x 40 x 160 mm, so the
 *    short axis is the vertical one. When those two are within a factor of 1.6 — a front
 *    with no temples, or temples folded flat — the model is left exactly as it arrived
 *    rather than guessed at.
 *  - FRONT is the end of the depth axis carrying the bulk of the geometry; the temples are
 *    two thin rods, the front is a plate.
 *  - UP is where the temples and the bridge sit: both are above the vertical centre of the
 *    front. The two signals are added together, and a near-zero sum leaves the axis as it
 *    was instead of risking an upside-down frame.
 *
 * Verified against the real generated model in web_tryon/glb_file_example: the detection
 * recovers the correct pose under all 24 axis-aligned rotations of that mesh, and refuses
 * (leaving the file untouched) when the temples are cut off.
 */

/** Cap on sampled vertices. Detection is statistical; more points buy nothing. */
const MAX_SAMPLES = 30000;

/** Minimum depth-to-height ratio before the two axes can be told apart. */
const DEPTH_HEIGHT_RATIO = 1.6;

/** Minimum symmetry advantage the width axis must hold over its rival. */
const SYMMETRY_MARGIN = 0.05;

/** Minimum combined up-signal, as a fraction of the height extent. */
const UP_SIGNAL_MARGIN = 0.03;

/**
 * How deep "the frame front" reaches back from the frontmost point.
 *
 * A fraction of the depth alone lets flared temples into the slab and shrinks the frame:
 * on the procedural fallback, 30% of the depth reaches far enough back that the temples
 * have splayed 7% wider than the rims, and the fit would take that for the front width.
 * Capping it against the frame's own width keeps the slab on the plate, and the cap is
 * loose enough to hold the face-form curvature of a real front — measured on the sample
 * model, the front width moves 2% across a six-fold change in slab depth.
 */
const FRONT_SLAB_DEPTH_RATIO = 0.30;
const FRONT_SLAB_WIDTH_RATIO = 0.15;

export function frontSlabDepth(depthExtent: number, widthExtent: number): number {
  return Math.min(FRONT_SLAB_DEPTH_RATIO * depthExtent, FRONT_SLAB_WIDTH_RATIO * widthExtent);
}

export type FitConfidence = 'oriented' | 'assumed';

export interface FrameFitResult {
  /** True when the geometry was actually rotated into the convention. */
  reoriented: boolean;
  /** 'assumed' means the axes could not be told apart and the file's own were kept. */
  confidence: FitConfidence;
  /** Human-readable axis mapping, e.g. "width=Z up=+Y front=-X". */
  axisMapping: string;
  /** Frame front dimensions after fitting, in millimetres. */
  frontWidthMM: number;
  frontHeightMM: number;
  totalDepthMM: number;
  /** Uniform factor applied to the model. 1 when no target width was given. */
  scaleFactor: number;
  /**
   * Where the temple is meant to come to rest on the ear, in mm of fitted local space
   * (y from the pupil line, z from the pupil plane). Null when the temples carry no
   * readable bend. The try-on aims this point at the patient's own ear to set the tilt.
   */
  earRestMM: { y: number; z: number } | null;
  /** Why the fit degraded, when it did. Empty on a clean fit. */
  notes: string[];
}

/** Flat xyz triples. Kept flat because a 30k-element Vector3 array is pure garbage churn. */
export type Points = Float32Array;

/**
 * Samples every mesh under `model` into the model root's own coordinate space, baking in
 * the node transforms the file carries. Reading the raw attributes is not enough: a
 * generator commonly leaves the whole frame under a node with its own scale and offset.
 */
export function collectPoints(model: THREE.Object3D): Points {
  model.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(model.matrixWorld).invert();

  const meshes: THREE.Mesh[] = [];
  let total = 0;
  model.traverse((node) => {
    const mesh = node as THREE.Mesh;
    const attr = mesh.isMesh ? mesh.geometry?.getAttribute('position') : undefined;
    if (attr) {
      meshes.push(mesh);
      total += attr.count;
    }
  });
  if (total === 0) return new Float32Array(0);

  const stride = Math.max(1, Math.ceil(total / MAX_SAMPLES));
  const out = new Float32Array((Math.ceil(total / stride) + meshes.length) * 3);

  const v = new THREE.Vector3();
  const mtx = new THREE.Matrix4();
  let w = 0;
  for (const mesh of meshes) {
    mtx.multiplyMatrices(toLocal, mesh.matrixWorld);
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count && w + 3 <= out.length; i += stride) {
      v.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(mtx);
      out[w++] = v.x;
      out[w++] = v.y;
      out[w++] = v.z;
    }
  }
  return out.slice(0, w);
}

export interface Bounds {
  min: number[];
  max: number[];
  ext: number[];
  mid: number[];
}

export function bounds(pts: Points): Bounds {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const c = pts[i + a];
      if (c < min[a]) min[a] = c;
      if (c > max[a]) max[a] = c;
    }
  }
  const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const mid = [(max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2];
  return { min, max, ext, mid };
}

/**
 * How closely the distribution along one axis mirrors itself, in [0, 1].
 *
 * A histogram compared against its own reverse. 1 is perfect mirror symmetry — which is
 * what the left/right axis of a pair of glasses looks like, and what neither of the other
 * two does: the vertical profile is rim-heavy at the bottom and the depth profile piles
 * almost everything at the front.
 */
function symmetryScore(pts: Points, axis: number, bins = 24): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = axis; i < pts.length; i += 3) {
    if (pts[i] < lo) lo = pts[i];
    if (pts[i] > hi) hi = pts[i];
  }
  const span = hi - lo;
  if (!(span > 0)) return 0;

  const hist = new Float64Array(bins);
  let total = 0;
  for (let i = axis; i < pts.length; i += 3) {
    const b = Math.min(bins - 1, Math.floor(((pts[i] - lo) / span) * bins));
    hist[b]++;
    total++;
  }
  if (total === 0) return 0;

  let diff = 0;
  for (let b = 0; b < bins; b++) diff += Math.abs(hist[b] - hist[bins - 1 - b]);
  return 1 - diff / (2 * total);
}

/** Mean of one coordinate over the points a predicate accepts. NaN when none match. */
function meanWhere(pts: Points, axis: number, accept: (p: Float32Array) => boolean): number {
  const p = new Float32Array(3);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < pts.length; i += 3) {
    p[0] = pts[i];
    p[1] = pts[i + 1];
    p[2] = pts[i + 2];
    if (accept(p)) {
      sum += p[axis];
      n++;
    }
  }
  return n === 0 ? NaN : sum / n;
}

/** Number of sampled points whose coordinate on `axis` falls inside [lo, hi]. */
function countInSlab(pts: Points, axis: number, lo: number, hi: number): number {
  let n = 0;
  for (let i = axis; i < pts.length; i += 3) if (pts[i] >= lo && pts[i] <= hi) n++;
  return n;
}

export interface Orientation {
  width: number;
  height: number;
  depth: number;
  forwardSign: 1 | -1;
  upSign: 1 | -1;
  confidence: FitConfidence;
  notes: string[];
}

export function detectOrientation(pts: Points): Orientation {
  const notes: string[] = [];
  const b = bounds(pts);
  const identity: Orientation = {
    width: 0,
    height: 1,
    depth: 2,
    forwardSign: 1,
    upSign: 1,
    confidence: 'assumed',
    notes,
  };

  const sym = [symmetryScore(pts, 0), symmetryScore(pts, 1), symmetryScore(pts, 2)];
  const maxExt = Math.max(b.ext[0], b.ext[1], b.ext[2]);
  if (!(maxExt > 0)) {
    notes.push('the model has no measurable size');
    return identity;
  }

  // The width axis is one of the two long ones — a frame is never widest across its
  // height — so the short axis is excluded before the symmetry vote is taken.
  let large = [0, 1, 2].filter((a) => b.ext[a] >= 0.5 * maxExt);
  if (large.length < 2) {
    large = [0, 1, 2].sort((p, q) => b.ext[q] - b.ext[p]).slice(0, 2);
  }
  const ranked = [...large].sort((p, q) => sym[q] - sym[p]);
  const width = ranked[0];
  if (sym[ranked[0]] - sym[ranked[1]] < SYMMETRY_MARGIN) {
    notes.push(
      `left/right axis is not distinguishable (symmetry ${sym.map((s) => s.toFixed(2)).join('/')})`
    );
    return identity;
  }

  const rest = [0, 1, 2].filter((a) => a !== width);
  const height = b.ext[rest[0]] < b.ext[rest[1]] ? rest[0] : rest[1];
  const depth = rest[0] === height ? rest[1] : rest[0];

  if (b.ext[depth] < DEPTH_HEIGHT_RATIO * b.ext[height]) {
    notes.push(
      'height and depth are too close to tell apart ' +
        `(${(b.ext[height] * 1000).toFixed(0)} mm vs ${(b.ext[depth] * 1000).toFixed(0)} mm) — ` +
        'temples missing or folded'
    );
    return identity;
  }

  // The front is a plate, the temples are two rods: whichever end of the depth axis holds
  // more vertices in its outer slab is the front.
  const slab = 0.15 * b.ext[depth];
  const nearMin = countInSlab(pts, depth, b.min[depth], b.min[depth] + slab);
  const nearMax = countInSlab(pts, depth, b.max[depth] - slab, b.max[depth]);
  const forwardSign: 1 | -1 = nearMax >= nearMin ? 1 : -1;

  // Up carries two independent votes, both measured against the vertical centre of the
  // bounding box: the temples run back above it, and the bridge sits above the nose notch
  // in the middle of the front. Either alone is a small margin; together they are not.
  const depthMid = b.mid[depth];
  const rearMean = meanWhere(pts, height, (p) =>
    forwardSign === 1 ? p[depth] < depthMid : p[depth] > depthMid
  );
  const slabDepth = frontSlabDepth(b.ext[depth], b.ext[width]);
  const frontEdge =
    forwardSign === 1 ? b.max[depth] - slabDepth : b.min[depth] + slabDepth;
  const bridgeMean = meanWhere(pts, height, (p) => {
    const inFront = forwardSign === 1 ? p[depth] >= frontEdge : p[depth] <= frontEdge;
    return inFront && Math.abs(p[width] - b.mid[width]) < 0.1 * b.ext[width];
  });

  const vote = (mean: number) =>
    Number.isFinite(mean) ? (mean - b.mid[height]) / b.ext[height] : 0;
  const upSignal = vote(rearMean) + vote(bridgeMean);

  let upSign: 1 | -1 = upSignal >= 0 ? 1 : -1;
  if (Math.abs(upSignal) < UP_SIGNAL_MARGIN) {
    notes.push(`up/down is not distinguishable (signal ${upSignal.toFixed(3)}) — axis kept as-is`);
    upSign = 1;
  }

  return { width, height, depth, forwardSign, upSign, confidence: 'oriented', notes };
}

const AXIS_NAME = ['X', 'Y', 'Z'];

function axisVector(axis: number, sign: number): THREE.Vector3 {
  return new THREE.Vector3().setComponent(axis, sign);
}

export interface FitOptions {
  /** Total width of the frame FRONT, in millimetres. Omit to leave the scale untouched. */
  targetWidthMM?: number;
  /**
   * The lens opening, in the model's own units and canonical axes, as `frame_metrology`
   * measured it. Supplying it is what makes the vertical placement mean what the clinical
   * convention says it means — see `pupilHeightRatio` below. Omit it and the placement
   * falls back to the front's bounding box, which is a different and larger quantity.
   */
  aperture?: { bottomY: number; height: number };
}

/**
 * Rewrites `model.position`, `.quaternion` and `.scale` so the frame sits in the
 * convention documented at the top of this file. The geometry itself is never touched, so
 * re-fitting the same object is idempotent and a failed fit costs nothing.
 */
export function fitFrameToFaceConvention(
  model: THREE.Object3D,
  opts: FitOptions = {}
): FrameFitResult {
  const raw = collectPoints(model);

  if (raw.length < 9) {
    return {
      reoriented: false,
      confidence: 'assumed',
      axisMapping: 'width=X up=+Y front=+Z',
      frontWidthMM: 0,
      frontHeightMM: 0,
      totalDepthMM: 0,
      scaleFactor: 1,
      earRestMM: null,
      notes: ['the model carries no geometry to measure'],
    };
  }

  const o = detectOrientation(raw);
  const notes = [...o.notes];

  const upDir = axisVector(o.height, o.upSign);
  const fwdDir = axisVector(o.depth, o.forwardSign);
  // Right is derived rather than detected: X = Y x Z is what keeps the basis right-handed,
  // and a basis that is not right-handed mirrors the frame — swapping the patient's left
  // and right lens, which is the one error an optical try-on must never make.
  const rightDir = new THREE.Vector3().crossVectors(upDir, fwdDir);

  const basis = new THREE.Matrix4().makeBasis(rightDir, upDir, fwdDir);
  // makeBasis maps canonical -> model, and the model needs the opposite direction.
  const rotation = new THREE.Quaternion().setFromRotationMatrix(basis).invert();
  const reoriented =
    o.confidence === 'oriented' &&
    !(o.width === 0 && o.height === 1 && o.depth === 2 && o.forwardSign === 1 && o.upSign === 1);

  // Re-measure in the canonical frame. Everything from here on is in convention axes.
  const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(rotation);
  const pts = new Float32Array(raw.length);
  const v = new THREE.Vector3();
  for (let i = 0; i < raw.length; i += 3) {
    v.set(raw[i], raw[i + 1], raw[i + 2]).applyMatrix4(rotMatrix);
    pts[i] = v.x;
    pts[i + 1] = v.y;
    pts[i + 2] = v.z;
  }

  const b = bounds(pts);

  // The frame FRONT, not the whole bounding box, is what the SKU's total width refers to
  // and what has to be centred on the face — temples flare wider and hang further down.
  const frontEdge = b.max[2] - Math.max(frontSlabDepth(b.ext[2], b.ext[0]), 1e-4);
  let fMinX = Infinity;
  let fMaxX = -Infinity;
  let fMinY = Infinity;
  let fMaxY = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    if (pts[i + 2] < frontEdge) continue;
    if (pts[i] < fMinX) fMinX = pts[i];
    if (pts[i] > fMaxX) fMaxX = pts[i];
    if (pts[i + 1] < fMinY) fMinY = pts[i + 1];
    if (pts[i + 1] > fMaxY) fMaxY = pts[i + 1];
  }
  if (!Number.isFinite(fMinX)) {
    fMinX = b.min[0];
    fMaxX = b.max[0];
    fMinY = b.min[1];
    fMaxY = b.max[1];
  }

  const frontWidth = fMaxX - fMinX;
  const frontHeight = fMaxY - fMinY;

  let scale = 1;
  const target = opts.targetWidthMM;
  if (target && target > 0) {
    if (frontWidth > 1e-6) {
      scale = target / 1000 / frontWidth;
    } else {
      notes.push('the frame front has no measurable width; the scale was left alone');
    }
  }

  // y = 0 is the PUPIL LINE, and `pupilHeightRatio` is defined against the LENS OPENING:
  //     fitting height = pupilHeightRatio x B, measured up from the bottom of the groove.
  // So the opening's bottom is placed exactly that far below the pupil. Using the front's
  // bounding box instead — which is what this did before the metrology existed — measures
  // a different and larger thing: on the sample frame the box is 39.8 mm against a 29.5 mm
  // opening, so the ratio was arriving mis-scaled by 1.35x and the constant did not move
  // the frame by anything like the amount it claimed to.
  const ratio = FITTING_CONFIG.frameGeometry.pupilHeightRatio;
  const ap = opts.aperture;
  let originY: number;
  if (ap && ap.height > 1e-6) {
    originY = -(ratio * ap.height * scale) - ap.bottomY * scale;
  } else {
    // No readable opening (a solid front, or lenses modelled in). The bounding box is the
    // only thing left, and it is the pre-metrology behaviour.
    notes.push('no lens opening to place against; the vertical fit used the front box');
    originY = -(ratio - 0.5) * frontHeight * scale - ((fMinY + fMaxY) / 2) * scale;
  }
  const frontZ = FITTING_CONFIG.vtoPlacement.frontPlaneAheadOfPupilMM / 1000;

  model.quaternion.copy(rotation);
  model.scale.setScalar(scale);
  model.position.set(
    -((fMinX + fMaxX) / 2) * scale,
    originY,
    frontZ - b.max[2] * scale
  );
  model.updateMatrixWorld(true);

  const offsetY = originY;
  const offsetZ = frontZ - b.max[2] * scale;
  const earRestMM = findEarRest(
    pts, scale,
    -((fMinX + fMaxX) / 2) * scale, offsetY, offsetZ,
    frontWidth * scale, frontHeight * scale, b.ext[2] * scale
  );
  if (!earRestMM) notes.push('the temples have no readable bend, so the frame cannot be tilted onto the ears');

  const sign = (s: number) => (s > 0 ? '+' : '-');
  return {
    reoriented,
    confidence: o.confidence,
    axisMapping:
      `width=${AXIS_NAME[o.width]} ` +
      `up=${sign(o.upSign)}${AXIS_NAME[o.height]} ` +
      `front=${sign(o.forwardSign)}${AXIS_NAME[o.depth]}`,
    frontWidthMM: frontWidth * scale * 1000,
    frontHeightMM: frontHeight * scale * 1000,
    totalDepthMM: b.ext[2] * scale * 1000,
    scaleFactor: scale,
    earRestMM,
    notes,
  };
}

/**
 * Where along the temples the frame is meant to come to rest on the ear, in millimetres of
 * the fitted local space (so y is measured from the pupil line and z from the pupil plane).
 *
 * A temple is a straight rod that runs back level with the brow and then turns sharply
 * down behind the ear. The point of contact is the last of the level part — everything
 * past it is the hook, which tucks behind the ear rather than sitting on it. So the
 * underside of the temple is followed backwards, and the answer is the last depth at which
 * it has not yet started to fall away.
 *
 * The frame's pitch is set by aiming this point at the patient's own ear, which is the
 * whole reason it is worth finding: a frame anchored only at the pupils has nothing
 * deciding its tilt, and its temples end up running off into the air above the ears.
 */
function findEarRest(
  pts: Points, scale: number,
  offX: number, offY: number, offZ: number,
  frontWidth: number, frontHeight: number, totalDepth: number
): { y: number; z: number } | null {
  const halfWidth = frontWidth / 2;
  if (!(halfWidth > 0) || !(totalDepth > 0) || !(frontHeight > 0)) return null;

  // Temples only: out at the sides, and behind the end piece.
  const minAbsX = 0.55 * halfWidth;
  const frontEdgeZ = offZ + 0 - 0.25 * totalDepth; // measured back from the front plane
  const BINS = 24;
  const slabZ = totalDepth / BINS;
  const underside = new Float64Array(BINS).fill(Infinity);

  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i] * scale + offX;
    const y = pts[i + 1] * scale + offY;
    const z = pts[i + 2] * scale + offZ;
    if (Math.abs(x) < minAbsX || z > frontEdgeZ) continue;
    const bin = Math.min(BINS - 1, Math.max(0, Math.floor((offZ - z) / slabZ)));
    if (y < underside[bin]) underside[bin] = y;
  }

  const filled: number[] = [];
  for (let b = 0; b < BINS; b++) if (isFinite(underside[b])) filled.push(b);
  if (filled.length < 4) return null;

  // The level run, taken from the first few populated slabs behind the end piece.
  const head = filled.slice(0, 3).map((b) => underside[b]).sort((p, q) => p - q);
  const level = head[Math.floor(head.length / 2)];
  const dropTolerance = 0.15 * frontHeight;

  let contact = filled[0];
  for (const b of filled) {
    if (underside[b] < level - dropTolerance) break;
    contact = b;
  }
  // A bend that never happens (a straight temple with no hook) leaves the contact at the
  // very end, which is still the right answer: that IS where such a temple meets the ear.
  return {
    y: underside[contact] * 1000,
    z: (offZ - (contact + 0.5) * slabZ) * 1000,
  };
}

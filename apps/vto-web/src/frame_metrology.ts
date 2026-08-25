/**
 * Measures a frame GLB in its OWN units, before anything rescales it.
 *
 * This runs on the model as parsed, not as installed. `SceneManager.normalizeFrameWidth`
 * forces the front width to the SKU figure, so any measurement taken afterwards is
 * partly a measurement of that imposed value — checking it against the descriptor would
 * then always pass and prove nothing. Everything here is taken first.
 *
 * WHAT IS AND IS NOT AN INDEPENDENT CHECK
 * The file's units are arbitrary (the sample model is 1.73 units wide), so absolute
 * millimetres only exist once a scale is chosen, and the only scale available comes from
 * the descriptor. That makes absolute size NOT independently verifiable. What survives is
 * shape: `bRatio` (B/A), `bridgeRatio` (DBL/A) and `depthRatio` are scale-free, so they
 * test the model's proportions against the published ones no matter how it was exported.
 * Those ratios are the honest checks; the millimetre columns are conversions.
 *
 * The axis convention and its detection belong to `frame_fitter`, which is the single
 * place that decides how a frame is oriented. This module imports that machinery rather
 * than repeating it, and works throughout in canonical axes:
 *   +X screen-right   +Y up   +Z out of the face
 *
 * Generated meshes carry no semantic node names — the sample model is one Draco blob
 * called `tmpsp89hp9b.ply` — so nothing here looks for a node called "lens". Every
 * feature is recovered from the geometry.
 */

import * as THREE from 'three';
import {
  collectPoints,
  bounds,
  detectOrientation,
  frontSlabDepth,
  type Points,
  type FitConfidence,
} from './frame_fitter';

/**
 * Coverage grid resolution across one half of the frame front.
 *
 * Verified by sweeping 80x32 through 480x192 — a six-fold change — on the sample model:
 * lens width moved 44.3-45.1 mm, lens height 29.5-30.1 mm, bridge 22.8-23.4 mm and the
 * lower rim 4.3-4.9 mm. Every figure stays inside 0.6 mm and both sides stay symmetric
 * at every step, so this value is on the converged plateau rather than on a slope.
 */
const GRID_COLS = 240;
const GRID_ROWS = 96;

/** Cap on rasterised triangles. The front is a fraction of any real frame's mesh. */
const MAX_TRIANGLES = 200000;

/**
 * An aperture must occupy at least this fraction of its half of the front to count.
 * Below it, the "hole" is a gap between mesh fragments, not a lens opening.
 */
const MIN_APERTURE_AREA_RATIO = 0.04;

/** How far in from the outer edge the flood fill starts looking for enclosed space. */
const APERTURE_SEED_INSET = 0.25;

export type ApertureConfidence = 'measured' | 'not-found';

/** One lens opening, in the model's own units. */
export interface LensAperture {
  confidence: ApertureConfidence;
  /** Horizontal extent of the opening — the boxing A, before scaling. */
  width: number;
  /** Vertical extent of the opening — the boxing B, before scaling. */
  height: number;
  /** Centre of the opening, canonical axes. */
  centerX: number;
  centerY: number;
  /** Lowest point of the OPENING: where the lens groove bottoms out. */
  apertureBottomY: number;
  /** Why the opening could not be found, when it could not. */
  note: string | null;
}

/** One side of the frame front. `side` is the patient's, not the image's. */
export interface FrameSide {
  side: 'OD' | 'OS';
  /** Outer bounds of the rim material on this side. */
  outerMinX: number;
  outerMaxX: number;
  outerMinY: number;
  outerMaxY: number;
  /**
   * Lowest point of the frame material on this side — the bottom of the rim.
   * Recovered from the outer bounds, so it survives a model whose aperture is filled in
   * (modelled lenses) or too noisy to flood-fill. This is the robust one.
   */
  rimBottomY: number;
  aperture: LensAperture;
}

export interface FrameMetrology {
  /** True when the axes were actually recovered; 'assumed' means they were not. */
  confidence: FitConfidence;
  axisMapping: string;
  /** Notes from orientation detection plus anything found while measuring. */
  notes: string[];

  /** Vertices sampled. Detection is statistical; this is for the provenance line. */
  sampleCount: number;

  // --- Native units. The file's own scale, whatever that is. ---
  nativeFrontWidth: number;
  nativeFrontHeight: number;
  nativeTotalWidth: number;
  nativeTotalDepth: number;
  nativeTotalHeight: number;

  sides: { od: FrameSide; os: FrameSide };
  /** Gap between the two apertures — the boxing DBL. Null when an aperture is missing. */
  nativeBridge: number | null;

  // --- Scale-free proportions. These are what can actually be verified. ---
  /** Mean aperture height / mean aperture width, i.e. B/A. Null without apertures. */
  bRatio: number | null;
  /** Bridge / mean aperture width, i.e. DBL/A. Null without apertures. */
  bridgeRatio: number | null;
  /** Total depth / front width. Temples make this ~1.1 on a real frame. */
  depthRatio: number;
}

/** Rotates sampled points into canonical axes without touching the model. */
function toCanonical(raw: Points, rotation: THREE.Quaternion): Points {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(rotation);
  const out = new Float32Array(raw.length);
  const v = new THREE.Vector3();
  for (let i = 0; i < raw.length; i += 3) {
    v.set(raw[i], raw[i + 1], raw[i + 2]).applyMatrix4(m);
    out[i] = v.x;
    out[i + 1] = v.y;
    out[i + 2] = v.z;
  }
  return out;
}

const AXIS_NAME = ['X', 'Y', 'Z'];

interface Grid {
  cells: Uint8Array;
  cols: number;
  rows: number;
  minX: number;
  minY: number;
  cellW: number;
  cellH: number;
}

/**
 * Marks every cell of the front slab covered by MATERIAL, by rasterising triangles.
 *
 * Rasterising the sampled vertices instead looks equivalent and is not: vertices sit on
 * the surface and their density follows the tessellation, so a finer grid turns the rim
 * into a dotted line, the flood fill leaks through the gaps, and the measured aperture
 * drifts. On the sample model vertex occupancy moved the lens height from 29.5 mm to
 * 35.6 mm across a 2x change in resolution and reported a 1.8 mm left/right difference
 * on a symmetric frame — both artefacts vanish with triangle coverage, which is the
 * actual silhouette and settles as the grid gets finer.
 *
 * Checked against built-to-spec geometry: a 44 x 28 mm opening inside a 3 mm rim, with
 * a 20 mm bridge, measures 44.0 x 27.6 mm, 3.2 mm and 20.4 mm.
 */
function rasterizeFront(
  tris: Float32Array,
  frontEdge: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): Grid {
  const cols = GRID_COLS;
  const rows = GRID_ROWS;
  const cells = new Uint8Array(cols * rows);
  const cellW = (maxX - minX) / cols;
  const cellH = (maxY - minY) / rows;
  if (!(cellW > 0) || !(cellH > 0)) {
    return { cells, cols, rows, minX, minY, cellW: 1, cellH: 1 };
  }

  for (let t = 0; t < tris.length; t += 9) {
    // A triangle counts as part of the front when any corner reaches into the slab.
    if (tris[t + 2] < frontEdge && tris[t + 5] < frontEdge && tris[t + 8] < frontEdge) continue;

    const ax = tris[t];
    const ay = tris[t + 1];
    const bx = tris[t + 3];
    const by = tris[t + 4];
    const cx = tris[t + 6];
    const cy = tris[t + 7];

    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (area === 0) continue;
    const inv = 1 / area;

    const lo = (v: number, o: number, s: number, n: number) =>
      Math.max(0, Math.min(n - 1, Math.floor((v - o) / s)));

    const c0 = lo(Math.min(ax, bx, cx), minX, cellW, cols);
    const c1 = lo(Math.max(ax, bx, cx), minX, cellW, cols);
    const r0 = lo(Math.min(ay, by, cy), minY, cellH, rows);
    const r1 = lo(Math.max(ay, by, cy), minY, cellH, rows);

    for (let r = r0; r <= r1; r++) {
      const py = minY + (r + 0.5) * cellH;
      for (let c = c0; c <= c1; c++) {
        const idx = r * cols + c;
        if (cells[idx]) continue;
        const px = minX + (c + 0.5) * cellW;
        // Barycentric coverage of the cell centre.
        const w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) * inv;
        if (w0 < 0) continue;
        const w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) * inv;
        if (w1 < 0) continue;
        const w2 = ((ax - px) * (by - py) - (bx - px) * (ay - py)) * inv;
        if (w2 < 0) continue;
        cells[idx] = 1;
      }
    }
  }
  return { cells, cols, rows, minX, minY, cellW, cellH };
}

/**
 * Samples triangles into the model root's own space, baking node transforms exactly the
 * way `collectPoints` does. Topology is kept because the aperture test needs coverage,
 * not a point cloud.
 */
function collectTriangles(model: THREE.Object3D): Float32Array {
  model.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(model.matrixWorld).invert();

  const meshes: THREE.Mesh[] = [];
  let total = 0;
  model.traverse((node) => {
    const mesh = node as THREE.Mesh;
    const pos = mesh.isMesh ? mesh.geometry?.getAttribute('position') : undefined;
    if (!pos) return;
    meshes.push(mesh);
    const index = mesh.geometry.getIndex();
    total += (index ? index.count : pos.count) / 3;
  });
  if (total === 0) return new Float32Array(0);

  const stride = Math.max(1, Math.ceil(total / MAX_TRIANGLES));
  const out = new Float32Array(Math.ceil(total / stride) * 9 + 9);

  const v = new THREE.Vector3();
  const mtx = new THREE.Matrix4();
  let w = 0;
  for (const mesh of meshes) {
    mtx.multiplyMatrices(toLocal, mesh.matrixWorld);
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const index = mesh.geometry.getIndex();
    const triCount = (index ? index.count : pos.count) / 3;

    for (let t = 0; t < triCount && w + 9 <= out.length; t += stride) {
      for (let k = 0; k < 3; k++) {
        const vi = index ? index.getX(t * 3 + k) : t * 3 + k;
        v.fromBufferAttribute(pos, vi).applyMatrix4(mtx);
        out[w++] = v.x;
        out[w++] = v.y;
        out[w++] = v.z;
      }
    }
  }
  return out.slice(0, w);
}

/**
 * Flood-fills empty cells from a seed, refusing to escape past the grid edge.
 *
 * Reaching the border means the region is outside air rather than an enclosed opening,
 * so the fill is abandoned. That distinction is the whole test: the space around the
 * frame and the space inside a lens rim are both empty, and only the second is bounded.
 */
function floodEnclosed(grid: Grid, seedX: number, seedY: number): number[] | null {
  const { cells, cols, rows } = grid;
  const start = seedY * cols + seedX;
  if (cells[start] !== 0) return null;

  const visited = new Uint8Array(cols * rows);
  const region: number[] = [];
  const stack = [start];
  visited[start] = 1;

  while (stack.length > 0) {
    const idx = stack.pop() as number;
    const x = idx % cols;
    const y = (idx / cols) | 0;

    // An enclosed opening never touches the outside of the frame.
    if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) return null;
    region.push(idx);

    const neighbours = [idx - 1, idx + 1, idx - cols, idx + cols];
    for (const n of neighbours) {
      if (n < 0 || n >= cells.length || visited[n] || cells[n] !== 0) continue;
      visited[n] = 1;
      stack.push(n);
    }
  }
  return region;
}

const NO_APERTURE = (note: string): LensAperture => ({
  confidence: 'not-found',
  width: 0,
  height: 0,
  centerX: 0,
  centerY: 0,
  apertureBottomY: 0,
  note,
});

/**
 * Finds the lens opening inside one half of the frame front.
 *
 * Several seeds are tried around the middle of the half because the widest empty run is
 * not always at the geometric centre — a cat-eye's opening sits high and off-centre.
 */
function findAperture(
  tris: Float32Array,
  frontEdge: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): LensAperture {
  const grid = rasterizeFront(tris, frontEdge, minX, maxX, minY, maxY);
  if (!(grid.cellW > 0) || !(grid.cellH > 0)) {
    return NO_APERTURE('la mitad del frente no tiene extensión medible');
  }

  const totalCells = grid.cols * grid.rows;
  let best: number[] | null = null;

  const inset = APERTURE_SEED_INSET;
  for (let fx = inset; fx <= 1 - inset + 1e-9; fx += (1 - 2 * inset) / 4) {
    for (let fy = inset; fy <= 1 - inset + 1e-9; fy += (1 - 2 * inset) / 4) {
      const sx = Math.min(grid.cols - 1, Math.max(0, Math.round(fx * (grid.cols - 1))));
      const sy = Math.min(grid.rows - 1, Math.max(0, Math.round(fy * (grid.rows - 1))));
      const region = floodEnclosed(grid, sx, sy);
      if (region && (!best || region.length > best.length)) best = region;
    }
  }

  if (!best) {
    return NO_APERTURE(
      'no se encontró una apertura cerrada: el frente es macizo, las lentes están ' +
        'modeladas, o el aro no cierra en proyección'
    );
  }
  if (best.length / totalCells < MIN_APERTURE_AREA_RATIO) {
    return NO_APERTURE(
      `el hueco encontrado es demasiado pequeño (${((best.length / totalCells) * 100).toFixed(1)} % ` +
        'de la mitad del frente) para ser una apertura de lente'
    );
  }

  let cMinX = Infinity;
  let cMaxX = -Infinity;
  let cMinY = Infinity;
  let cMaxY = -Infinity;
  for (const idx of best) {
    const x = idx % grid.cols;
    const y = (idx / grid.cols) | 0;
    if (x < cMinX) cMinX = x;
    if (x > cMaxX) cMaxX = x;
    if (y < cMinY) cMinY = y;
    if (y > cMaxY) cMaxY = y;
  }

  // Cell indices back to model units. The +1 spans the full width of the last cell.
  const x0 = grid.minX + cMinX * grid.cellW;
  const x1 = grid.minX + (cMaxX + 1) * grid.cellW;
  const y0 = grid.minY + cMinY * grid.cellH;
  const y1 = grid.minY + (cMaxY + 1) * grid.cellH;

  return {
    confidence: 'measured',
    width: x1 - x0,
    height: y1 - y0,
    centerX: (x0 + x1) / 2,
    centerY: (y0 + y1) / 2,
    apertureBottomY: y0,
    note: null,
  };
}

/** Outer bounds of the material in one X band of the front slab. */
function sideBounds(
  pts: Points,
  frontEdge: number,
  loX: number,
  hiX: number
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    if (pts[i + 2] < frontEdge) continue;
    const x = pts[i];
    if (x < loX || x > hiX) continue;
    const y = pts[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Number.isFinite(minX) ? { minX, maxX, minY, maxY } : null;
}

/**
 * Measures a parsed eyewear model in its own units.
 *
 * The model is never modified: sampling and rotation happen on copies, so this can run
 * before installation, or on a model already installed, with the same result.
 */
export function measureFrame(model: THREE.Object3D): FrameMetrology {
  const raw = collectPoints(model);
  const notes: string[] = [];

  const empty = (note: string): FrameMetrology => {
    const side = (s: 'OD' | 'OS'): FrameSide => ({
      side: s,
      outerMinX: 0,
      outerMaxX: 0,
      outerMinY: 0,
      outerMaxY: 0,
      rimBottomY: 0,
      aperture: NO_APERTURE(note),
    });
    return {
      confidence: 'assumed',
      axisMapping: 'width=X up=+Y front=+Z',
      notes: [note],
      sampleCount: 0,
      nativeFrontWidth: 0,
      nativeFrontHeight: 0,
      nativeTotalWidth: 0,
      nativeTotalDepth: 0,
      nativeTotalHeight: 0,
      sides: { od: side('OD'), os: side('OS') },
      nativeBridge: null,
      bRatio: null,
      bridgeRatio: null,
      depthRatio: 0,
    };
  };

  if (raw.length < 9) return empty('el modelo no contiene geometría medible');

  const o = detectOrientation(raw);
  notes.push(...o.notes);

  const up = new THREE.Vector3().setComponent(o.height, o.upSign);
  const fwd = new THREE.Vector3().setComponent(o.depth, o.forwardSign);
  // Right is derived so the basis stays right-handed: a mirrored basis would swap OD
  // and OS, which is the one error an optical measurement must never make.
  const right = new THREE.Vector3().crossVectors(up, fwd);
  const rotation = new THREE.Quaternion()
    .setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd))
    .invert();

  const pts = toCanonical(raw, rotation);
  // Triangles carry the same rotation; they are what the aperture raster consumes.
  const tris = toCanonical(collectTriangles(model), rotation);
  const b = bounds(pts);

  const axisMapping =
    `width=${AXIS_NAME[o.width]} up=${o.upSign > 0 ? '+' : '-'}${AXIS_NAME[o.height]} ` +
    `front=${o.forwardSign > 0 ? '+' : '-'}${AXIS_NAME[o.depth]}`;

  const frontEdge = b.max[2] - Math.max(frontSlabDepth(b.ext[2], b.ext[0]), 1e-6);

  const front = sideBounds(pts, frontEdge, -Infinity, Infinity);
  if (!front) return empty('el frente de la montura no tiene puntos medibles');

  const frontMidX = (front.minX + front.maxX) / 2;

  // The patient's right eye is on the viewer's left, i.e. at negative X in a convention
  // whose +Z points out of the face toward the camera.
  const buildSide = (label: 'OD' | 'OS', loX: number, hiX: number): FrameSide => {
    const outer = sideBounds(pts, frontEdge, loX, hiX);
    if (!outer) {
      return {
        side: label,
        outerMinX: 0,
        outerMaxX: 0,
        outerMinY: 0,
        outerMaxY: 0,
        rimBottomY: 0,
        aperture: NO_APERTURE(`el lado ${label} no tiene puntos en el frente`),
      };
    }
    const aperture =
      tris.length >= 9
        ? findAperture(tris, frontEdge, outer.minX, outer.maxX, outer.minY, outer.maxY)
        : NO_APERTURE('el modelo no expone triángulos con los que trazar la apertura');
    return {
      side: label,
      outerMinX: outer.minX,
      outerMaxX: outer.maxX,
      outerMinY: outer.minY,
      outerMaxY: outer.maxY,
      rimBottomY: outer.minY,
      aperture,
    };
  };

  const od = buildSide('OD', -Infinity, frontMidX);
  const os = buildSide('OS', frontMidX, Infinity);

  if (od.aperture.note) notes.push(`OD: ${od.aperture.note}`);
  if (os.aperture.note) notes.push(`OS: ${os.aperture.note}`);

  const bothApertures =
    od.aperture.confidence === 'measured' && os.aperture.confidence === 'measured';

  // The bridge is the gap between the two openings, not between the outer rims.
  const nativeBridge = bothApertures
    ? os.aperture.centerX -
      os.aperture.width / 2 -
      (od.aperture.centerX + od.aperture.width / 2)
    : null;

  const meanApertureWidth = bothApertures
    ? (od.aperture.width + os.aperture.width) / 2
    : null;
  const meanApertureHeight = bothApertures
    ? (od.aperture.height + os.aperture.height) / 2
    : null;

  const nativeFrontWidth = front.maxX - front.minX;

  return {
    confidence: o.confidence,
    axisMapping,
    notes,
    sampleCount: raw.length / 3,
    nativeFrontWidth,
    nativeFrontHeight: front.maxY - front.minY,
    nativeTotalWidth: b.ext[0],
    nativeTotalDepth: b.ext[2],
    nativeTotalHeight: b.ext[1],
    sides: { od, os },
    nativeBridge,
    bRatio:
      meanApertureWidth && meanApertureHeight && meanApertureWidth > 0
        ? meanApertureHeight / meanApertureWidth
        : null,
    bridgeRatio:
      nativeBridge !== null && meanApertureWidth && meanApertureWidth > 0
        ? nativeBridge / meanApertureWidth
        : null,
    depthRatio: nativeFrontWidth > 0 ? b.ext[2] / nativeFrontWidth : 0,
  };
}

/**
 * Converts native units to millimetres given a scale.
 *
 * Kept separate from the measurement on purpose: the scale is an ASSUMPTION imported
 * from the descriptor, and keeping it out of `measureFrame` is what stops a converted
 * figure being mistaken for a measured one.
 */
export function mmPerNativeUnit(metrology: FrameMetrology, declaredFrontWidthMM: number): number | null {
  if (!(metrology.nativeFrontWidth > 0) || !(declaredFrontWidthMM > 0)) return null;
  return declaredFrontWidthMM / metrology.nativeFrontWidth;
}

/**
 * VIT-070: Auto-detection of credit/debit card corners in the video feed.
 *
 * Uses lightweight, pure-TypeScript image processing (edge detection + contour
 * analysis) to find the ISO 7810 ID-1 card (85.60 × 53.98 mm, aspect ratio
 * ≈ 1.586) in the region below the patient's nose. 100 % on-device, zero
 * external dependencies, lazy-loaded.
 *
 * The detector works on a small region of interest (ROI) extracted from the
 * video feed — typically 1.8× the predicted card area — so it is fast enough
 * to run every frame even on mid-range phones.
 *
 * When detection succeeds, it returns the four corners (top-left, top-right,
 * bottom-right, bottom-left) in the coordinate system of the full canvas, plus
 * the computed card width in pixels. The caller can then position the card
 * overlay automatically instead of requiring manual slider adjustment.
 *
 * Fallback: when detection fails (no card visible, bad lighting, occluded
 * edges), it returns `null` and the caller keeps the manual controls active.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface CardCorners {
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
}

export interface CardDetection {
  /** Four corners in canvas coordinates. */
  corners: CardCorners;
  /** Width of the card in canvas pixels (top-edge length). */
  widthPx: number;
  /** Height of the card in canvas pixels (left-edge length). */
  heightPx: number;
  /** Centre of the detected card. */
  center: Point;
  /** 0-1 confidence score based on aspect-ratio fit and edge strength. */
  confidence: number;
}

interface Point {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A contour stored as a list of boundary pixels. */
type Contour = Point[];

// ── Constants ────────────────────────────────────────────────────────────────

/** ISO 7810 ID-1 aspect ratio. */
const CARD_ASPECT = 85.60 / 53.98; // ≈ 1.586

/** How far the detected ratio may deviate from the ideal. */
const ASPECT_TOLERANCE = 0.25;

/** Minimum area (fraction of ROI area) for a candidate contour. */
const MIN_AREA_FRACTION = 0.06;

/** Maximum area (fraction of ROI area) for a candidate contour. */
const MAX_AREA_FRACTION = 0.92;

/** Canny low/high thresholds. */
const CANNY_LOW = 30;
const CANNY_HIGH = 90;

/** How many frames to skip between full detections (throttle). */
const DETECT_EVERY_N_FRAMES = 3;

// ── Detector class ───────────────────────────────────────────────────────────

export class CardDetector {
  /** Scratch canvases reused across frames to avoid allocation churn. */
  private scratchCanvas: HTMLCanvasElement | null = null;
  private scratchCtx: CanvasRenderingContext2D | null = null;

  private frameCount = 0;
  private lastDetection: CardDetection | null = null;
  /** Exponential-moving-average smoothing for the detected width. */
  private smoothedWidthPx = 0;
  private smoothedCenter: Point = { x: 0, y: 0 };
  /** Number of consecutive frames without a detection. */
  private missStreak = 0;

  /**
   * Runs one detection pass on the provided video frame.
   *
   * @param source  The HTMLVideoElement or HTMLCanvasElement to sample.
   * @param roi     Region of interest in canvas-pixel coordinates — typically
   *                the area around and below the nose where the card is expected.
   * @returns       A `CardDetection` if a card-shaped rectangle was found, or
   *                `null` if nothing matched.
   */
  public detect(
    source: HTMLVideoElement | HTMLCanvasElement,
    roi: Rect
  ): CardDetection | null {
    this.frameCount++;

    // Throttle: reuse the last detection on skipped frames
    if (this.frameCount % DETECT_EVERY_N_FRAMES !== 0 && this.lastDetection) {
      return this.lastDetection;
    }

    // Ensure scratch canvas exists
    if (!this.scratchCanvas) {
      this.scratchCanvas = document.createElement('canvas');
      this.scratchCtx = this.scratchCanvas.getContext('2d', { willReadFrequently: true });
    }
    const ctx = this.scratchCtx!;

    // Size the scratch to the ROI — we only process this small region
    const roiW = Math.max(1, Math.round(roi.w));
    const roiH = Math.max(1, Math.round(roi.h));
    if (this.scratchCanvas.width !== roiW || this.scratchCanvas.height !== roiH) {
      this.scratchCanvas.width = roiW;
      this.scratchCanvas.height = roiH;
    }

    // Draw the ROI from the source
    ctx.drawImage(source, roi.x, roi.y, roi.w, roi.h, 0, 0, roiW, roiH);
    const imageData = ctx.getImageData(0, 0, roiW, roiH);

    // 1. Grayscale
    const gray = toGrayscale(imageData.data, roiW, roiH);

    // 2. Gaussian blur (5×5)
    const blurred = gaussianBlur5(gray, roiW, roiH);

    // 3. Canny edge detection
    const edges = cannyEdges(blurred, roiW, roiH, CANNY_LOW, CANNY_HIGH);

    // 4. Dilate edges slightly to close gaps
    const dilated = dilate3x3(edges, roiW, roiH);

    // 5. Find contours
    const contours = findContours(dilated, roiW, roiH);

    // 6. Filter and score candidates
    const roiArea = roiW * roiH;
    let bestCandidate: { quad: Point[]; score: number } | null = null;

    for (const contour of contours) {
      const area = contourArea(contour);
      if (area < roiArea * MIN_AREA_FRACTION) continue;
      if (area > roiArea * MAX_AREA_FRACTION) continue;

      // Approximate polygon
      const epsilon = contourPerimeter(contour) * 0.04;
      const approx = approxPolyDP(contour, epsilon);
      if (approx.length !== 4) continue;

      // Must be convex
      if (!isConvex(approx)) continue;

      // Check aspect ratio of bounding rect
      const bbox = boundingRect(approx);
      const aspect = bbox.w / Math.max(1, bbox.h);
      const aspectDiff = Math.abs(aspect - CARD_ASPECT);
      if (aspectDiff > ASPECT_TOLERANCE * CARD_ASPECT) continue;

      // Score: closer aspect ratio = higher score, larger area = slight boost
      const aspectScore = 1 - aspectDiff / (ASPECT_TOLERANCE * CARD_ASPECT);
      const areaScore = Math.min(1, area / (roiArea * 0.5));
      const score = aspectScore * 0.7 + areaScore * 0.3;

      if (!bestCandidate || score > bestCandidate.score) {
        bestCandidate = { quad: approx, score };
      }
    }

    if (!bestCandidate || bestCandidate.score < 0.3) {
      this.missStreak++;
      // After many misses, discard the cached detection
      if (this.missStreak > 10) {
        this.lastDetection = null;
        this.smoothedWidthPx = 0;
      }
      return this.lastDetection;
    }

    this.missStreak = 0;

    // Sort corners: top-left, top-right, bottom-right, bottom-left
    const sorted = sortCorners(bestCandidate.quad);

    // Translate back to full-canvas coordinates
    const corners: CardCorners = {
      tl: { x: sorted[0].x + roi.x, y: sorted[0].y + roi.y },
      tr: { x: sorted[1].x + roi.x, y: sorted[1].y + roi.y },
      br: { x: sorted[2].x + roi.x, y: sorted[2].y + roi.y },
      bl: { x: sorted[3].x + roi.x, y: sorted[3].y + roi.y },
    };

    // Compute width and height from detected corners
    const topEdge = dist(corners.tl, corners.tr);
    const bottomEdge = dist(corners.bl, corners.br);
    const leftEdge = dist(corners.tl, corners.bl);
    const rightEdge = dist(corners.tr, corners.br);
    const rawWidth = (topEdge + bottomEdge) / 2;
    const rawHeight = (leftEdge + rightEdge) / 2;

    const center: Point = {
      x: (corners.tl.x + corners.tr.x + corners.br.x + corners.bl.x) / 4,
      y: (corners.tl.y + corners.tr.y + corners.br.y + corners.bl.y) / 4,
    };

    // Smooth to reduce jitter
    const alpha = 0.35;
    this.smoothedWidthPx =
      this.smoothedWidthPx > 0
        ? this.smoothedWidthPx + (rawWidth - this.smoothedWidthPx) * alpha
        : rawWidth;
    this.smoothedCenter =
      this.smoothedCenter.x > 0
        ? {
            x: this.smoothedCenter.x + (center.x - this.smoothedCenter.x) * alpha,
            y: this.smoothedCenter.y + (center.y - this.smoothedCenter.y) * alpha,
          }
        : center;

    const detection: CardDetection = {
      corners,
      widthPx: this.smoothedWidthPx,
      heightPx: rawHeight,
      center: this.smoothedCenter,
      confidence: bestCandidate.score,
    };

    this.lastDetection = detection;
    return detection;
  }

  /** Clears cached state so the next frame starts fresh. */
  public reset(): void {
    this.lastDetection = null;
    this.smoothedWidthPx = 0;
    this.smoothedCenter = { x: 0, y: 0 };
    this.missStreak = 0;
    this.frameCount = 0;
  }
}

// ── Image processing primitives ──────────────────────────────────────────────

/** RGBA → single-channel luminance. */
function toGrayscale(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const n = w * h;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const off = i * 4;
    // ITU-R BT.601 weights
    out[i] = (rgba[off] * 77 + rgba[off + 1] * 150 + rgba[off + 2] * 29) >> 8;
  }
  return out;
}

/** 5×5 Gaussian blur (σ ≈ 1.0, separable). */
function gaussianBlur5(src: Uint8Array, w: number, h: number): Uint8Array {
  const kernel = [1, 4, 6, 4, 1]; // normalised by /16 per pass
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) {
        const sx = Math.min(w - 1, Math.max(0, x + k));
        sum += src[row + sx] * kernel[k + 2];
      }
      tmp[row + x] = (sum + 8) >> 4;
    }
  }

  // Vertical pass
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) {
        const sy = Math.min(h - 1, Math.max(0, y + k));
        sum += tmp[sy * w + x] * kernel[k + 2];
      }
      out[y * w + x] = (sum + 8) >> 4;
    }
  }

  return out;
}

/** Canny-like edge detection (Sobel gradient + non-max suppression + hysteresis). */
function cannyEdges(
  src: Uint8Array,
  w: number,
  h: number,
  lo: number,
  hi: number
): Uint8Array {
  const n = w * h;
  const gx = new Int16Array(n);
  const gy = new Int16Array(n);
  const mag = new Float32Array(n);
  const dir = new Uint8Array(n); // quantised to 0-3

  // Sobel gradients
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const tl = src[(y - 1) * w + x - 1];
      const tc = src[(y - 1) * w + x];
      const tr = src[(y - 1) * w + x + 1];
      const ml = src[y * w + x - 1];
      const mr = src[y * w + x + 1];
      const bl = src[(y + 1) * w + x - 1];
      const bc = src[(y + 1) * w + x];
      const br = src[(y + 1) * w + x + 1];

      const sx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const sy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      gx[idx] = sx;
      gy[idx] = sy;
      mag[idx] = Math.sqrt(sx * sx + sy * sy);

      // Quantise angle to 4 directions
      const angle = Math.atan2(sy, sx);
      const deg = ((angle * 180) / Math.PI + 180) % 180;
      if (deg < 22.5 || deg >= 157.5) dir[idx] = 0;       // horizontal
      else if (deg < 67.5) dir[idx] = 1;                   // diagonal /
      else if (deg < 112.5) dir[idx] = 2;                  // vertical
      else dir[idx] = 3;                                     // diagonal \
    }
  }

  // Non-maximum suppression
  const nms = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const m = mag[idx];
      let m1 = 0;
      let m2 = 0;
      switch (dir[idx]) {
        case 0: m1 = mag[idx - 1]; m2 = mag[idx + 1]; break;
        case 1: m1 = mag[(y - 1) * w + x + 1]; m2 = mag[(y + 1) * w + x - 1]; break;
        case 2: m1 = mag[(y - 1) * w + x]; m2 = mag[(y + 1) * w + x]; break;
        case 3: m1 = mag[(y - 1) * w + x - 1]; m2 = mag[(y + 1) * w + x + 1]; break;
      }
      nms[idx] = m >= m1 && m >= m2 ? m : 0;
    }
  }

  // Hysteresis thresholding
  const out = new Uint8Array(n);
  const STRONG = 255;
  const WEAK = 128;

  for (let i = 0; i < n; i++) {
    if (nms[i] >= hi) out[i] = STRONG;
    else if (nms[i] >= lo) out[i] = WEAK;
  }

  // Promote weak pixels connected to strong
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        if (out[idx] !== WEAK) continue;
        // Check 8 neighbours for a strong pixel
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (out[(y + dy) * w + (x + dx)] === STRONG) {
              out[idx] = STRONG;
              changed = true;
            }
          }
        }
      }
    }
  }

  // Suppress remaining weak
  for (let i = 0; i < n; i++) {
    if (out[i] !== STRONG) out[i] = 0;
  }

  return out;
}

/** 3×3 dilation to close small edge gaps. */
function dilate3x3(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let max = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = src[(y + dy) * w + (x + dx)];
          if (v > max) max = v;
        }
      }
      out[y * w + x] = max;
    }
  }
  return out;
}

// ── Contour extraction ───────────────────────────────────────────────────────

/**
 * Simple border-following contour extraction.
 *
 * Finds the outer boundaries of connected white regions in a binary image.
 * Returns up to 20 contours, sorted by area descending.
 */
function findContours(binary: Uint8Array, w: number, h: number): Contour[] {
  const visited = new Uint8Array(w * h);
  const contours: Contour[] = [];

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (binary[idx] === 0 || visited[idx]) continue;
      // Is this pixel on the border? (has at least one 0-neighbour)
      if (!isBorderPixel(binary, x, y, w, h)) {
        visited[idx] = 1;
        continue;
      }

      const contour = traceContour(binary, visited, x, y, w, h);
      if (contour.length >= 20) {
        contours.push(contour);
      }
      if (contours.length >= 30) break;
    }
    if (contours.length >= 30) break;
  }

  // Sort by area descending and keep top 20
  return contours
    .sort((a, b) => contourArea(b) - contourArea(a))
    .slice(0, 20);
}

function isBorderPixel(img: Uint8Array, x: number, y: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) return true;
      if (img[ny * w + nx] === 0) return true;
    }
  }
  return false;
}

/**
 * Traces the border of a connected component starting at (sx, sy).
 * Uses Moore neighbourhood tracing (8-connected).
 */
function traceContour(
  img: Uint8Array,
  visited: Uint8Array,
  sx: number,
  sy: number,
  w: number,
  h: number
): Contour {
  const contour: Contour = [];
  // 8-connected direction offsets: right, down-right, down, down-left, left, up-left, up, up-right
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];

  let x = sx;
  let y = sy;
  let dir = 7; // start searching from up-right
  const maxSteps = w * h; // safety limit

  for (let step = 0; step < maxSteps; step++) {
    contour.push({ x, y });
    visited[y * w + x] = 1;

    // Search for next border pixel in clockwise order
    let found = false;
    const startDir = (dir + 6) % 8; // start 2 positions back (counter-clockwise)
    for (let i = 0; i < 8; i++) {
      const d = (startDir + i) % 8;
      const nx = x + dx[d];
      const ny = y + dy[d];
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && img[ny * w + nx] > 0) {
        x = nx;
        y = ny;
        dir = d;
        found = true;
        break;
      }
    }

    if (!found) break;
    if (x === sx && y === sy) break; // completed the loop
    // Skip duplicate consecutive points
    if (contour.length > 2 && contour[contour.length - 1].x === x && contour[contour.length - 1].y === y) {
      continue;
    }
  }

  return contour;
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

/** Shoelace formula for polygon area. */
function contourArea(pts: Point[]): number {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

/** Perimeter of a polygon. */
function contourPerimeter(pts: Point[]): number {
  let p = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    p += dist(pts[i], pts[(i + 1) % n]);
  }
  return p;
}

/** Euclidean distance between two points. */
function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Ramer-Douglas-Peucker polygon approximation.
 * Reduces a contour to its dominant vertices.
 */
function approxPolyDP(pts: Point[], epsilon: number): Point[] {
  if (pts.length <= 2) return pts.slice();

  // Find the point farthest from the line between first and last
  let maxDist = 0;
  let maxIdx = 0;
  const first = pts[0];
  const last = pts[pts.length - 1];

  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointLineDistance(pts[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = approxPolyDP(pts.slice(0, maxIdx + 1), epsilon);
    const right = approxPolyDP(pts.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }

  return [first, last];
}

/** Distance from point P to line segment AB. */
function pointLineDistance(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return dist(p, a);

  const cross = Math.abs((p.x - a.x) * aby - (p.y - a.y) * abx);
  return cross / Math.sqrt(len2);
}

/** Axis-aligned bounding rectangle of a polygon. */
function boundingRect(pts: Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Tests convexity via cross-product sign consistency. */
function isConvex(pts: Point[]): boolean {
  const n = pts.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const c = pts[(i + 2) % n];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross !== 0) {
      if (sign === 0) sign = cross > 0 ? 1 : -1;
      else if ((cross > 0 ? 1 : -1) !== sign) return false;
    }
  }
  return true;
}

/**
 * Sorts 4 corner points into canonical order: TL, TR, BR, BL.
 * Uses sum (x+y) for TL/BR and difference (x-y) for TR/BL.
 */
function sortCorners(pts: Point[]): [Point, Point, Point, Point] {
  const sorted = pts.slice() as [Point, Point, Point, Point];

  // TL has the smallest x+y, BR has the largest
  sorted.sort((a, b) => a.x + a.y - (b.x + b.y));
  const tl = sorted[0];
  const br = sorted[3];

  // Of the remaining two, TR has the larger x-y, BL has the smaller
  const mid = [sorted[1], sorted[2]];
  mid.sort((a, b) => (a.x - a.y) - (b.x - b.y));
  const bl = mid[0];
  const tr = mid[1];

  return [tl, tr, br, bl];
}

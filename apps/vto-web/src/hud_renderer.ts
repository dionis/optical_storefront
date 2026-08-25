import { OpticalMeasurements } from './optical_calculator';
import { FITTING_CONFIG } from './fitting_config';
import { t } from './i18n';
import { viewTransform } from './view_transform';

export class HUDRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /**
   * The measurement overlay starts OFF: the first thing the patient sees must be their
   * own face with the frame on it, not a mesh of lines and figures. The readouts appear
   * only once the operator enables their capture with the overlay button.
   */
  public isEnabled: boolean = false;
  public isCardCalibrationEnabled: boolean = false;
  public onCardCalibrated?: (scaleMMPerNorm: number) => void;
  private cardImage: HTMLImageElement;
  private isCardImageLoaded: boolean = false;

  /**
   * Apparent width of the real card in canvas pixels — the quantity being MEASURED.
   * The card's physical 85.60 mm is a constant elsewhere and never changes; this is how
   * many pixels those 85.60 mm happen to span at the current distance and resolution.
   * Recomputed every frame from the face, so it follows the subject moving toward or
   * away from the camera. Null until the first detected face.
   */
  public cardApparentWidthPx: number | null = null;

  /**
   * The operator's correction to the face-derived seed, as a RATIO, not as a pixel
   * count. This is what keeps the guide anchored: a card held at the plane of the eyes
   * grows and shrinks in the image exactly as the face does, so the correction between
   * the two is scale-free and the same number stays valid at any working distance.
   * Storing the correction in pixels was the defect — it froze the card at whatever
   * size the first frame happened to give, so the card looked oversized once the
   * subject backed away and undersized once they leaned in.
   */
  private cardScaleFactor: number = 1;

  /** Drag offsets, also as a fraction of the card width, for the same reason. */
  private cardOffsetXRatio: number = 0;
  private cardOffsetYRatio: number = 0;

  /** Apparent width the PD estimate predicts, used to seed and to reset the marking. */
  public cardSeedWidthPx: number = 0;

  /** Low-passed seed: raw landmark jitter would otherwise make the card shimmer. */
  private cardSeedSmoothedPx: number = 0;

  /**
   * Overlay size in CSS pixels. The backing store is larger on a high-density screen,
   * so every drawing routine works in these units and never in `canvas.width`, which is
   * the device-pixel figure.
   */
  private w = 0;
  private h = 0;

  private cardRect = { x: 0, y: 0, w: 0, h: 0 };
  private dragging = false;
  private dragFromX = 0;
  private dragFromY = 0;

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.resizeCanvas();
    const onResize = this.resizeCanvas.bind(this);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    window.visualViewport?.addEventListener('resize', onResize);

    this.cardImage = new Image();
    this.cardImage.src = './card_texture.png';
    this.cardImage.onload = () => {
      this.isCardImageLoaded = true;
    };

    this.setupCardDragging();
  }

  /**
   * Lets the operator drag the card overlay onto the real card visible in the feed.
   * Pointer events on the HUD canvas are enabled only while calibrating, so the rest of
   * the time clicks still reach the 3D canvas underneath.
   */
  private setupCardDragging(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.isCardCalibrationEnabled) return;
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const c = this.cardRect;
      if (x < c.x || x > c.x + c.w || y < c.y || y > c.y + c.h) return;

      this.dragging = true;
      // The offsets live as ratios, so the grab point is converted to pixels against
      // the width the card currently has on screen and back again on every move.
      this.dragFromX = x - this.cardOffsetXRatio * c.w;
      this.dragFromY = y - this.cardOffsetYRatio * c.w;
      this.canvas.setPointerCapture(e.pointerId);
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const r = this.canvas.getBoundingClientRect();
      const span = this.cardRect.w || 1;
      this.cardOffsetXRatio = (e.clientX - r.left - this.dragFromX) / span;
      this.cardOffsetYRatio = (e.clientY - r.top - this.dragFromY) / span;
    });

    const endDrag = () => { this.dragging = false; };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);
  }

  /** Enables pointer interaction on the overlay only while the card guide is on. */
  public setCardInteractive(active: boolean): void {
    this.canvas.style.pointerEvents = active ? 'auto' : 'none';
    this.canvas.style.cursor = active ? 'move' : 'default';
    // On a touch screen the browser would otherwise claim the gesture and pan the page
    // instead of moving the card
    this.canvas.style.touchAction = active ? 'none' : '';
    if (!active) this.dragging = false;
  }

  /** Clears the marking so it re-seeds from the PD estimate on the next frame. */
  public resetCardAdjust(): void {
    this.cardApparentWidthPx = null;
    this.cardScaleFactor = 1;
    this.cardOffsetXRatio = 0;
    this.cardOffsetYRatio = 0;
    this.cardSeedSmoothedPx = 0;
  }

  /**
   * Accepts a marking expressed in canvas pixels — what the operator sees on the slider
   * — and stores it as the scale-free correction the renderer actually uses. Without a
   * seed yet (no face) the value is remembered as-is on the next seeded frame.
   */
  public setCardWidthPx(px: number): void {
    const seed = this.cardSeedSmoothedPx || this.cardSeedWidthPx;
    if (!(px > 0) || !(seed > 0)) return;
    const { scaleFactorRange } = FITTING_CONFIG.cardCalibration;
    this.cardScaleFactor = Math.min(
      scaleFactorRange.max,
      Math.max(scaleFactorRange.min, px / seed)
    );
  }

  /**
   * Sizes the overlay from its own layout box and multiplies the backing store by the
   * device pixel ratio, so the measurement labels stay sharp on a phone screen instead
   * of being upscaled from one third of their nominal resolution.
   */
  private resizeCanvas(): void {
    if (!this.canvas) return;

    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    // From here on the context accepts CSS pixels
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  public clear(): void {
    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.w, this.h);
    }
  }

  /**
   * Renders real-time optical prescription measurements HUD directly on the user's face
   */
  public renderOverlay(landmarks: any[], measurements: OpticalMeasurements): void {
    if (!landmarks || landmarks.length < 468 || !this.ctx) {
      this.clear();
      return;
    }
    // The card guide is not one of the readouts: it is the marking tool that FEEDS them,
    // and `cardApparentWidthPx` — the scale main.ts reads back — is only recomputed while
    // it is drawn. So hiding the measurements must not take it away.
    if (!this.isEnabled && !this.isCardCalibrationEnabled) {
      this.clear();
      return;
    }

    const w = this.w;
    const h = this.h;
    this.ctx.clearRect(0, 0, w, h);

    // Coordinate conversion for the mirrored, `object-fit: cover` video feed. The crop
    // mapping is what keeps the overlay on the face when the viewport aspect does not
    // match the camera frame aspect — the normal case on a phone held upright.
    const toScreen = (lm: any) => ({
      x: viewTransform.mirroredX(lm.x) * w,
      y: viewTransform.y(lm.y) * h
    });

    if (!this.isEnabled) {
      this.drawCreditCardOverlay(toScreen, landmarks);
      return;
    }

    const nose = toScreen(landmarks[168] || landmarks[6]);
    const forehead = toScreen(landmarks[10]);
    const chin = toScreen(landmarks[152]);

    // Pupil points (mirrored: right pupil landmark 468 corresponds to screen-left when mirrored)
    const rightPupilLM = landmarks[468] || landmarks[33];
    const leftPupilLM = landmarks[473] || landmarks[263];

    const rightPupil = toScreen(rightPupilLM);
    const leftPupil = toScreen(leftPupilLM);

    // Lower rim fitting points
    const rightLowerRim = landmarks[145] ? toScreen(landmarks[145]) : { x: rightPupil.x, y: rightPupil.y + h * 0.08 };
    const leftLowerRim = landmarks[374] ? toScreen(landmarks[374]) : { x: leftPupil.x, y: leftPupil.y + h * 0.08 };

    // Ears
    const rightEar = landmarks[234] ? toScreen(landmarks[234]) : null;
    const leftEar = landmarks[454] ? toScreen(landmarks[454]) : null;

    // 1. Draw Nose Midline (Vertical Dashed Line)
    this.ctx.save();
    this.ctx.setLineDash([6, 6]);
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(forehead.x, forehead.y - 40);
    this.ctx.lineTo(chin.x, chin.y + 40);
    this.ctx.stroke();
    this.ctx.restore();

    // 2. Draw Vertical Dotted Projection Lines from Pupils Upward & Downward
    this.ctx.save();
    this.ctx.setLineDash([3, 4]);
    this.ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
    this.ctx.lineWidth = 1.5;

    // Right pupil vertical line
    this.ctx.beginPath();
    this.ctx.moveTo(rightPupil.x, forehead.y - 50);
    this.ctx.lineTo(rightPupil.x, rightLowerRim.y + 40);
    this.ctx.stroke();

    // Left pupil vertical line
    this.ctx.beginPath();
    this.ctx.moveTo(leftPupil.x, forehead.y - 50);
    this.ctx.lineTo(leftPupil.x, leftLowerRim.y + 40);
    this.ctx.stroke();
    this.ctx.restore();

    // 3. Draw Pupil Target Crosshairs (⊕)
    this.drawPupilTarget(rightPupil.x, rightPupil.y);
    this.drawPupilTarget(leftPupil.x, leftPupil.y);

    // 4. Draw PD TOTAL Blue Arrow & Badge (Top)
    const pdY = forehead.y - 30;
    this.drawDimensionLine(rightPupil.x, pdY, leftPupil.x, pdY, '#3b82f6');
    this.drawBadge(
      (rightPupil.x + leftPupil.x) / 2,
      pdY - 12,
      `${t('hud.pdTotal')} ${measurements.pupillaryDistance.pdTotal} mm`,
      '#3b82f6'
    );

    // 5. Monocular PD arrows, labelled OD/OS so the reading does not depend on the
    //    mirrored screen side. Badges are pushed apart when their pills would collide.
    const pdSubY = (forehead.y + rightPupil.y) / 2 - 10;
    this.drawDimensionLine(rightPupil.x, pdSubY, nose.x, pdSubY, '#ef4444');
    this.drawDimensionLine(nose.x, pdSubY, leftPupil.x, pdSubY, '#ef4444');

    // Provisional values keep a "~" and a muted colour so a clamped estimate is never
    // mistaken for a measurement
    const MUTED = '#94a3b8';
    const flags = measurements.outOfRange;

    const odText = `${t('hud.od')} ${flags?.pdRight ? '~' : ''}${measurements.pupillaryDistance.pdRight} mm`;
    const osText = `${t('hud.os')} ${flags?.pdLeft ? '~' : ''}${measurements.pupillaryDistance.pdLeft} mm`;
    const [odX, osX] = this.resolveBadgePair(
      (rightPupil.x + nose.x) / 2, odText,
      (nose.x + leftPupil.x) / 2, osText
    );
    this.drawBadge(odX, pdSubY - 12, odText, flags?.pdRight ? MUTED : '#ef4444');
    this.drawBadge(osX, pdSubY - 12, osText, flags?.pdLeft ? MUTED : '#ef4444');

    // 6. Fitting heights: the segment stays on the lens, the label is parked outside
    //    the head so the frame the customer is trying on is never covered.
    const hRightBottomY = rightPupil.y + (rightLowerRim.y - rightPupil.y) * 1.4;
    const hLeftBottomY = leftPupil.y + (leftLowerRim.y - leftPupil.y) * 1.4;

    this.drawHeightMeasure(
      rightPupil.x, rightPupil.y, hRightBottomY, nose.x, rightEar,
      `${t('hud.altOd')} ${flags?.heightRight ? '~' : ''}${measurements.fittingHeight.heightRight} mm`,
      flags?.heightRight ? MUTED : '#f59e0b'
    );
    this.drawHeightMeasure(
      leftPupil.x, leftPupil.y, hLeftBottomY, nose.x, leftEar,
      `${t('hud.altOs')} ${flags?.heightLeft ? '~' : ''}${measurements.fittingHeight.heightLeft} mm`,
      flags?.heightLeft ? MUTED : '#f59e0b'
    );

    // 7. Ear Anchors (Tragus indicators)
    if (rightEar) this.drawEarAnchor(rightEar.x, rightEar.y);
    if (leftEar) this.drawEarAnchor(leftEar.x, leftEar.y);

    // 8. Credit Card Calibration Overlay (Under Nose)
    if (this.isCardCalibrationEnabled) {
      this.drawCreditCardOverlay(toScreen, landmarks);
    }
  }

  private drawCreditCardOverlay(toScreen: (lm: any) => { x: number; y: number }, landmarks: any[]): void {
    const ctx = this.ctx;
    const nose = toScreen(landmarks[2] || landmarks[164] || landmarks[1]);
    const rightPupil = toScreen(landmarks[468] || landmarks[33]);
    const leftPupil = toScreen(landmarks[473] || landmarks[263]);

    const { cardWidthMM, cardHeightMM, scaleFactorRange, faceGapRatio } =
      FITTING_CONFIG.cardCalibration;

    // Where the PD estimate predicts the card edges would fall, RE-EVALUATED ON EVERY
    // FRAME. The card is meant to be held in the plane of the eyes, so its apparent
    // width must track the apparent width of the face: farther away, both shrink;
    // closer, both grow. The Euclidean pupil separation is used rather than its
    // horizontal component alone so head roll does not shrink the guide either.
    const pupilDistPx = Math.hypot(leftPupil.x - rightPupil.x, leftPupil.y - rightPupil.y);
    this.cardSeedWidthPx = pupilDistPx * (cardWidthMM / FITTING_CONFIG.pdReferenceMM);

    // Landmark jitter is a few pixels per frame; unfiltered it makes the card breathe.
    if (this.cardSeedWidthPx > 0) {
      this.cardSeedSmoothedPx =
        this.cardSeedSmoothedPx > 0
          ? this.cardSeedSmoothedPx + (this.cardSeedWidthPx - this.cardSeedSmoothedPx) * 0.25
          : this.cardSeedWidthPx;
    }

    const seedPx = this.cardSeedSmoothedPx || this.cardSeedWidthPx;
    if (seedPx <= 0) return;

    const factor = Math.min(
      scaleFactorRange.max,
      Math.max(scaleFactorRange.min, this.cardScaleFactor)
    );
    const cardW = seedPx * factor;
    const cardH = cardW * (cardHeightMM / cardWidthMM); // ISO/IEC 7810 ID-1 ratio

    // Published for the readout and the exported report: the span the card occupies
    // right now, which is the quantity the mm/pixel scale is built from.
    this.cardApparentWidthPx = cardW;

    // The gap under the nose is a fraction of the card, never a pixel constant, so the
    // guide stays glued to the face at any distance instead of drifting away from it
    // when the subject backs off.
    const cardX = nose.x - cardW / 2 + this.cardOffsetXRatio * cardW;
    const cardY = nose.y + cardH * faceGapRatio + this.cardOffsetYRatio * cardW;

    this.cardRect = { x: cardX, y: cardY, w: cardW, h: cardH };

    // 85.60 mm is fixed; cardW is the measured span. Their ratio is the scale.
    // The marked span is in screen pixels; the scale it feeds is consumed against
    // frame-normalized landmark distances, so it is divided by the painted width of the
    // frame rather than by the width of the screen. The two are the same only when
    // nothing is cropped.
    const frameSpanPx = viewTransform.displayWidth || this.w;
    if (this.onCardCalibrated && cardW > 0) {
      this.onCardCalibrated(cardWidthMM / (cardW / frameSpanPx));
    }

    // ISO/IEC 7810 ID-1 corner radius is 3.18 mm of the 85.60 mm width — keep it
    // proportional so the outline hugs the texture at any on-screen size.
    const radius = cardW * (3.18 / cardWidthMM);

    ctx.save();

    // Drop shadow: separates the card from the video behind it
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, radius);
    ctx.fill();
    ctx.restore();

    // Draw Realistic Credit Card Back Image if loaded, else fallback gradient
    if (this.isCardImageLoaded) {
      // The texture is edge-to-edge at the ISO ratio and carries its own rounded
      // alpha corners, so it maps 1:1 onto the measured rectangle.
      ctx.drawImage(this.cardImage, cardX, cardY, cardW, cardH);
    } else {
      // Metallic Dark Blue Card Fallback
      const cardGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
      cardGrad.addColorStop(0, '#0f2b48');
      cardGrad.addColorStop(1, '#071828');
      ctx.fillStyle = cardGrad;
      ctx.beginPath();
      ctx.roundRect(cardX, cardY, cardW, cardH, radius);
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(cardX, cardY, cardW, cardH, radius);
      ctx.clip();
      // Magnetic Stripe (ISO/IEC 7811-2 placement) & Signature Strip
      ctx.fillStyle = '#111827';
      ctx.fillRect(cardX, cardY + cardH * 0.103, cardW, cardH * 0.235);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(cardX + cardW * 0.058, cardY + cardH * 0.389, cardW * 0.806, cardH * 0.167);
      ctx.restore();
    }

    // Outline hugging the card edge — thin, no glow, so it reads as a frame not a halo
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, radius);
    ctx.stroke();

    // Corner brackets sitting just outside the outline
    const armLen = Math.min(cardW * 0.14, 26);
    const off = 5;
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    const drawBracket = (bx: number, by: number, sx: number, sy: number) => {
      ctx.beginPath();
      ctx.moveTo(bx + sx * armLen, by);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx, by + sy * armLen);
      ctx.stroke();
    };
    drawBracket(cardX - off, cardY - off, 1, 1);
    drawBracket(cardX + cardW + off, cardY - off, -1, 1);
    drawBracket(cardX - off, cardY + cardH + off, 1, -1);
    drawBracket(cardX + cardW + off, cardY + cardH + off, -1, -1);

    ctx.restore();
  }

  private drawPupilTarget(x: number, y: number): void {
    const ctx = this.ctx;
    ctx.save();
    
    // Glowing Outer Circle
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 10;
    ctx.stroke();

    // Inner Target Cross
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(x - 18, y);
    ctx.lineTo(x + 18, y);
    ctx.moveTo(x, y - 18);
    ctx.lineTo(x, y + 18);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Labels are read at arm's length on a phone and from a desk on a monitor, so the
   * pills grow a little on a narrow viewport rather than shrinking with it.
   */
  private get badgeFontPx(): number {
    return this.w > 0 && this.w < 520 ? 14 : 12;
  }

  private badgeFont(): string {
    return `bold ${this.badgeFontPx}px "Outfit", sans-serif`;
  }

  /** Pill width for a label, so placement can be resolved before anything is drawn. */
  private badgeWidth(text: string): number {
    this.ctx.font = this.badgeFont();
    return this.ctx.measureText(text).width + 12;
  }

  /**
   * Places two badges sharing a row: keeps their natural centres when they fit, and
   * pushes them symmetrically apart when the pills would overlap. Both are kept inside
   * the canvas so a label is never clipped at the edge of the frame.
   */
  private resolveBadgePair(cA: number, tA: string, cB: number, tB: string): [number, number] {
    const GAP = 10;
    const wA = this.badgeWidth(tA);
    const wB = this.badgeWidth(tB);

    const swapped = cA > cB;
    let lo = swapped ? cB : cA;
    let hi = swapped ? cA : cB;
    const wLo = swapped ? wB : wA;
    const wHi = swapped ? wA : wB;

    const overlap = (wLo / 2 + wHi / 2 + GAP) - (hi - lo);
    if (overlap > 0) {
      lo -= overlap / 2;
      hi += overlap / 2;
    }

    lo = Math.max(wLo / 2 + 4, lo);
    hi = Math.min(this.w - wHi / 2 - 4, hi);

    return swapped ? [hi, lo] : [lo, hi];
  }

  private drawDimensionLine(x1: number, y1: number, x2: number, y2: number, color: string): void {
    const ctx = this.ctx;
    ctx.save();

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Heads follow the segment direction (the feed is mirrored, so x2 may be < x1)
    const headLen = 8;
    const dir = Math.sign(x2 - x1) || 1;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + headLen * dir, y1 - 4);
    ctx.lineTo(x1 + headLen * dir, y1 + 4);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * dir, y2 - 4);
    ctx.lineTo(x2 - headLen * dir, y2 + 4);
    ctx.fill();

    ctx.restore();
  }

  private drawBadge(cx: number, cy: number, text: string, color: string): void {
    const ctx = this.ctx;
    ctx.save();

    ctx.font = this.badgeFont();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const w = this.badgeWidth(text);
    const halfH = this.badgeFontPx * 0.85;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - halfH, w, halfH * 2, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.fillText(text, cx, cy);

    ctx.restore();
  }

  /**
   * Draws the fitting-height segment on the lens and parks its label beside the head,
   * joined by a leader line, so the badge never sits on top of the frame.
   */
  private drawHeightMeasure(
    x: number, yTop: number, yBottom: number,
    noseX: number,
    ear: { x: number; y: number } | null,
    text: string,
    color: string = '#f59e0b'
  ): void {
    const ctx = this.ctx;
    const dir = Math.sign(x - noseX) || 1; // outward, away from the face midline

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(x, yTop);
    ctx.lineTo(x, yBottom);
    ctx.stroke();

    ctx.setLineDash([]);
    const headLen = 7;
    ctx.beginPath();
    ctx.moveTo(x, yBottom);
    ctx.lineTo(x - 4, yBottom - headLen);
    ctx.lineTo(x + 4, yBottom - headLen);
    ctx.fill();
    ctx.restore();

    // Leader line out past the ear to the parked badge
    const midY = (yTop + yBottom) / 2;
    const w = this.badgeWidth(text);
    const outer = ear ? ear.x + dir * 46 : x + dir * 104;
    const badgeX = Math.min(
      this.w - w / 2 - 4,
      Math.max(w / 2 + 4, outer)
    );

    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x, midY);
    ctx.lineTo(badgeX - (dir * w) / 2, midY);
    ctx.stroke();
    ctx.restore();

    this.drawBadge(badgeX, midY, text, color);
  }

  private drawEarAnchor(x: number, y: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

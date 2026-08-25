/**
 * Maps normalized landmark coordinates (relative to the camera FRAME) onto normalized
 * viewport coordinates (relative to what is actually PAINTED on screen).
 *
 * The video element is laid out with `object-fit: cover`, so the frame is scaled up
 * until it covers the viewport and the overflow is cropped away symmetrically. A
 * landmark at x = 0.5 is still at the middle of the screen, but a landmark at x = 0.1
 * may well be off-screen. Ignoring that crop is harmless while the frame aspect and the
 * viewport aspect are close (desktop, 16:9 stream on a 16:9 window), and wrong by a
 * factor of two or more in phone portrait, where a landscape stream is cropped hard.
 *
 * Both consumers of landmark positions go through here so the 3D frame and the 2D HUD
 * stay locked to the same face:
 *   - vto_manager, to place the glasses in the Three.js scene
 *   - hud_renderer, to draw the measurement overlay
 *
 * Millimetre maths is NOT affected: optical_calculator works in frame space, where the
 * crop does not exist.
 */
/** Matches the CSS `object-fit` value used to paint the camera frame. */
export type FitMode = 'cover' | 'contain';

export class ViewTransform {
  /** Scale applied to a normalized frame coordinate to land in viewport space. */
  public scaleX = 1;
  public scaleY = 1;
  /** Offset applied after scaling, in viewport-normalized units (<= 0 on the cropped axis). */
  public offsetX = 0;
  public offsetY = 0;

  /** Painted size of the frame in CSS pixels — bigger than the viewport where cropped. */
  public displayWidth = 0;
  public displayHeight = 0;

  public viewWidth = 0;
  public viewHeight = 0;

  /** How the frame is fitted into the viewport; mirrors the video's `object-fit`. */
  public fit: FitMode = 'cover';

  /**
   * Beyond this much cropping, `cover` stops being reasonable. A landscape stream in a
   * portrait phone viewport crops to about a quarter of the frame width (scale ~3.95),
   * which magnifies the face roughly fourfold AND amplifies every tracking wobble by the
   * same factor, throwing the frame off screen. A mild crop (a portrait stream, ~1.25)
   * stays on `cover`, which looks better because it fills the screen.
   */
  public static readonly MAX_COVER_SCALE = 1.6;

  /** Would `cover` crop this frame harder than MAX_COVER_SCALE? */
  public static coverIsExcessive(
    frameWidth: number, frameHeight: number, viewWidth: number, viewHeight: number
  ): boolean {
    if (frameWidth <= 0 || frameHeight <= 0 || viewWidth <= 0 || viewHeight <= 0) return false;
    const cover = Math.max(viewWidth / frameWidth, viewHeight / frameHeight);
    const scaleX = (frameWidth * cover) / viewWidth;
    const scaleY = (frameHeight * cover) / viewHeight;
    return Math.max(scaleX, scaleY) > ViewTransform.MAX_COVER_SCALE;
  }

  /**
   * Recomputes the mapping. Called once per frame: the frame size settles only after
   * metadata arrives, and the viewport changes on rotation and on browser-chrome slide.
   *
   * `fit` must match the video element's actual `object-fit`, or the overlay and the 3D
   * frame land somewhere the face is not.
   */
  public update(
    frameWidth: number,
    frameHeight: number,
    viewWidth: number,
    viewHeight: number,
    fit: FitMode = 'cover'
  ): void {
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
    this.fit = fit;

    if (frameWidth <= 0 || frameHeight <= 0 || viewWidth <= 0 || viewHeight <= 0) {
      this.scaleX = this.scaleY = 1;
      this.offsetX = this.offsetY = 0;
      this.displayWidth = viewWidth;
      this.displayHeight = viewHeight;
      return;
    }

    // `cover` takes the larger ratio so neither axis leaves a gap and the overflow is
    // cropped; `contain` takes the smaller so the whole frame fits and the gap is
    // letterboxed. The rest of the mapping is identical either way.
    const ratio =
      fit === 'contain'
        ? Math.min(viewWidth / frameWidth, viewHeight / frameHeight)
        : Math.max(viewWidth / frameWidth, viewHeight / frameHeight);

    this.displayWidth = frameWidth * ratio;
    this.displayHeight = frameHeight * ratio;

    this.scaleX = this.displayWidth / viewWidth;
    this.scaleY = this.displayHeight / viewHeight;
    this.offsetX = (1 - this.scaleX) / 2;

    // Letterboxing a landscape frame into an upright phone leaves a band barely a
    // quarter of the screen tall. Centred, that band lands behind the bottom sheet and
    // most of the face disappears under it, so the slack is pushed to the bottom
    // instead. Must stay in step with `object-position` in the stylesheet.
    this.offsetY = fit === 'contain' && this.scaleY < 1 ? 0 : (1 - this.scaleY) / 2;
  }

  /** Frame-normalized x → viewport-normalized x (0 = left edge of the screen). */
  public x(nx: number): number {
    return nx * this.scaleX + this.offsetX;
  }

  /** Frame-normalized y → viewport-normalized y (0 = top edge of the screen). */
  public y(ny: number): number {
    return ny * this.scaleY + this.offsetY;
  }

  /**
   * Same as `x`, for a feed mirrored with `transform: scaleX(-1)`. The crop is
   * symmetric, so mirroring the result is equivalent to mirroring the input.
   */
  public mirroredX(nx: number): number {
    return 1 - this.x(nx);
  }

  /**
   * Depth carries no offset — it is a length, not a position — but it must be stretched
   * by the same factor as x so the head keeps its proportions under the crop.
   */
  public z(nz: number): number {
    return nz * this.scaleX;
  }
}

/** Single instance shared by the renderer and the pose solver; refreshed by main.ts. */
export const viewTransform = new ViewTransform();

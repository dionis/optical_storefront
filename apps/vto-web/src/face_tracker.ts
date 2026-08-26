import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

/** Where MediaPipe runs its inference. */
export type TrackerDelegate = 'GPU' | 'CPU';

export class FaceTracker {
  private faceLandmarker: FaceLandmarker | null = null;
  public videoElement: HTMLVideoElement;
  private isTrackerReady: boolean = false;

  /** Which delegate the current landmarker was built with. */
  public delegate: TrackerDelegate = 'GPU';

  /** True once the GPU path has been abandoned, so it is never retried in a loop. */
  public hasFallenBackToCpu = false;

  constructor(videoElementId: string) {
    this.videoElement = document.getElementById(videoElementId) as HTMLVideoElement;
  }

  /**
   * Initializes the MediaPipe Face Landmarker by fetching vision WASM files and model weights
   */
  public async initialize(delegate: TrackerDelegate = 'GPU'): Promise<void> {
    console.log(`Loading MediaPipe Face Landmarker (${delegate})...`);

    // Both the WASM runtime and the model file are served from this app's own origin
    // (apps/vto-web/public/mediapipe/, same convention as public/draco/ for the GLB
    // decoder) rather than jsdelivr and storage.googleapis.com. The model file in
    // particular measured 10+ seconds to fetch from Google's bucket on an ordinary
    // connection, and timed out outright on a slower one — "Cargando modelos" hanging
    // indefinitely on a customer's network was that fetch, not a bug in this app.
    // import.meta.env.BASE_URL carries the "/" (dev) vs "/tryon-3d/" (prod) prefix, so
    // this resolves correctly in both without hardcoding either.
    const base = (import.meta as any).env.BASE_URL;
    const vision = await FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`);

    // A landmarker already running holds GPU resources and a WASM heap of its own; the
    // replacement must not inherit either.
    this.faceLandmarker?.close();
    this.isTrackerReady = false;

    // Create the landmarker instance
    this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `${base}mediapipe/face_landmarker.task`,
        delegate
      },
      runningMode: "VIDEO",
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      numFaces: 1
    });

    this.delegate = delegate;
    console.log(`Face Landmarker initialized (${delegate}).`);
    this.isTrackerReady = true;
  }

  /**
   * Rebuilds the landmarker on the CPU after the GPU path proved unusable.
   *
   * Some mobile GPU drivers return tensors that decode into nonsense — landmark
   * coordinates around 1e19 rather than the [0,1] the model defines — while reporting
   * success. There is nothing downstream that can rescue that, and the only lever left is
   * to stop using the driver. Done once, never in a loop, and only after the guard in
   * main.ts has seen the corruption persist rather than flicker.
   */
  public async fallBackToCpu(): Promise<boolean> {
    if (this.hasFallenBackToCpu) return false;
    this.hasFallenBackToCpu = true;

    try {
      await this.initialize('CPU');
      console.warn('[FaceTracker] GPU delegate produced unusable landmarks; now running on CPU.');
      return true;
    } catch (err) {
      console.error('[FaceTracker] CPU fallback failed:', err);
      return false;
    }
  }

  /**
   * Requests webcam access and sets up video properties
   */
  public async startWebcam(): Promise<HTMLVideoElement> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Webcam access not supported in this browser.");
    }

    // The same landscape frame is requested on every device, phone included.
    //
    // Asking a phone for a portrait frame looks like the natural thing to do, but front
    // sensors are physically landscape: handed a portrait request they satisfy it by
    // CROPPING the sensor, throwing away the sides of the field of view and magnifying
    // what is left. The frame is then presented with `contain` on a phone, which shows
    // the whole field at the same relative size the desktop shows it.
    //
    // 1920x1080 (same 16:9 as the old 1280x720 — `verticalScaleMode: 'auto-aspect'` in
    // fitting_config.ts reads whatever the camera actually hands over, so this needs no
    // calibration change): the still captured for the AI panel is drawn 1:1 from this
    // same stream (captureFace() in vision_measure_panel.ts), so asking for more here is
    // what makes that photo as sharp as the live feed the customer is looking at,
    // instead of a visibly softer downgrade from it. `ideal`, not `min`/`exact`, so a
    // camera or device that cannot do 1080p just falls back to its best — nothing breaks
    // on weaker hardware, it only asks for more where it is available.
    const constraints = {
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        facingMode: "user"
      },
      audio: false
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.videoElement.srcObject = stream;
    
    return new Promise((resolve) => {
      this.videoElement.onloadedmetadata = () => {
        this.videoElement.play();
        // Logged because the device decides the final size, not the request above, and
        // every framing question starts with knowing what it actually handed over.
        console.log(
          `[FaceTracker] Camera stream: ${this.videoElement.videoWidth}x${this.videoElement.videoHeight}`
        );
        resolve(this.videoElement);
      };
    });
  }

  /**
   * Runs prediction on the current video frame
   */
  public detectFrame(timestamp: number): any {
    if (!this.isTrackerReady || !this.faceLandmarker) {
      return null;
    }

    // Run prediction on video frame
    // We pass the timestamp to MediaPipe to synchronize frame processing
    const results = this.faceLandmarker.detectForVideo(this.videoElement, timestamp);
    return results;
  }
}

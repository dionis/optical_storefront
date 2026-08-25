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

    // Resolve vision fileset resolver using Google CDN
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    // A landmarker already running holds GPU resources and a WASM heap of its own; the
    // replacement must not inherit either.
    this.faceLandmarker?.close();
    this.isTrackerReady = false;

    // Create the landmarker instance
    this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
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
    const constraints = {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
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

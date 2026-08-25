/**
 * Pre-flight checks on the two photographs, before a paid request is made.
 *
 * The face photo is checked HERE, in the browser, with the same MediaPipe model the live
 * try-on already downloads. It is free, it takes milliseconds, and it answers the only
 * question that matters before spending anything: is there exactly one person in this
 * picture? Zero faces or a group shot make every downstream measurement meaningless —
 * "the patient's PD" has no referent in a photo of two people.
 *
 * The frame photo is NOT checked here, and deliberately so. Nothing in this bundle can
 * tell a pair of glasses from a mug; claiming otherwise with a colour heuristic would be
 * worse than not checking, because a confident wrong rejection trains the operator to
 * ignore the warning. That check belongs to the multimodal model, which can actually
 * see, and it comes back with the measurement.
 */

import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

export type FaceCheckCode = 'ok' | 'no-face' | 'many-faces' | 'unavailable';

export interface FaceCheck {
  code: FaceCheckCode;
  /** How many faces the detector found. -1 when the detector could not run. */
  faces: number;
}

/** Enough to tell "one person" from "a group"; more would only cost time. */
const MAX_FACES = 4;

let detector: FaceLandmarker | null = null;
let loading: Promise<FaceLandmarker | null> | null = null;

/**
 * A second landmarker, in IMAGE mode.
 *
 * The live tracker runs in VIDEO mode with numFaces 1 — it is tuned to follow one face
 * across frames, and a mode cannot be switched per call. Counting faces in a still needs
 * its own instance, so this one is built lazily: an operator who never uploads a photo
 * never pays for the download.
 */
async function getDetector(): Promise<FaceLandmarker | null> {
  if (detector) return detector;
  if (loading) return loading;

  loading = (async () => {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );
      detector = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'IMAGE',
        numFaces: MAX_FACES,
      });
      return detector;
    } catch (error) {
      // The CDN is unreachable, or the device has no WebGL. Not a reason to block a
      // fitting: the check degrades to "unavailable" and the run proceeds.
      console.warn('[VTO] Validador de rostro no disponible:', error);
      return null;
    } finally {
      loading = null;
    }
  })();

  return loading;
}

/** Decodes a data URL into something MediaPipe can read. */
function toImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo decodificar la imagen.'));
    img.src = dataUrl;
  });
}

/**
 * Counts the faces in a still.
 *
 * Never throws: a validator that can break the flow it is meant to protect is worse than
 * no validator. Anything unexpected reports 'unavailable', which the caller treats as
 * "could not check" rather than as a failure.
 */
export async function checkSingleFace(dataUrl: string): Promise<FaceCheck> {
  if (!dataUrl) return { code: 'unavailable', faces: -1 };

  try {
    const landmarker = await getDetector();
    if (!landmarker) return { code: 'unavailable', faces: -1 };

    const image = await toImage(dataUrl);
    const result = landmarker.detect(image);
    const faces = result?.faceLandmarks?.length ?? 0;

    if (faces === 0) return { code: 'no-face', faces };
    if (faces > 1) return { code: 'many-faces', faces };
    return { code: 'ok', faces };
  } catch (error) {
    console.warn('[VTO] La comprobación de rostro falló:', error);
    return { code: 'unavailable', faces: -1 };
  }
}

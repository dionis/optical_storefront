// Detección de género (hombre/mujer) desde la cámara — SOLO para elegir qué foto de
// EJEMPLO mostrar en el probador (frontal/lateral de hombre o de mujer). Es una ayuda
// visual: nada se guarda, nada se envía, y si algo falla se cae en silencio (el
// probador sigue con el ejemplo por defecto). No es una etiqueta de identidad.
//
// Usa @vladmandic/face-api (mantenido, TF.js moderno) cargado bajo demanda desde el
// mismo CDN que ya usa el probador para MediaPipe, así no pesa en el bundle inicial.

const CDN = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.esm.js";
const MODELS = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";

let _fa = null;        // módulo face-api ya cargado
let _loading = null;   // promesa de carga en curso (evita cargas duplicadas)

/** Carga la librería + los dos modelos (detector de rostro + edad/género) una sola vez. */
export async function loadFaceApi() {
  if (_fa) return _fa;
  if (_loading) return _loading;
  _loading = (async () => {
    const fa = await import(/* @vite-ignore */ CDN);
    await Promise.all([
      fa.nets.tinyFaceDetector.loadFromUri(MODELS),
      fa.nets.ageGenderNet.loadFromUri(MODELS),
    ]);
    _fa = fa;
    return fa;
  })();
  try {
    return await _loading;
  } catch (e) {
    _loading = null; // permite reintentar en otra apertura del probador
    throw e;
  }
}

/**
 * Predice el género en UN fotograma del vídeo. Devuelve { gender: "male"|"female",
 * prob } o null si no hay rostro / falla. Best-effort: nunca lanza.
 */
export async function predictGender(video) {
  try {
    if (!video || video.readyState < 2) return null;
    const fa = await loadFaceApi();
    const opts = new fa.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 });
    const res = await fa.detectSingleFace(video, opts).withAgeAndGender();
    if (res && res.gender) {
      return { gender: res.gender === "female" ? "female" : "male", prob: res.genderProbability ?? 0 };
    }
  } catch {
    /* CDN bloqueado, sin WebGL, etc. → sin detección, se usa el ejemplo por defecto */
  }
  return null;
}

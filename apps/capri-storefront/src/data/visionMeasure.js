// Cliente de medición óptica multimodal para la tienda.
//
// Reutiliza el servicio `vision-measure` que ya corre junto al backend (protocolo
// Capri, medición PD/alturas y render de la montura con Gemini). La tienda le pega
// a través del proxy `/medusa` (ver src/data/medusa.js), así el navegador solo habla
// con su propio origen y la clave del proveedor nunca cruza a un tercer origen.
import { MEDUSA_URL } from "./medusa.js";

const API = `${MEDUSA_URL}/vision-measure`;
const JOB_API = `${API}/job`;

// La foto del marco vive en el host de imágenes del catálogo, que no manda cabeceras
// CORS: el servidor la descarga por nosotros y la devuelve como data URL.
export async function frameImageDataUrl(url) {
  if (!url) return null;
  try {
    const r = await fetch(`${API}/image-proxy?url=${encodeURIComponent(url)}`);
    const b = await r.json().catch(() => null);
    if (r.ok && b?.ok && b.dataUrl) return b.dataUrl;
  } catch { /* intentamos directo abajo */ }
  try {
    const r = await fetch(url, { mode: "cors" });
    const blob = await r.blob();
    return await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(new Error("img"));
      fr.readAsDataURL(blob);
    });
  } catch { return null; }
}

const CARD_HINT =
  "El paciente sostiene una tarjeta tipo ID-1 (85.60 mm de ancho × 53.98 mm de alto, " +
  "tamaño tarjeta bancaria/carné) junto a la mejilla en la foto frontal. Detéctala y " +
  "ÚSALA como referencia métrica exacta (px→mm) para la DIP y las alturas; prioriza esa " +
  "escala por encima de cualquier estimación anatómica. En la foto de perfil mide la " +
  "altura de corredor (centro de pupila → borde inferior de la armadura).";

const NOCARD_HINT =
  "No hay tarjeta de referencia en la foto. Estima la escala con proporciones faciales " +
  "estándar y marca la confianza como 'estimada' (cálculo aproximado).";

// Marcador mínimo para glassesImage: el servicio lo exige, pero las dimensiones del
// marco viajan como texto (frameSpec) y NO pedimos render, así que no procesamos una
// foto grande de la montura (eso disparaba el tiempo y el 502).
const TINY_PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// Reduce el peso de las fotos antes de enviarlas (Gemini submuestrea igual): baja a
// máx. 800 px por el lado mayor y recomprime a JPEG. Menos bytes = menos latencia,
// lo que mantiene la medición por debajo del límite del gateway (sin 502).
async function shrink(dataUrl, max = 800, quality = 0.82) {
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image"))
    return dataUrl || null;
  if (typeof document === "undefined") return dataUrl;
  try {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("img"));
      im.src = dataUrl;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    if (scale >= 1 && dataUrl.length < 120000) return dataUrl; // ya es liviana
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(img, 0, 0, w, h);
    return cv.toDataURL("image/jpeg", quality);
  } catch {
    return dataUrl;
  }
}

// Ejecuta la medición. faceImage y sideImage son data URLs de la cámara/subida.
//
// Rendimiento: usamos el modelo RÁPIDO (gemini-flash-lite) y NO pedimos la imagen generada
// por IA (renderTryOn:false). Generar la foto con la montura tarda 30-60 s y hacía que el
// gateway cortara con 502; medir con las dos fotos + la montura tarda ~12 s. El reporte
// muestra las fotos REALES del cliente con las cotas encima (PD en la frontal, altura de
// corredor en la lateral). La montura ya se ve puesta en el propio probador.
export async function runMeasurement({
  faceImage,
  sideImage = null,
  glassesImage = null,
  frameSpec = null,
  lang = "es",
  withReferenceCard = false,
  signal,
}) {
  const specHint = frameSpec
    ? ` Montura seleccionada — ${[
        frameSpec.name && `modelo ${frameSpec.name}`,
        frameSpec.eye && `calibre ${frameSpec.eye}`,
        frameSpec.bridge && `puente ${frameSpec.bridge}`,
        frameSpec.temple && `varilla ${frameSpec.temple}`,
      ].filter(Boolean).join(", ")}. Usa estas dimensiones como referencia del marco.`
    : "";

  // Comprimimos las fotos antes de enviarlas: baja los bytes y el tiempo de respuesta.
  const [faceSmall, sideSmall, glassesSmall] = await Promise.all([
    shrink(faceImage),
    shrink(sideImage, 800, 0.82),
    shrink(glassesImage, 640, 0.82),
  ]);

  const payload = {
    faceImage: faceSmall,
    // La foto REAL de la montura (reducida) evita que Gemini la vea "en negro" y
    // permite medir el marco; el render de IA sigue apagado (ahí estaba el 502).
    glassesImage: glassesSmall || TINY_PX,
    sideImage: sideSmall || undefined,
    provider: "gemini",
    // Modelo rápido y estable para medición: ~12 s típico devolviendo DIP + altura de
    // corredor completas (vs. ~40-60 s de flash/flash-preview). Sin render de IA.
    model: "gemini-flash-lite-latest",
    strategy: "A",
    lang,
    renderTryOn: false,
    renderProfile: false,
    imageEngine: "local",
    extraInstructions: (withReferenceCard ? CARD_HINT : NOCARD_HINT) + specHint,
  };

  // Corta si tarda demasiado (evita esperas eternas en la UI).
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 90000);
  const merged = signal
    ? (signal.addEventListener("abort", () => ctrl.abort()), ctrl.signal)
    : ctrl.signal;
  let r;
  try {
    r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: merged,
    });
  } catch (e) {
    clearTimeout(to);
    const err = new Error(
      e?.name === "AbortError"
        ? "La medición tardó demasiado. Inténtalo de nuevo."
        : "No se pudo conectar con el servicio de medición."
    );
    throw err;
  }
  clearTimeout(to);
  let body = null;
  try { body = await r.json(); }
  catch { throw new Error(`El servicio de medición no está disponible ahora (HTTP ${r.status}).`); }
  if (!r.ok && !Array.isArray(body?.results)) {
    const err = new Error(body?.error || body?.detail || `El servicio respondió ${r.status}.`);
    err.code = body?.results?.[0]?.errorCode;
    throw err;
  }
  return body;
}

// ── Medición + RENDER por IA de forma ASÍNCRONA (nunca cortar el flujo) ─────
//
// El render del rostro CON la montura puesta (estilo ficha del óptico) puede tardar
// 1-4 min y el proxy de borde corta cualquier petición a los ~120 s. Por eso NO se
// espera en una sola petición: se ARRANCA un trabajo en el backend y se pregunta el
// estado cada pocos segundos (consultas baratas). Gemini genera el tiempo que necesite.
function _sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(Object.assign(new Error("cancelado"), { name: "AbortError" }));
        },
        { once: true }
      );
    }
  });
}

// Arranca el trabajo y devuelve solo el id — respuesta inmediata, nada de sondeo aquí.
// Separado de `pollMeasurementJob` para que quien llama pueda GUARDAR el id (ver
// tryOnState.js: setMeasureJob) antes de ponerse a esperar, y así un remount a mitad
// de la espera pueda reconectarse al mismo trabajo en vez de perderlo.
export async function startMeasurementJob({
  faceImage,
  sideImage = null,
  glassesImage = null,
  frameSpec = null,
  lang = "es",
  withReferenceCard = false,
  render = true,
  signal,
}) {
  const specHint = frameSpec
    ? ` Montura seleccionada — ${[
        frameSpec.name && `modelo ${frameSpec.name}`,
        frameSpec.eye && `calibre ${frameSpec.eye}`,
        frameSpec.bridge && `puente ${frameSpec.bridge}`,
        frameSpec.temple && `varilla ${frameSpec.temple}`,
      ].filter(Boolean).join(", ")}. Usa estas dimensiones como referencia del marco.`
    : "";

  const [faceSmall, sideSmall, glassesSmall] = await Promise.all([
    shrink(faceImage),
    shrink(sideImage, 800, 0.82),
    shrink(glassesImage, 640, 0.82),
  ]);

  const payload = {
    faceImage: faceSmall,
    glassesImage: glassesSmall || TINY_PX,
    sideImage: sideSmall || undefined,
    provider: "gemini",
    // Números con el modelo rápido; la IMAGEN con el modelo de imagen por defecto del
    // backend (máxima calidad). Como es asíncrono, el tiempo del render no importa.
    model: "gemini-flash-lite-latest",
    strategy: "A",
    lang,
    renderTryOn: render,
    renderProfile: render && Boolean(sideSmall),
    imageEngine: render ? "gemini" : "local",
    extraInstructions: (withReferenceCard ? CARD_HINT : NOCARD_HINT) + specHint,
  };

  let startBody;
  try {
    const r = await fetch(JOB_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    startBody = await r.json().catch(() => null);
    if (!r.ok || !startBody?.jobId) {
      throw new Error(startBody?.error || `No se pudo iniciar la medición (HTTP ${r.status}).`);
    }
  } catch (e) {
    if (e?.name === "AbortError") throw Object.assign(new Error("cancelado"), { code: "aborted" });
    throw new Error(e?.message || "No se pudo conectar con el servicio de medición.");
  }
  return startBody.jobId;
}

// Pregunta el estado de un trabajo ya arrancado hasta que termine. El backend nunca
// corta la generación; este bucle solo tiene un tope de seguridad muy holgado por si
// el proceso se cae a mitad. Recibe un jobId suelto (no todo el payload) justamente
// para poder reanudar la espera de un trabajo que ya estaba corriendo — al reabrir
// tras un remount, o simplemente porque el llamador quiere separar arranque de espera.
export async function pollMeasurementJob(jobId, { onProgress = null, signal } = {}) {
  const started = Date.now();
  const MAX_MS = 8 * 60 * 1000; // 8 min de seguridad
  const STEP_MS = 3000;
  let misses = 0;
  for (;;) {
    if (signal?.aborted) throw Object.assign(new Error("cancelado"), { code: "aborted" });
    if (Date.now() - started > MAX_MS) {
      throw new Error("La generación está tardando más de lo normal. Vuelve a intentarlo.");
    }
    await _sleep(STEP_MS, signal);

    let poll = null;
    try {
      const r = await fetch(`${JOB_API}/${encodeURIComponent(jobId)}`, { signal });
      poll = await r.json().catch(() => null);
    } catch (e) {
      if (e?.name === "AbortError") throw Object.assign(new Error("cancelado"), { code: "aborted" });
      // Hipo de red al preguntar: reintenta unas cuantas veces antes de rendirse.
      if (++misses > 20) throw new Error("Se perdió la conexión con el servicio de medición.");
      continue;
    }
    misses = 0;
    if (!poll) continue;
    if (typeof onProgress === "function") {
      // `progress` trae {attempt, maxAttempts, slow, ...} mientras el servicio está
      // reintentando contra un proveedor saturado (ver providers.py); `notifyArmed` dice
      // si ya se guardó un contacto para avisar cuando termine — ver armMeasurementNotification.
      onProgress({
        status: poll.status,
        elapsedMs: Date.now() - started,
        progress: poll.progress || null,
        notifyArmed: Boolean(poll.notifyArmed),
      });
    }
    if (poll.status === "done") return poll.result;
    if (poll.status === "error") throw new Error(poll.error || "La generación de la imagen falló.");
    // status === "pending" → seguir preguntando.
  }
}

// Conveniencia: arranca y espera en un solo llamado, para quien no necesite guardar
// el jobId a mitad de camino.
export async function runMeasurementJob(params) {
  const jobId = await startMeasurementJob(params);
  return pollMeasurementJob(jobId, { onProgress: params.onProgress, signal: params.signal });
}

// Guarda un contacto para avisar por correo/WhatsApp cuando el trabajo termine, en vez
// de obligar al cliente a seguir mirando la pantalla. La entrega ocurre en el servidor
// (vision-measure compone el mensaje y se lo pasa al backend de Medusa, que ya tiene
// Resend/Twilio configurados) — una vez guardado, cerrar esta pestaña no la cancela.
export async function armMeasurementNotification(jobId, { email, whatsapp } = {}, lang = "es") {
  try {
    const r = await fetch(`${JOB_API}/${encodeURIComponent(jobId)}/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email || undefined, whatsapp: whatsapp || undefined, lang }),
    });
    const b = await r.json().catch(() => null);
    if (!r.ok || !b?.ok) {
      return { ok: false, error: b?.error || `El servicio respondió ${r.status}.` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || "No se pudo guardar el aviso." };
  }
}

// Extrae, de la respuesta, el primer resultado con medidas y los números clave.
export function pickMeasurement(resp) {
  const results = resp?.results || [];
  const first = results.find((x) => x?.ok && x?.measurements) || results[0] || null;
  const m = first?.measurements || null;
  const facial = m?.facial || {};
  const capri = m?.capri || {};
  const prog = m?.progressive || {};
  const pd = facial.pdTotalMM ?? null;
  const corridor =
    prog.fittingHeightRightMM ?? prog.fittingHeightLeftMM ??
    facial.corridorHeightRightMM ?? facial.corridorHeightLeftMM ??
    capri.progressiveHeightMM ?? null;
  return {
    ok: Boolean(first?.ok),
    errorCode: first?.errorCode || null,
    error: first?.error || null,
    measurements: m,
    pd,
    pdRight: facial.pdRightMM ?? null,
    pdLeft: facial.pdLeftMM ?? null,
    corridor,
    progressive: capri.progressiveHeightMM ?? prog.fittingHeightRightMM ?? null,
    bifocal: capri.bifocalHeightMM ?? null,
    minRequired: prog.minimumRequiredMM ?? null,
    suitable: prog.suitable ?? null,
    frontImage: resp?.tryOn?.imageDataUrl || null,
    profileImage: resp?.tryOnProfile?.imageDataUrl || null,
    warnings: m?.warnings || [],
    fitScore: m?.fit?.score ?? null,
  };
}

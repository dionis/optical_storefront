// Cliente de medición óptica multimodal para la tienda.
//
// Reutiliza el servicio `vision-measure` que ya corre junto al backend (protocolo
// Capri, medición PD/alturas y render de la montura con Gemini). La tienda le pega
// a través del proxy `/medusa` (ver src/data/medusa.js), así el navegador solo habla
// con su propio origen y la clave del proveedor nunca cruza a un tercer origen.
import { MEDUSA_URL } from "./medusa.js";

const API = `${MEDUSA_URL}/vision-measure`;

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

// Ejecuta la medición. faceImage y sideImage son data URLs de la cámara/subida.
//
// Rendimiento: usamos el modelo RÁPIDO (flash) y NO pedimos la imagen generada por IA
// (renderTryOn:false). Generar la foto con la montura tarda 30-60 s y hace que el
// gateway corte con 502; medir solo tarda ~12 s. El reporte muestra las fotos REALES
// del cliente con las cotas encima. La montura ya se ve puesta en el propio probador.
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

  const payload = {
    faceImage,
    glassesImage: glassesImage || faceImage,
    sideImage: sideImage || undefined,
    provider: "gemini",
    model: "gemini-2.5-flash",
    strategy: "A",
    lang,
    renderTryOn: false,
    renderProfile: false,
    imageEngine: "local",
    extraInstructions: (withReferenceCard ? CARD_HINT : NOCARD_HINT) + specHint,
  };

  // Corta si tarda demasiado (evita esperas eternas en la UI).
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 55000);
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

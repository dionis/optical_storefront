// Tracks which product's try-on studio is open, OUTSIDE React component state.
//
// ProductCard instances get remounted mid-session whenever the catalog swaps from
// the bundled seed to the live Medusa data: Catalog.jsx/Home.jsx key their product
// grids by `product.slug`, and that string differs between the two sources for the
// SAME physical product (seed: normalized SKU, Medusa: the Store API `handle` —
// see catalogStore.js). A shopper who opens "Solicitar Medidas" right as that swap
// lands got silently kicked back to the catalog mid-measurement, because the key
// change unmounts the old ProductCard (with its local `tryOn` state) and mounts a
// fresh one. Keying this store by the normalized SKU instead survives that remount:
// both sources agree on it — Medusa's product title is the scraper's model_name,
// same code the seed's `sku` field holds (see products.js enrichProducts).
import { useSyncExternalStore } from "react";

const normalize = (sku) => String(sku || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

let openKey = null;
const subs = new Set();
function emit() {
  for (const f of subs) f();
}

export function productTryOnKey(product) {
  return normalize(product?.sku || product?.name);
}

export function openTryOn(product) {
  openKey = productTryOnKey(product);
  emit();
}

export function closeTryOn() {
  openKey = null;
  emit();
}

export function useTryOnOpenKey() {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => subs.delete(f); },
    () => openKey,
    () => openKey
  );
}

// ── Trabajo de medición en curso, por producto ──────────────────────────────
//
// La misma reapertura mid-remount de arriba resuelve "el modal se cerró solo", pero
// no "me mandó de vuelta a sacarme las fotos": el jobId, phase y las fotos capturadas
// vivían solo en el estado de React de TryOnStudio, así que un remount los perdía
// igual aunque el modal reapareciera. El trabajo en sí sigue corriendo en el
// servidor pase lo que pase con este componente (measure.py no sabe ni le importa si
// algún navegador lo sigue consultando) — guardar el jobId aquí es lo único que le
// falta al componente nuevo para reconectarse a él en vez de empezar de cero.
// Con el presupuesto de reintentos más largo (ver providers.py) un trabajo puede
// tardar minutos en vez de segundos, así que la ventana para que esto ocurra creció.
const measureJobs = new Map();

export function setMeasureJob(product, info) {
  measureJobs.set(productTryOnKey(product), info);
}

export function getMeasureJob(product) {
  return measureJobs.get(productTryOnKey(product)) || null;
}

export function clearMeasureJob(product) {
  measureJobs.delete(productTryOnKey(product));
}


// ── Resultado GENERADO ya terminado, persistido, por producto ───────────────
//
// El trabajo en curso (arriba) sobrevive a un remount, pero el RESULTADO final
// (las imágenes con los espejuelos puestos + los números) vivía solo en el estado
// de React de TryOnStudio: al CERRAR el estudio el componente se desmonta y esa
// generación — que costó segundos/minutos y una petición a Gemini — se perdía, y
// reabrir obligaba a rehacerla. Lo guardamos en localStorage para que reabrir el
// mismo producto restaure la última generación al instante, sin volver a generar.
//
// Las imágenes son data URLs (base64) y pesan; localStorage ronda los ~5 MB por
// origen, así que guardamos como mucho MAX_RESULTS entradas (las más recientes) y,
// si el navegador rechaza por cuota, vamos descartando la más vieja y reintentando.
const RESULTS_LS_KEY = "rubi.tryon.results.v1";
const MAX_RESULTS = 4;

function readResults() {
  try {
    const raw = localStorage.getItem(RESULTS_LS_KEY);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch { return {}; }
}

function writeResults(map) {
  // Ordena por recencia y va recortando hasta que quepa (o se rinde en silencio).
  let entries = Object.entries(map).sort((a, b) => (b[1]?.savedAt || 0) - (a[1]?.savedAt || 0));
  if (entries.length > MAX_RESULTS) entries = entries.slice(0, MAX_RESULTS);
  while (entries.length) {
    try {
      localStorage.setItem(RESULTS_LS_KEY, JSON.stringify(Object.fromEntries(entries)));
      return true;
    } catch {
      entries.pop(); // descarta la más vieja y reintenta
    }
  }
  try { localStorage.removeItem(RESULTS_LS_KEY); } catch { /* nada */ }
  return false;
}

// Reduce una data URL a un JPEG pequeño para que SIEMPRE quepa en localStorage.
// La generación real pesa mucho (2 imágenes grandes + las 2 fotos); guardarla tal
// cual excedía la cuota y el navegador rechazaba TODO el guardado -> el resultado
// se perdía al salir. A tamaño de pantalla la versión reducida se ve igual.
function downscaleForStore(dataUrl, maxPx = 720, quality = 0.72) {
  return new Promise((resolve) => {
    try {
      if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:") ||
          typeof document === "undefined" || typeof Image === "undefined") {
        resolve(dataUrl || null); return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxPx / Math.max(img.width || 1, img.height || 1));
          const w = Math.max(1, Math.round((img.width || 1) * scale));
          const h = Math.max(1, Math.round((img.height || 1) * scale));
          const cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          cv.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL("image/jpeg", quality));
        } catch { resolve(dataUrl); }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch { resolve(dataUrl || null); }
  });
}

export async function saveMeasureResult(product, payload) {
  const key = productTryOnKey(product);
  if (!key || !payload) return;
  const data = { ...(payload.data || {}) };
  const [fImg, pImg, capF, capS] = await Promise.all([
    downscaleForStore(data.frontImage),
    downscaleForStore(data.profileImage),
    downscaleForStore(payload.frontImg),
    downscaleForStore(payload.sideImg),
  ]);
  data.frontImage = fImg || data.frontImage || null;
  data.profileImage = pImg || data.profileImage || null;
  const slim = { ...payload, data, frontImg: capF || null, sideImg: capS || null, savedAt: Date.now() };
  // La receta (si viene) carga sus propias imágenes grandes: fuera del guardado
  // (redundantes con data.frontImage/profileImage y solo abultan la cuota).
  if (slim.prescription) {
    slim.prescription = { ...slim.prescription, frontImage: null, profileImage: null };
  }
  const map = readResults();
  map[key] = slim;
  writeResults(map);
}

export function getMeasureResult(product) {
  const key = productTryOnKey(product);
  if (!key) return null;
  const map = readResults();
  return map[key] || null;
}

export function clearMeasureResult(product) {
  const key = productTryOnKey(product);
  if (!key) return;
  const map = readResults();
  if (map[key]) { delete map[key]; writeResults(map); }
}

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

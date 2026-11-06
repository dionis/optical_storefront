// La marca que el dueño guarda en el panel (Administración → Configuración de la
// óptica → Marca), aplicada en el navegador sin redesplegar (docs/MULTI-TENANT-TECNICO.md §7.5).
//
//   1. main.jsx llama a applyCachedBrand() ANTES del primer render: la última marca
//      vista se recuerda en localStorage, así una visita repetida no parpadea con
//      los colores del build.
//   2. refreshBrand() pide GET /store/tenant en segundo plano y aplica lo nuevo
//      (o vuelve a los colores del build si el dueño la quitó).
//
// Colores = variables CSS en :root (las mismas que pinta el build, brandVars.js).
// Logos = los getters de TENANT (src/config/tenant.js) leen runtimeLogo(); un
// componente ya pintado lo recoge en su siguiente render.
import { brandVars, HEX_RE } from "./brandVars.js";

const KEY = "tenant_brand_v1";
let current = null;

const valid = (b) => b && HEX_RE.test(b.primary || "") && HEX_RE.test(b.accent || "") && HEX_RE.test(b.primary_dark || "");
const safeUrl = (v) => (typeof v === "string" && (/^https:\/\//.test(v) || /^\/[^/]/.test(v)) ? v : null);

function paint(brand) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const vars = brandVars({ primary: "x", primaryDark: "x", accent: "x" });
  if (!brand) {
    for (const k of Object.keys(vars)) root.style.removeProperty(k);
    return;
  }
  for (const [k, v] of Object.entries(brandVars({ primary: brand.primary, primaryDark: brand.primary_dark, accent: brand.accent }))) {
    root.style.setProperty(k, v);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", brand.primary);
  const mark = safeUrl(brand.logo_mark_url);
  if (mark) document.querySelectorAll('link[rel~="icon"]').forEach((l) => l.setAttribute("href", mark));
}

/** Logo del panel y la tienda guardado por el dueño, o null (entonces el del build). */
export function runtimeLogo(kind) {
  if (!current) return null;
  return safeUrl(kind === "mark" ? current.logo_mark_url : current.logo_url);
}

export function applyBrand(brand) {
  current = valid(brand) ? brand : null;
  paint(current);
  try {
    if (current) localStorage.setItem(KEY, JSON.stringify(current));
    else localStorage.removeItem(KEY);
  } catch {
    /* sin almacenamiento: la marca se aplica igual, solo no se recuerda */
  }
}

export function applyCachedBrand() {
  try {
    const cached = JSON.parse(localStorage.getItem(KEY) || "null");
    if (valid(cached)) {
      current = cached;
      paint(cached);
    }
  } catch {
    /* caché ilegible: se queda la del build hasta refreshBrand() */
  }
}

/** GET /store/tenant con la clave publicable; sin clave (catálogo estático) no hace nada. */
export async function refreshBrand({ url, publishableKey }) {
  if (!url || !publishableKey) return;
  try {
    const r = await fetch(`${url}/store/tenant`, { headers: { "x-publishable-api-key": publishableKey } });
    if (!r.ok) return;
    const brand = (await r.json())?.tenant?.brand ?? null;
    if (JSON.stringify(brand) !== JSON.stringify(current)) applyBrand(brand);
  } catch {
    /* sin red o backend caído: se queda la última conocida */
  }
}

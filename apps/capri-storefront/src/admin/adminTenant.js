// Perfil de la óptica y «Primeros pasos» (GET/POST /admin/tenant,
// GET /admin/tenant/setup). Como el resto de módulos sin hook de idioma, los
// errores salen como CLAVES (`adm.err.tenant.<reason>`); traduce quien pinta.
import { adminFetch } from "./adminApi.js";

const reasonOf = (e) => (e && e.reason) || (e && e.payload && e.payload.reason) || null;
const fieldOf = (e) => (e && e.field) || (e && e.payload && e.payload.field) || null;

export async function fetchTenantProfile() {
  try {
    return await adminFetch("/admin/tenant");
  } catch {
    throw new Error("adm.err.tenant.load_failed");
  }
}

export async function fetchSetup() {
  try {
    return await adminFetch("/admin/tenant/setup");
  } catch {
    throw new Error("adm.err.tenant.load_failed");
  }
}

/** Solo las claves presentes cambian; "" o null borra un campo. */
export async function saveTenantProfile(patch) {
  try {
    return await adminFetch("/admin/tenant", { method: "POST", body: patch });
  } catch (e) {
    const r = reasonOf(e);
    const err = new Error(r ? `adm.err.tenant.${r}` : "adm.err.tenant.save_failed");
    err.field = fieldOf(e);
    throw err;
  }
}

export const SOCIAL_NETWORKS = ["instagram", "facebook", "tiktok", "youtube", "x"];

// ── Marca (GET/POST /admin/tenant/brand, …/revert, …/logo, …/publish) ─────────
function brandError(e, fallback) {
  const r = reasonOf(e);
  const err = new Error(r ? `adm.err.brand.${r}` : fallback);
  err.field = fieldOf(e);
  err.ratio = (e && e.payload && e.payload.ratio) || null;
  return err;
}

export async function fetchBrand() {
  try {
    return await adminFetch("/admin/tenant/brand");
  } catch {
    throw new Error("adm.err.brand.load_failed");
  }
}

/** `{ primary, accent, logo_url, logo_mark_url }` o `{ reset: true }`. */
export async function saveBrand(body) {
  try {
    return await adminFetch("/admin/tenant/brand", { method: "POST", body });
  } catch (e) {
    throw brandError(e, "adm.err.brand.save_failed");
  }
}

export async function revertBrand() {
  try {
    return await adminFetch("/admin/tenant/brand/revert", { method: "POST", body: {} });
  } catch (e) {
    throw brandError(e, "adm.err.brand.save_failed");
  }
}

/** Sube un archivo (File) y devuelve su URL pública; no cambia la marca. */
export async function uploadLogo(kind, file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("adm.err.brand.bad_image"));
    reader.readAsDataURL(file);
  });
  try {
    const r = await adminFetch("/admin/tenant/brand/logo", { method: "POST", body: { kind, data_url: dataUrl } });
    return r.url;
  } catch (e) {
    throw brandError(e, "adm.err.brand.upload_failed");
  }
}

export async function publishBrand() {
  try {
    return await adminFetch("/admin/tenant/brand/publish", { method: "POST", body: {} });
  } catch (e) {
    throw brandError(e, "adm.err.brand.hook_failed");
  }
}

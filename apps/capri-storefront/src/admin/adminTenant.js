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

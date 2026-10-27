// Tiendas físicas (API real /admin/establishments). Módulo sin hook de idioma:
// los errores viajan como CLAVES adm.err.stores.* y traduce quien pinta.
import { adminFetch } from "./adminApi.js";

const reasonKey = (e, fallback) => {
  const r = (e && e.reason) || (e && e.payload && e.payload.reason);
  return r ? `adm.err.stores.${r}` : fallback;
};

export async function fetchStores() {
  return adminFetch("/admin/establishments");
}

export async function createStore({ name, address = "", phone = "" }) {
  try {
    return await adminFetch("/admin/establishments", { method: "POST", body: { name, address, phone } });
  } catch (e) {
    throw new Error(reasonKey(e, "adm.err.stores.saveFailed"));
  }
}

export async function updateStore(id, patch) {
  try {
    return await adminFetch(`/admin/establishments/${encodeURIComponent(id)}`, { method: "POST", body: patch });
  } catch (e) {
    throw new Error(reasonKey(e, "adm.err.stores.saveFailed"));
  }
}

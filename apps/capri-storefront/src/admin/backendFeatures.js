// What the backend this panel talks to can do (GET /version → `features`).
//
// The storefront can be newer than its backend: develop's panel has the
// multi-store tabs while production's backend (built from main) may not have
// their routes yet. Those tabs are shown only when the backend lists
// "multistore"; an older backend, or one that cannot be reached, gets the panel
// it can actually serve instead of tabs that only show errors.
import { ADMIN_API_URL } from "./adminApi.js";

/** Tabs that need the multi-store backend (routes under /admin/pos, /admin/establishments, …). */
export const MULTISTORE_TABS = new Set([
  "pos", "possales", "cash", "mysales", "profile",
  "salesboard", "storecosts", "approvals", "alerts", "stores",
  "posconfig", "audit",
]);

export async function fetchBackendFeatures() {
  try {
    const res = await fetch(`${ADMIN_API_URL}/version`, { cache: "no-store" });
    if (!res.ok) return new Set();
    const body = await res.json();
    return new Set(Array.isArray(body?.features) ? body.features : []);
  } catch {
    return new Set();
  }
}

// Dónde se usa: pestaña «Sincronización del catálogo» de /admin (CatalogSync.jsx)
// y la marca «Nuevo» de Productos (CatalogManager.jsx).
//
// Sin hook de idioma: aquí no hay prosa, solo claves (`adm.sync.*`) que traduce
// quien pinta. El servidor es /admin/catalog-sync (apps/backend/src/api/admin/catalog-sync).
import { adminFetch } from "./adminApi.js";

/** Un modelo es «nuevo» durante estos días desde que el scraper lo creó. */
export const NEW_MODEL_DAYS = 30;

/** Mientras hay una corrida en curso o en cola, el panel se refresca así de seguido. */
export const ACTIVE_POLL_MS = 5000;

export const fetchCatalogSync = () => adminFetch("/admin/catalog-sync");
export const fetchSyncRun = (id) => adminFetch(`/admin/catalog-sync/runs/${encodeURIComponent(id)}`).then((r) => r.run);
export const queueSyncRun = (options) => adminFetch("/admin/catalog-sync/runs", { method: "POST", body: options });
export const cancelSyncRun = (id) =>
  adminFetch(`/admin/catalog-sync/runs/${encodeURIComponent(id)}/cancel`, { method: "POST", body: {} });
export const saveSyncSettings = (patch) =>
  adminFetch("/admin/catalog-sync/settings", { method: "POST", body: patch }).then((r) => r.settings);

/** Clave del motivo de error que manda el servidor (`reason`), con respaldo genérico. */
export const syncErrorKey = (err) => {
  const reason = err?.reason;
  return reason ? `adm.sync.err.${reason}` : "adm.sync.err.generic";
};

/** Tono del chip de estado (clases `.adm-chip.*` de admin.css). */
export const STATUS_TONE = {
  queued: "neutral",
  running: "",
  succeeded: "ok",
  partial: "warn",
  failed: "bad",
  canceled: "neutral",
};

/** ¿Es nuevo este modelo? `firstSeenAt` viene de `product.metadata.first_seen_at`. */
export function isNewModel(firstSeenAt, now = Date.now()) {
  if (!firstSeenAt) return false;
  const t = new Date(firstSeenAt).getTime();
  return Number.isFinite(t) && now - t < NEW_MODEL_DAYS * 86400000;
}

/** Porcentaje 0–100 de una corrida en curso, o null si todavía no hay con qué medirlo. */
export function runPercent(progress) {
  if (!progress) return null;
  const { collections_total: ct, collections_done: cd = 0, position = 0, total = 0, phase } = progress;
  if (phase === "views" || phase === "reconcile") return 99;
  if (!ct) return null;
  const inCollection = total ? position / total : 0;
  return Math.max(1, Math.min(99, Math.round(((cd + inCollection) / ct) * 100)));
}

/** Duración legible ("12 min", "1 h 05 min") entre dos instantes. */
export function duration(from, to) {
  if (!from) return "—";
  const ms = (to ? new Date(to) : new Date()).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const min = Math.round(ms / 60000);
  if (min < 1) return "<1 min";
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

/** Fecha y hora en el idioma elegido. */
export function dateTime(value, lang = "es") {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(lang === "en" ? "en-US" : "es", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

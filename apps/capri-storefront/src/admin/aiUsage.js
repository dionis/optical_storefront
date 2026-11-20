// Dónde se usa: pestaña «Consumo IA» de /admin (AiUsage.jsx) y la insignia del
// menú (AdminDashboard.jsx). Backend: /admin/ai-usage (apps/backend/src/api/admin/ai-usage).
//
// Sin hook de idioma: aquí no hay prosa, solo claves (`adm.ai.*`) que traduce
// quien pinta.
import { adminFetch } from "./adminApi.js";

export const PROVIDERS = ["anthropic", "gemini", "openai", "openrouter", "mistral", "xai", "qwen"];
export const ACTIVITIES = ["ocr", "vision_measure", "tryon_render", "translation", "media_views", "media_video", "other"];
export const ALERT_UNITS = ["usd", "percent", "days"];

/** Tono del chip de estado de cada proveedor (clases `.adm-chip.*` de admin.css). */
export const STATE_TONE = { ok: "ok", low: "warn", empty: "bad", no_credit: "bad", untracked: "neutral" };

/** Estados que piden atención (banner e insignia). */
export const needsAttention = (state) => state === "low" || state === "empty" || state === "no_credit";

const qs = (q) => {
  const p = new URLSearchParams(Object.entries(q || {}).filter(([, v]) => v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const fetchAiUsage = (q) => adminFetch(`/admin/ai-usage${qs(q)}`);
export const fetchAiStatus = () => adminFetch("/admin/ai-usage/status");
export const addCreditEntry = (body) => adminFetch("/admin/ai-usage/entries", { method: "POST", body });
export const deleteCreditEntry = (id) => adminFetch(`/admin/ai-usage/entries/${encodeURIComponent(id)}`, { method: "DELETE" });
export const saveAlert = (body, id) =>
  adminFetch(id ? `/admin/ai-usage/alerts/${encodeURIComponent(id)}` : "/admin/ai-usage/alerts", { method: "POST", body });
export const deleteAlert = (id) => adminFetch(`/admin/ai-usage/alerts/${encodeURIComponent(id)}`, { method: "DELETE" });

/** Clave del motivo de error que manda el servidor (`reason`), con respaldo genérico. */
export const aiErrorKey = (err) => (err?.reason ? `adm.ai.err.${err.reason}` : "adm.ai.err.generic");

/** YYYY-MM-DD de hoy menos `days`, en la hora local del navegador. */
export function isoDay(days = 0, now = new Date()) {
  const d = new Date(now.getTime() - days * 86400000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Costo por llamada con decimales suficientes: una lectura cuesta centavos. */
export function usdFine(v, lang = "es") {
  const n = Number(v || 0);
  return new Intl.NumberFormat(lang === "en" ? "en-US" : "es-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: n !== 0 && Math.abs(n) < 1 ? 4 : 2,
    maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? 4 : 2,
  }).format(n);
}

/** Serie diaria de costo (todos los proveedores sumados) para BarChart, con los días vacíos en 0. */
export function dailySeries(byDay, from, to) {
  const totals = new Map();
  for (const r of byDay || []) totals.set(r.day, (totals.get(r.day) || 0) + Number(r.cost_usd || 0));
  const out = [];
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  for (let d = start; d <= end && out.length < 400; d = new Date(d.getTime() + 86400000)) {
    const key = isoDay(0, d);
    out.push({ label: key.slice(5), value: Math.round((totals.get(key) || 0) * 10000) / 10000 });
  }
  return out;
}

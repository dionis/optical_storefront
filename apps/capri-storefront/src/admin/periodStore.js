// Dónde se usa: la barra de filtros global del panel (GlobalFilterBar.jsx) y
// toda pantalla con cifras por período (Ejecutivo, Pedidos de tienda, Panel de
// ventas, Caja, Estado de cuenta, Vendedores, Auditoría, Mi panel…).
//
// UN solo período para todo el panel, como ya pasa con la tienda
// (useStoreTheme.js → adm_active_store): el operador elige Hoy · Ayer · Semana ·
// Sem. pasada · Mes · Mes pasado · Año · Rango una vez y cada pestaña lo lee con
// `usePeriodFilter()`. Se guarda en localStorage `adm_period` y se avisa con el
// evento `adm:period`, así todas las pantallas montadas se vuelven a pintar.
//
//   const { period, from, to, setPeriod, setRange, label } = usePeriodFilter();
//   fetch(`/admin/…?from=${from}&to=${to}`)
//
// Semántica de cada período (la misma que tenía periodRange en SalesBoard.jsx,
// de la que bebían StoreOrders.usePeriod y el Ejecutivo): semana = lunes→hoy,
// mes = 1→hoy, año = 1 ene→hoy; «pasada/o» = el anterior entero. `datesOf`
// devuelve "YYYY-MM-DD" locales; `boundsOf` los convierte a Date (lo que toman
// analytics.js / realAnalytics.js), igual que StoreOrders.datesOf.
import { useCallback, useMemo, useSyncExternalStore } from "react";

export const PERIODS = ["today", "yesterday", "week", "lastWeek", "month", "lastMonth", "year", "range"];
export const DEFAULT_PERIOD = "month";
const KEY = "adm_period";
const EVENT = "adm:period";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Desde/hasta ("YYYY-MM-DD", hora local) de un período respecto a `today`. */
export function datesOf(period, today = new Date()) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const ago = (n) => ymd(new Date(y, m, today.getDate() - n));
  const dow = today.getDay() || 7; // 1 = lunes … 7 = domingo
  switch (period) {
    case "yesterday": return { from: ago(1), to: ago(1) };
    case "7d": return { from: ago(6), to: ago(0) };
    case "30d": return { from: ago(29), to: ago(0) };
    case "week": return { from: ago(dow - 1), to: ago(0) };
    case "lastWeek": return { from: ago(dow + 6), to: ago(dow) };
    case "month": return { from: ymd(new Date(y, m, 1)), to: ago(0) };
    case "lastMonth": return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
    case "year": return { from: `${y}-01-01`, to: ago(0) };
    case "5y": return { from: `${y - 4}-01-01`, to: ago(0) };
    default: return { from: ago(0), to: ago(0) };
  }
}

/** Límites Date locales de un rango "YYYY-MM-DD" (00:00:00 → 23:59:59.999). */
export const boundsOf = ({ from, to }) => ({ from: new Date(`${from}T00:00:00`), to: new Date(`${to}T23:59:59.999`) });

/**
 * El período EQUIVALENTE anterior, con el que se comparan los KPI:
 *   hoy → ayer · ayer → anteayer · esta semana (lunes→hoy) → la pasada, los
 *   mismos días · semana pasada → la anterior · este mes (1→hoy) → el pasado
 *   hasta el mismo día · mes pasado → el anterior entero · este año → el
 *   pasado hasta la misma fecha · rango → el rango anterior de igual largo.
 */
export function previousRangeOf(period, range, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const shift = (days) => new Date(y, m, d - days);
  const clampDay = (yy, mm, dd) => new Date(yy, mm, Math.min(dd, new Date(yy, mm + 1, 0).getDate()));
  switch (period) {
    case "today": return datesOf("yesterday", now);
    case "yesterday": return datesOf("yesterday", shift(1));
    case "week": return datesOf("week", shift(7));
    case "lastWeek": return datesOf("lastWeek", shift(7));
    case "month": return { from: ymd(new Date(y, m - 1, 1)), to: ymd(clampDay(y, m - 1, d)) };
    case "lastMonth": return datesOf("lastMonth", new Date(y, m - 1, 1));
    case "year": return { from: `${y - 1}-01-01`, to: ymd(clampDay(y - 1, m, d)) };
    default: {
      const day = 86400_000;
      const a = Date.parse(`${range?.from}T00:00:00Z`);
      const b = Date.parse(`${range?.to}T00:00:00Z`);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
      const len = Math.round((b - a) / day) + 1;
      const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
      return { from: iso(a - len * day), to: iso(a - day) };
    }
  }
}

/** Mes "YYYY-MM" que cubre el período (el del `from`): para pantallas mensuales (Resultado por tienda). */
export const monthOf = ({ from }) => String(from || "").slice(0, 7);

// ── Estado compartido ──────────────────────────────────────────────────────
// Un período de la lista se guarda solo por su clave y se recalcula al leer:
// «Hoy» guardado ayer es hoy, no ayer. Solo «Rango» conserva sus fechas.
function normalize(raw) {
  const period = PERIODS.includes(raw?.period) ? raw.period : DEFAULT_PERIOD;
  if (period === "range" && DAY_RE.test(raw?.from || "") && DAY_RE.test(raw?.to || "") && raw.from <= raw.to) return { period, from: raw.from, to: raw.to };
  if (period === "range") return { period: DEFAULT_PERIOD, ...datesOf(DEFAULT_PERIOD) };
  return { period, ...datesOf(period) };
}
function read() {
  try { return normalize(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { return normalize(null); }
}
let snapshot = null;
const getSnapshot = () => (snapshot ||= read());
const SERVER_SNAPSHOT = Object.freeze({ period: DEFAULT_PERIOD, ...datesOf(DEFAULT_PERIOD) });
const getServerSnapshot = () => SERVER_SNAPSHOT;

/** Fija el período global (todas las pantallas montadas se vuelven a pintar). */
export function setPeriodState(next) {
  const value = normalize(next);
  snapshot = value;
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* noop */ }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
  return value;
}
/** Lo guardado, ya normalizado; para módulos sin hook. */
export const readPeriod = () => getSnapshot();

function subscribe(cb) {
  const onEvent = () => cb();
  const onStorage = (e) => { if (!e || e.key === null || e.key === KEY) { snapshot = read(); cb(); } };
  window.addEventListener(EVENT, onEvent);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(EVENT, onEvent); window.removeEventListener("storage", onStorage); };
}

/**
 * El período activo del panel. `setPeriod(p)` elige uno de la lista (y
 * recalcula sus fechas); `setRange(from, to)` pasa a «Rango» con esas fechas
 * (una sola también vale: la otra se conserva, y si se cruzan se iguala);
 * `label(t)` es el texto corto para cabeceras y nombres de archivo.
 */
export function usePeriodFilter() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setPeriod = useCallback((p) => { setPeriodState(p === "range" ? { period: "range", from: getSnapshot().from, to: getSnapshot().to } : { period: p }); }, []);
  const setRange = useCallback((from, to) => {
    const cur = getSnapshot();
    let f = DAY_RE.test(from || "") ? from : cur.from;
    let tt = DAY_RE.test(to || "") ? to : cur.to;
    if (from && !to && f > tt) tt = f;
    if (to && !from && tt < f) f = tt;
    setPeriodState({ period: "range", from: f, to: tt });
  }, []);
  const label = useCallback((t) => (s.period === "range" ? `${s.from} → ${s.to}` : t(`adm.ex.period.${s.period}`)), [s]);
  const range = useMemo(() => ({ from: s.from, to: s.to }), [s.from, s.to]);
  const prevRange = useMemo(() => previousRangeOf(s.period, range), [s.period, range]);
  return { period: s.period, from: s.from, to: s.to, range, prevRange, setPeriod, setRange, label };
}

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
//
// ── Períodos recién empezados ──────────────────────────────────────────────
// Como «Mes» es 1→hoy, el día 1 de cada mes el período activo es un solo día y
// TODA pantalla sale a cero aunque el mes pasado esté lleno de ventas. Pasa
// igual los lunes («Semana» = lunes→hoy) y cada 1 de enero. El dueño abre el
// panel, lo ve vacío y cree que está roto. Tres piezas resuelven eso:
//
//   1. `alternativePeriodsOf(period)` → los períodos a los que tiene sentido
//      saltar para encontrar datos, en orden de «lo más parecido primero». Es
//      la lista que pinta EmptyPeriod.jsx como botones.
//   2. Elección EXPLÍCITA vs. valor por defecto. Lo guardado lleva
//      `explicit: true` solo cuando alguien fijó el período a mano (la barra de
//      filtros y los botones de EmptyPeriod pasan `{ explicit: true }`; un
//      salto de pantalla con `applyPeriodParams` NO lo marca). Se consulta con
//      `hasExplicitPeriod()` y la marca es pegajosa: una vez elegido, nada la
//      borra.
//   3. `autoSwitchPeriod(hasData)` salta al primer alternativo con datos UNA
//      sola vez por sesión y solo si nunca hubo elección explícita, y deja un
//      aviso (`usePeriodNotice()` / `readPeriodNotice()`) que la barra de
//      filtros pinta: «Este mes aún no tiene ventas: mostrando mes pasado».
//      Nunca se mueve el período en silencio — el dueño odia los datos que
//      cambian sin explicación.
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
// `explicit` distingue «lo eligió una persona» de «es el valor por defecto»: sin
// esa marca no se puede saber si mover el período le pisa la elección a nadie.
// Lo guardado por una versión anterior del panel no la lleva, así que cuenta
// como no elegido: lo peor que pasa es un salto automático AVISADO la primera
// vez, que es justo lo que se quiere el día 1 del mes.
function normalize(raw) {
  const period = PERIODS.includes(raw?.period) ? raw.period : DEFAULT_PERIOD;
  const explicit = raw?.explicit === true;
  if (period === "range" && DAY_RE.test(raw?.from || "") && DAY_RE.test(raw?.to || "") && raw.from <= raw.to) return { period, from: raw.from, to: raw.to, explicit };
  if (period === "range") return { period: DEFAULT_PERIOD, ...datesOf(DEFAULT_PERIOD), explicit };
  return { period, ...datesOf(period), explicit };
}
function read() {
  try { return normalize(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { return normalize(null); }
}
let snapshot = null;
const getSnapshot = () => (snapshot ||= read());
// Aviso del último salto automático y «ya lo intentamos»: viven en el módulo, no
// en un componente, para que montar y desmontar pantallas no reinicie ni el
// aviso ni el límite de un salto por sesión.
let notice = null;
let autoTried = false;
const SERVER_SNAPSHOT = Object.freeze({ period: DEFAULT_PERIOD, ...datesOf(DEFAULT_PERIOD), explicit: false });
const getServerSnapshot = () => SERVER_SNAPSHOT;

/**
 * Fija el período global (todas las pantallas montadas se vuelven a pintar).
 * `opts.explicit` marca que lo eligió una persona, no el valor por defecto; la
 * marca es PEGAJOSA (un salto de pantalla posterior cambia el período pero no
 * borra que alguien ya eligió) y apaga el aviso de salto automático, porque a
 * partir de ahí el período que se ve es el que se pidió.
 */
export function setPeriodState(next, { explicit = false } = {}) {
  const chosen = explicit || next?.explicit === true || getSnapshot().explicit === true;
  const value = normalize({ ...next, explicit: chosen });
  snapshot = value;
  if (explicit) notice = null;
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* noop */ }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
  return value;
}
/** Lo guardado, ya normalizado; para módulos sin hook. */
export const readPeriod = () => getSnapshot();

// ── Períodos alternativos ──────────────────────────────────────────────────
// A qué período tiene sentido saltar cuando el activo no trae nada, en orden de
// «lo más parecido primero»: primero el equivalente anterior (la semana pasada,
// el mes pasado), luego se ensancha la ventana (mes, año). Son claves de
// PERIODS y sus fechas salen de `datesOf`, así que lo que se ofrece es siempre
// un período que la barra de filtros también sabe pintar.
//   · Hoy / Ayer → la semana, el mes, el mes pasado, el año.
//   · Semana     → la semana pasada y, si tampoco, mes · mes pasado · año.
//   · Mes        → el mes pasado y el año (el caso del día 1).
//   · Mes pasado → solo el año: más atrás ya no hay período con nombre.
//   · Año        → nada. No existe «año pasado» en PERIODS; ofrecer «Rango»
//                  sería mandar al operador a teclear dos fechas, no un salto.
//   · Rango      → fechas a mano; se ofrece ensanchar a mes · mes pasado · año.
const ALTERNATIVES = {
  today: ["week", "month", "lastMonth", "year"],
  yesterday: ["week", "month", "lastMonth", "year"],
  week: ["lastWeek", "month", "lastMonth", "year"],
  lastWeek: ["month", "lastMonth", "year"],
  month: ["lastMonth", "year"],
  lastMonth: ["year"],
  year: [],
  range: ["month", "lastMonth", "year"],
};

/**
 * Períodos a los que tiene sentido saltar desde `period` (por defecto el
 * activo) para encontrar datos, en orden. Siempre claves de PERIODS, nunca el
 * propio período ni "range".
 */
export function alternativePeriodsOf(period = getSnapshot().period) {
  return (ALTERNATIVES[period] || []).filter((p) => p !== period && p !== "range" && PERIODS.includes(p));
}

// ── Elección explícita y salto automático ──────────────────────────────────

/** ¿Alguien fijó el período a mano alguna vez (y no es solo el valor por defecto)? */
export const hasExplicitPeriod = () => getSnapshot().explicit === true;

/** Marca el período actual como elección explícita sin cambiarlo. */
export function markPeriodExplicit() {
  if (hasExplicitPeriod()) return;
  setPeriodState(getSnapshot(), { explicit: true });
}

/**
 * ¿Queda margen para un salto automático? Una pantalla lo consulta ANTES de
 * ponerse a sondear períodos, para no gastar peticiones cuando ya no puede
 * saltar (hubo elección explícita, ya se saltó o no hay alternativos).
 */
export const canAutoSwitchPeriod = () => !autoTried && !hasExplicitPeriod() && alternativePeriodsOf().length > 0;

/**
 * Salta al PRIMER período alternativo con datos. `hasData(period, { from, to })`
 * lo decide la pantalla (puede devolver booleano o promesa); lo que lance se
 * trata como «sin datos» y se sigue con el siguiente.
 *
 * Reglas que no se rompen:
 *   · solo si nunca hubo elección explícita (ni antes ni durante el sondeo, que
 *     puede ser lento: se vuelve a comprobar justo antes de fijar);
 *   · una sola vez por sesión — `autoTried` se marca ANTES de sondear, así dos
 *     pantallas montadas a la vez no pueden saltar dos veces ni entrar en bucle
 *     si el sondeo falla;
 *   · si salta, deja aviso (`readPeriodNotice()`), nunca se mueve en silencio.
 *
 * Devuelve el aviso `{ fromPeriod, toPeriod }` si saltó, o `null` si no.
 */
export async function autoSwitchPeriod(hasData, now = new Date()) {
  if (!canAutoSwitchPeriod() || typeof hasData !== "function") return null;
  autoTried = true;
  const fromPeriod = getSnapshot().period;
  for (const toPeriod of alternativePeriodsOf(fromPeriod)) {
    const range = datesOf(toPeriod, now);
    let found = false;
    try { found = Boolean(await hasData(toPeriod, range)); } catch { found = false; }
    if (!found) continue;
    if (hasExplicitPeriod()) return null; // alguien eligió mientras sondeábamos: manda él
    notice = { fromPeriod, toPeriod };
    setPeriodState({ period: toPeriod }); // sin `explicit`: no lo eligió nadie, lo elegimos nosotros
    return notice;
  }
  return null;
}

/** El aviso del último salto automático, o `null`; para módulos sin hook. */
export const readPeriodNotice = () => notice;
// En el servidor no hay salto automático que avisar (ni localStorage que leer).
const getServerNotice = () => null;

/** Quita el aviso (el operador ya lo leyó). No toca el período. */
export function dismissPeriodNotice() {
  if (!notice) return;
  notice = null;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT, { detail: getSnapshot() }));
}

/**
 * Aplica `period` o `from`/`to` de unos `params` de salto (contrato de
 * StoreOrders.jsx: go("exec", { period: "week" }) · go("storeorders", { from,
 * to })) al período GLOBAL; ignora lo que no venga. Un período con nombre
 * manda (sigue vivo al cambiar de día); from/to solo definen un rango a medida.
 */
export function applyPeriodParams(p) {
  if (!p) return false;
  if (p.period && PERIODS.includes(p.period) && p.period !== "range") { setPeriodState({ period: p.period }); return true; }
  if (DAY_RE.test(p.from || "") && DAY_RE.test(p.to || "") && p.from <= p.to) { setPeriodState({ period: "range", from: p.from, to: p.to }); return true; }
  return false;
}

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
 *
 * Los dos aceptan `opts` y se lo pasan a `setPeriodState`: quien fija el período
 * porque una PERSONA lo pidió (la barra de filtros, los botones de
 * EmptyPeriod) manda `{ explicit: true }` y así el panel no se lo vuelve a
 * cambiar por debajo.
 */
export function usePeriodFilter() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setPeriod = useCallback((p, opts) => { setPeriodState(p === "range" ? { period: "range", from: getSnapshot().from, to: getSnapshot().to } : { period: p }, opts); }, []);
  const setRange = useCallback((from, to, opts) => {
    const cur = getSnapshot();
    let f = DAY_RE.test(from || "") ? from : cur.from;
    let tt = DAY_RE.test(to || "") ? to : cur.to;
    if (from && !to && f > tt) tt = f;
    if (to && !from && tt < f) f = tt;
    setPeriodState({ period: "range", from: f, to: tt }, opts);
  }, []);
  const label = useCallback((t) => (s.period === "range" ? `${s.from} → ${s.to}` : t(`adm.ex.period.${s.period}`)), [s]);
  const range = useMemo(() => ({ from: s.from, to: s.to }), [s.from, s.to]);
  const prevRange = useMemo(() => previousRangeOf(s.period, range), [s.period, range]);
  return { period: s.period, from: s.from, to: s.to, range, prevRange, setPeriod, setRange, label, explicit: s.explicit === true };
}

/**
 * El aviso del salto automático, para que el panel lo DIGA: `{ notice:
 * { fromPeriod, toPeriod } | null, dismiss }`. Se refresca con el mismo evento
 * que el período, así aparece en el mismo pintado en que cambian las cifras.
 */
export function usePeriodNotice() {
  const n = useSyncExternalStore(subscribe, readPeriodNotice, getServerNotice);
  const dismiss = useCallback(() => dismissPeriodNotice(), []);
  return useMemo(() => ({ notice: n, dismiss }), [n, dismiss]);
}

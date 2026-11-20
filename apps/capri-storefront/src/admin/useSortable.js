// Dónde se usa: todas las tablas del panel (/admin) cuyas cabeceras ordenan la
// tabla: Pedidos de tienda, Ventas de tienda, Cobros pendientes, Caja, Estado
// de cuenta, Panel de ventas, Auditoría, Resultado por tienda, Estado de
// tienda… Un solo hook para no repetir el «¿por qué columna y en qué sentido?»
// en cada pantalla, con el mismo comportamiento en todas:
//
//   import { useSortable } from "./useSortable.js";
//   import SortTh from "./SortTh.jsx";
//
//   const sorted = useSortable(rows, {
//     id: "store-orders",            // opcional: recuerda la última ordenación en localStorage (adm.sort.<id>)
//     defaultKey: "sold_at",         // opcional: columna inicial (null = el orden en que llegan las filas)
//     defaultDir: "desc",            // "asc" | "desc"
//     getters: {                     // opcional: cómo leer cada columna cuando no es `row[key]`
//       number: (r) => saleNumber(r, t),
//       cost: (r) => costOf(r),
//     },
//     deps: [lang, ctx],             // opcional: lo que leen los getters además de la fila
//   });
//   // sorted.rows → las filas ordenadas (misma referencia si no hay orden activo)
//   // sorted.sort → { key, dir }
//   // sorted.toggle(key, first?) → al pulsar una cabecera: misma columna invierte el sentido,
//   //                              otra columna la activa en `first` ("asc" por defecto)
//   // sorted.set(key, dir) / sorted.reset()
//
//   <thead><tr>
//     <SortTh col="number" sort={sorted.sort} onSort={sorted.toggle}>{t("adm.ex.so.number")}</SortTh>
//     <SortTh col="total" sort={sorted.sort} onSort={sorted.toggle} align="r">{t("adm.ex.so.price")}</SortTh>
//     <th>{t("…")}</th>                 // una columna sin `col` no ordena
//   </tr></thead>
//   <tbody>{sorted.rows.map(…)}</tbody>
//   <tfoot>…</tfoot>                    // los totales no pasan por el hook: siempre quedan abajo
//
// Reglas de comparación (compareValues): números por valor, fechas (Date o
// ISO "YYYY-MM-DD…") por instante, textos con localeCompare (numérico, sin
// distinguir mayúsculas ni acentos), booleanos true > false. Lo vacío (null,
// undefined, "") va SIEMPRE al final, suba o baje la columna. Orden estable:
// dos filas iguales conservan el orden en que llegaron.
//
// Las filas de totales (tfoot o tr.total) se pintan aparte y nunca se ordenan.
// En móvil las tablas `responsive` esconden el thead: ahí no se puede ordenar
// (la tarjeta de cada fila sigue leyéndose en el orden por defecto).
import { useCallback, useMemo, useState } from "react";

const LS_PREFIX = "adm.sort.";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const NUMERIC = /^-?\d+(?:\.\d+)?$/;

const isEmpty = (v) => v == null || v === "" || (typeof v === "number" && Number.isNaN(v));

/** Lo que de verdad se compara de un valor: número, instante o texto. */
function rank(v) {
  if (typeof v === "number") return { n: v };
  if (typeof v === "boolean") return { n: v ? 1 : 0 };
  if (v instanceof Date) return { n: v.getTime() };
  if (typeof v === "string") {
    const s = v.trim();
    if (NUMERIC.test(s)) return { n: Number(s) };
    if (ISO_DATE.test(s)) { const t = Date.parse(s.length === 10 ? `${s}T12:00:00` : s); if (!Number.isNaN(t)) return { n: t }; }
    return { s };
  }
  return { s: String(v) };
}

/** -1 / 0 / 1 con las reglas de arriba; lo vacío siempre después (sea cual sea el sentido). */
export function compareValues(a, b, dir = "asc") {
  const ea = isEmpty(a);
  const eb = isEmpty(b);
  if (ea && eb) return 0;
  if (ea) return 1;
  if (eb) return -1;
  const ra = rank(a);
  const rb = rank(b);
  let c;
  if (ra.n != null && rb.n != null) c = ra.n - rb.n;
  else c = String(ra.s ?? ra.n).localeCompare(String(rb.s ?? rb.n), undefined, { numeric: true, sensitivity: "base" });
  if (c === 0) return 0;
  const sign = c < 0 ? -1 : 1;
  return dir === "desc" ? -sign : sign;
}

/** Copia ordenada y estable de `rows` por `key` (con `getters[key]` si existe). */
export function sortRows(rows, { key, dir = "asc" }, getters = {}) {
  if (!key || !Array.isArray(rows) || rows.length < 2) return rows || [];
  const get = typeof getters[key] === "function" ? getters[key] : (r) => r?.[key];
  const decorated = rows.map((r, i) => ({ r, i, v: get(r) }));
  decorated.sort((a, b) => compareValues(a.v, b.v, dir) || a.i - b.i);
  return decorated.map((d) => d.r);
}

const readLs = (id) => {
  if (!id) return null;
  try {
    const raw = localStorage.getItem(LS_PREFIX + id);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v.key === "string" && (v.dir === "asc" || v.dir === "desc") ? v : null;
  } catch { return null; }
};
const writeLs = (id, sort) => {
  if (!id) return;
  try {
    if (sort.key) localStorage.setItem(LS_PREFIX + id, JSON.stringify(sort));
    else localStorage.removeItem(LS_PREFIX + id);
  } catch { /* almacenamiento bloqueado: se ordena igual, solo no se recuerda */ }
};

/**
 * @param {Array} rows
 * @param {{ id?: string, defaultKey?: string|null, defaultDir?: "asc"|"desc", getters?: Record<string, (row:any)=>any> }} opts
 * @returns {{ rows: Array, sort: { key: string|null, dir: "asc"|"desc" }, toggle: (key: string, first?: "asc"|"desc") => void, set: (key: string|null, dir?: "asc"|"desc") => void, reset: () => void }}
 */
export function useSortable(rows, { id, defaultKey = null, defaultDir = "asc", getters, deps = [] } = {}) {
  const [sort, setSort] = useState(() => readLs(id) || { key: defaultKey, dir: defaultDir });
  const set = useCallback((key, dir = "asc") => {
    const next = { key: key || null, dir: dir === "desc" ? "desc" : "asc" };
    setSort(next);
    writeLs(id, next);
  }, [id]);
  const toggle = useCallback((key, first = "asc") => {
    setSort((cur) => {
      const next = cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: first === "desc" ? "desc" : "asc" };
      writeLs(id, next);
      return next;
    });
  }, [id]);
  const reset = useCallback(() => set(defaultKey, defaultDir), [set, defaultKey, defaultDir]);
  // `getters` suele ser un objeto nuevo en cada render: se reordena cuando cambian filas u orden
  // (o `deps`, p. ej. [lang, ctx] si un getter lee de ahí), no por la identidad del objeto.
  const sorted = useMemo(() => sortRows(rows, sort, getters || {}), [rows, sort.key, sort.dir, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { rows: sorted, sort, toggle, set, reset };
}

export default useSortable;

// Dónde se usa: DataTable.jsx (y cualquier tabla del panel que quiera «mostrar /
// ocultar» columnas). Regla del dueño: la lista no se recorta — el número, el
// cliente, la marca, el modelo… están SIEMPRE disponibles — y quien mira elige
// con casillas en la cabecera qué columnas ver. Lo elegido se recuerda por tabla
// en localStorage (adm.cols.<id>), y lo recordado sobrevive a que una pantalla
// añada columnas nuevas: se guardan solo las desviaciones (qué encendió y qué
// apagó quien mira), nunca la lista completa.
//
//   const cols = useColumns("pos-sales", COLS, { defaults?: ["number", "total"] });
//   cols.visible      → las columnas visibles, en el orden de `COLS` (objetos)
//   cols.keys         → sus claves
//   cols.isOn(key)    → true si esa columna se ve
//   cols.toggle(key)  → enciende / apaga una (las `always: true` no se apagan)
//   cols.all()        → todas encendidas
//   cols.essentials() → solo las `essential: true` (si ninguna lo es, todas)
//   cols.reset()      → lo de serie: olvida lo guardado
//   cols.set(keys)    → exactamente esas (y las `always`)
//   cols.custom       → true si hay algo guardado distinto de lo de serie
//
// Columna: { key, essential?: true, hiddenByDefault?: true, always?: true }.
// De serie se ve todo menos `hiddenByDefault` (o solo `defaults` si se pasa);
// `always` se ve siempre y no sale en el selector (una columna de acciones).
import { useCallback, useMemo, useState } from "react";

const LS_PREFIX = "adm.cols.";

const readLs = (id) => {
  if (!id) return null;
  try {
    const raw = localStorage.getItem(LS_PREFIX + id);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && Array.isArray(v.on) && Array.isArray(v.off) ? { on: v.on.filter((k) => typeof k === "string"), off: v.off.filter((k) => typeof k === "string") } : null;
  } catch { return null; }
};
const writeLs = (id, prefs) => {
  if (!id) return;
  try {
    if (prefs && (prefs.on.length || prefs.off.length)) localStorage.setItem(LS_PREFIX + id, JSON.stringify(prefs));
    else localStorage.removeItem(LS_PREFIX + id);
  } catch { /* almacenamiento bloqueado: se elige igual, solo no se recuerda */ }
};

/** Si la columna se ve de serie (sin nada guardado). */
export function defaultOn(col, defaults) {
  if (col.always) return true;
  if (Array.isArray(defaults)) return defaults.includes(col.key);
  return !col.hiddenByDefault;
}

/** Visibilidad de una columna con las desviaciones guardadas encima de lo de serie. */
export function columnOn(col, prefs, defaults) {
  if (col.always) return true;
  if (prefs?.off?.includes(col.key)) return false;
  if (prefs?.on?.includes(col.key)) return true;
  return defaultOn(col, defaults);
}

/** Las desviaciones que dejan visibles exactamente `keys` (más las `always`). */
export function prefsFor(cols, keys, defaults) {
  const want = new Set(keys);
  const on = [];
  const off = [];
  for (const c of cols) {
    if (c.always) continue;
    const d = defaultOn(c, defaults);
    const v = want.has(c.key);
    if (v && !d) on.push(c.key);
    if (!v && d) off.push(c.key);
  }
  return { on, off };
}

/**
 * @param {string} id       nombre de la tabla (clave de localStorage); sin él no se recuerda
 * @param {Array<{key:string, essential?:boolean, hiddenByDefault?:boolean, always?:boolean}>} cols
 * @param {{ defaults?: string[] }} opts
 */
export function useColumns(id, cols, { defaults } = {}) {
  const [prefs, setPrefs] = useState(() => readLs(id));
  const save = useCallback((next) => { setPrefs(next); writeLs(id, next); }, [id]);
  const list = Array.isArray(cols) ? cols : [];
  const defKey = Array.isArray(defaults) ? defaults.join("|") : "";

  const visible = useMemo(() => list.filter((c) => columnOn(c, prefs, defaults)), [list, prefs, defKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const keys = useMemo(() => visible.map((c) => c.key), [visible]);
  const isOn = useCallback((key) => keys.includes(key), [keys]);

  const set = useCallback((wanted) => save(prefsFor(list, wanted, defaults)), [list, defKey, save]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = useCallback((key) => {
    const col = list.find((c) => c.key === key);
    if (!col || col.always) return;
    const cur = list.filter((c) => columnOn(c, prefs, defaults)).map((c) => c.key);
    set(cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]);
  }, [list, prefs, defKey, set]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useCallback(() => set(list.map((c) => c.key)), [list, set]);
  const essentials = useCallback(() => {
    const ess = list.filter((c) => c.essential);
    set((ess.length ? ess : list).map((c) => c.key));
  }, [list, set]);
  const reset = useCallback(() => save(null), [save]);
  const custom = Boolean(prefs && (prefs.on.length || prefs.off.length));

  return { visible, keys, isOn, toggle, set, all, essentials, reset, custom };
}

export default useColumns;

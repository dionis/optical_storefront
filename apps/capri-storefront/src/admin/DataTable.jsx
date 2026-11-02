// Dónde se usa: las tablas del panel (/admin) que listan ventas, pedidos,
// cobros, caja, vendedores… Una sola tabla para todas, con lo que el dueño
// pidió: NUNCA una lista recortada (todas las columnas existen siempre) y en la
// cabecera un selector con casillas para elegir cuáles ver (useColumns.js,
// recordado por tabla). Trae además lo que cada pantalla repetía a mano:
// cabeceras que ordenan (useSortable.js + SortTh.jsx), `data-label` por celda
// para que en el móvil cada fila sea una tarjeta, fila de totales, desplazamiento
// interno con cabecera fija, fila clicable (ratón y Enter) y el bloque de
// exportación con las MISMAS columnas que se ven (tableSpecFrom → ReportDoc).
//
//   <DataTable id="pos-sales" cols={cols} rows={rows} rowKey="id"
//     title={t("…")} right={<ExportMenu report={report} …/>}
//     totals={{ total: 1234, balance: 80 }} totalsLabel="Total"
//     defaultSort={{ key: "created_at", dir: "desc" }} getters={{ status: (r) => … }}
//     onRowClick={(row) => …} rowClass={(row) => "muted"} rowTitle="Abrir"
//     maxHeight="60vh" dense sticky emptyText="…" emptyIcon="receipt" loading
//     expanded={(row) => openId === row.id ? <CollectRow …/> : null}   // una fila extra (<tr>) bajo esa fila
//     defaults={["number", "total"]} />                                   // columnas de serie (si no: las no hiddenByDefault)
//
// Columna: {
//   key,                      // única; `row[key]` salvo `get`
//   header,                   // texto de la cabecera (ya traducido)
//   get?(row),                // el valor crudo (ordena, exporta y, sin `render`, se pinta)
//   type?: "text" | "money" | "int" | "pct" | "date" | "datetime" | "chip" | "bool" | "action",
//   align?: "" | "r" | "c",   // de serie: a la derecha lo numérico
//   width?,                   // ancho orientativo (caracteres, como en Excel) para el reporte
//   essential?: true,         // entra en «Esenciales» (y, con `hiddenByDefault` en el resto, es lo de serie)
//   hiddenByDefault?: true,   // apagada hasta que quien mira la enciende
//   always?: true,            // siempre visible y fuera del selector (acciones)
//   sortable?: false,         // de serie toda columna ordena (menos "action")
//   sortValue?(row),          // por qué ordenar cuando no es el valor crudo
//   render?(row) → nodo,      // la celda en pantalla (si falta, el crudo formateado por `type`)
//   text?(row) → string,      // la celda en el PDF/Excel/CSV (si falta, el crudo formateado por `type`)
//   tone?(row) → "ok"|"warn"|"bad"|"gold"|"neutral",   // color del chip (type "chip")
//   cls?(row) → string,       // clases extra de la celda
//   totalRender?(v) → nodo,   // la celda de totales (si falta, `v` formateado por `type`)
//   help?,                    // tooltip de la cabecera
//   export?: false,           // fuera del reporte aunque se vea (una columna de botones)
// }
//
// Exportar: `tableSpecFrom(cols, visibleKeys, rows, totals, { title, totalsLabel, empty })`
// devuelve el bloque `tables[i]` de ReportDoc con `hidden: true` en las columnas
// apagadas, y ReportDoc las deja fuera del papel, del Excel y del CSV.
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { money, shortDate } from "./adminOrders.js";
import { useColumns } from "./useColumns.js";
import { useSortable } from "./useSortable.js";
import SortTh from "./SortTh.jsx";
import "./tables.css";

const NUMERIC = new Set(["money", "int", "pct"]);
const locale = (lang) => (lang === "en" ? "en-US" : "es-US");

/** Valor crudo de una columna (lo que ordena y lo que va al Excel). */
export const rawOf = (c, r) => (typeof c.get === "function" ? c.get(r) : c.key != null ? r?.[c.key] : undefined);

/** Valor formateado por tipo, como texto (pantalla sin `render`, y exportación sin `text`). */
export function formatCell(v, type, lang, t) {
  if (v == null || v === "" || (typeof v === "number" && Number.isNaN(v))) return "";
  if (type === "money") return money(v, "usd", lang);
  if (type === "int") return (Number(v) || 0).toLocaleString(locale(lang));
  if (type === "pct") return Number.isNaN(Number(v)) ? String(v) : `${Math.round(Number(v) * 10) / 10}%`;
  if (type === "date") return shortDate(v, lang);
  if (type === "datetime") { const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString(locale(lang), { dateStyle: "short", timeStyle: "short" }); }
  if (type === "bool") return v ? t("adm.tbl.yes") : t("adm.tbl.no");
  return String(v);
}

const alignOf = (c) => (c.align ? c.align : NUMERIC.has(c.type) ? "r" : "");
const baseCls = (c) => [alignOf(c), NUMERIC.has(c.type) ? "num" : "", c.type === "action" ? "adm-noprint" : ""].filter(Boolean).join(" ");
const cellCls = (c, r) => [baseCls(c), typeof c.cls === "function" ? c.cls(r) || "" : ""].filter(Boolean).join(" ");

/**
 * El bloque `tables[i]` de ReportDoc.jsx con las columnas visibles: las apagadas
 * van con `hidden: true` (ReportDoc las omite). `text`/`get`/`type`/`width`
 * pasan tal cual; una columna `export: false` o de acciones no viaja.
 */
export function tableSpecFrom(cols, visibleKeys, rows, totals, extra = {}) {
  const on = new Set(visibleKeys || []);
  return {
    ...extra,
    cols: (cols || []).filter((c) => c.export !== false && c.type !== "action").map((c) => ({
      header: c.header,
      key: c.key,
      get: (r) => rawOf(c, r),
      type: c.type === "datetime" ? "text" : c.type === "bool" || c.type === "chip" ? "text" : c.type,
      width: c.width,
      align: alignOf(c) || undefined,
      ...(typeof c.text === "function" ? { text: c.text } : c.type === "datetime" || c.type === "bool" ? { text: (r) => formatCell(rawOf(c, r), c.type, extra.lang, extra.t || ((k) => k)) } : {}),
      ...(typeof c.cls === "function" ? { cls: c.cls } : {}),
      ...(c.type === "chip" ? { tag: true } : {}),
      hidden: !on.has(c.key),
    })),
    rows: rows || [],
    ...(totals ? { totals } : {}),
  };
}

/* El globo del selector va por portal al armazón (.adm-shell, hereda los tokens y el modo oscuro;
   si no existe, al body): dentro de un acordeón (overflow: hidden) o de un <main> animado
   (transform) un `position: fixed` queda recortado o descolocado. */
const PHONE = 768;
function popHost() {
  if (typeof document === "undefined") return null;
  return document.querySelector(".adm-shell") || document.body;
}
/** Posición fija bajo el botón, pegada a su borde derecho y sin salirse de la ventana; en el móvil, abajo a lo ancho. */
function placePop(anchor, pop) {
  if (!anchor || !pop) return null;
  const vw = window.innerWidth, vh = window.innerHeight, pad = 8, gap = 6;
  if (vw <= PHONE) return { left: 12, right: 12, bottom: 12, maxHeight: Math.round(vh * 0.7) };
  const a = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let left = Math.min(Math.max(pad, a.right - w), vw - w - pad);
  let top = a.bottom + gap;
  if (top + h > vh - pad && a.top - gap - h >= pad) top = a.top - gap - h;
  top = Math.max(pad, top);
  return { top, left, maxHeight: Math.max(160, vh - top - pad) };
}

/** Botón «Columnas» con el globo de casillas: una por columna, más Todas / Esenciales / Restablecer. */
export function ColumnPicker({ cols, columns, label }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const id = useId();
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (!ref.current?.contains(e.target) && !popRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") { setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return undefined; }
    const update = () => setPos(placePop(btnRef.current, popRef.current));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open]);
  const pickable = (cols || []).filter((c) => !c.always);
  const n = pickable.filter((c) => columns.isOn(c.key)).length;
  const hasEss = pickable.some((c) => c.essential);
  const host = open ? popHost() : null;
  const style = pos ? { ...pos, visibility: "visible" } : { visibility: "hidden" };
  return (
    <span className={`dt-picker adm-noprint ${open ? "open" : ""}`} ref={ref}>
      <button ref={btnRef} type="button" className="btn-xs dt-picker-btn" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} title={t("adm.tbl.columnsHint")} onClick={() => setOpen((o) => !o)}>
        <Icon name="eye" size={13} /> {label || t("adm.tbl.columns")} <small className={columns.custom ? "custom" : ""}>{t("adm.tbl.shown", { n, total: pickable.length })}</small>
      </button>
      {open && host && createPortal(
        <div ref={popRef} className={`dt-pop ${pickable.length > 12 ? "wide" : ""}`} id={id} role="dialog" aria-label={t("adm.tbl.columnsHint")} style={style}>
          <div className="dt-pop-tools">
            <button type="button" className="btn-xs" onClick={columns.all}>{t("adm.tbl.all")}</button>
            {hasEss && <button type="button" className="btn-xs" onClick={columns.essentials}>{t("adm.tbl.essentials")}</button>}
            <button type="button" className="btn-xs" onClick={columns.reset} disabled={!columns.custom}>{t("adm.tbl.reset")}</button>
          </div>
          <ul className="dt-pop-list">
            {pickable.map((c) => (
              <li key={c.key}>
                <label className={c.essential ? "ess" : ""}>
                  <input type="checkbox" checked={columns.isOn(c.key)} onChange={() => columns.toggle(c.key)} />
                  <span>{c.header}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>,
        host,
      )}
    </span>
  );
}

export default function DataTable({
  id, cols, rows, totals, totalsLabel, rowKey = "id", onRowClick, rowClass, rowTitle, activeKey,
  sort: external, defaultSort, getters, dense = false, sticky = true, maxHeight,
  emptyText, emptyIcon = "receipt", title, count, right, loading = false, expanded, defaults,
  columns: externalColumns, className = "", tableClassName = "", bar = true, children,
}) {
  const { t, lang } = useLang();
  const list = useMemo(() => (Array.isArray(cols) ? cols.filter(Boolean) : []), [cols]);
  // `columns` de fuera (useColumns en el padre) cuando el selector va en otro sitio (p. ej. la cabecera de un acordeón, con bar={false}).
  const own = useColumns(id, list, { defaults });
  const columns = externalColumns || own;
  const data = Array.isArray(rows) ? rows : [];
  // Ordena por `sortValue`, si no por el crudo (`get` o row[key]); los `getters` de fuera mandan.
  const sortGetters = useMemo(() => {
    const g = {};
    for (const c of list) g[c.key] = typeof c.sortValue === "function" ? c.sortValue : (r) => rawOf(c, r);
    return { ...g, ...(getters || {}) };
  }, [list, getters]);
  const internal = useSortable(data, { id: id ? `dt-${id}` : undefined, defaultKey: defaultSort?.key ?? null, defaultDir: defaultSort?.dir || "asc", getters: sortGetters, deps: [lang, sortGetters] });
  const sorted = external || internal;
  const visible = columns.visible;
  const keyOf = (r, i) => (typeof rowKey === "function" ? rowKey(r, i) : r?.[rowKey] ?? i);
  const clickable = typeof onRowClick === "function";
  const onKey = (r) => (e) => { if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); onRowClick(r); } };
  const colSpan = Math.max(1, visible.length);
  const cell = (c, r) => {
    if (typeof c.render === "function") { const out = c.render(r); return out == null || out === "" ? <span className="dt-empty">—</span> : out; }
    const v = rawOf(c, r);
    const text = formatCell(v, c.type, lang, t);
    if (text === "") return <span className="dt-empty">—</span>;
    if (c.type === "chip") return <span className={`adm-chip ${typeof c.tone === "function" ? c.tone(r) || "" : ""}`}>{text}</span>;
    return text;
  };
  const totalCell = (c, i) => {
    const v = totals?.[c.key];
    if (v == null || v === "") return i === 0 ? <td key={c.key} data-label={totalsLabel || t("adm.tbl.total")} className="full">{totalsLabel || t("adm.tbl.total")}</td> : <td key={c.key} className={baseCls(c) || undefined} />;
    const node = typeof c.totalRender === "function" ? c.totalRender(v) : formatCell(v, c.type, lang, t);
    return <td key={c.key} data-label={c.header} className={baseCls(c) || undefined}><b>{node}</b></td>;
  };
  const n = count ?? data.length;

  const table = (
    <table className={`adm-table responsive dt-table ${dense ? "dense" : ""} ${tableClassName}`.trim()}>
      <thead>
        <tr>
          {visible.map((c) => (
            <SortTh key={c.key} col={c.sortable === false || c.type === "action" ? undefined : c.key} sort={sorted.sort} onSort={sorted.toggle} align={alignOf(c)} help={c.help} className={c.type === "action" ? "adm-noprint" : ""} style={c.minWidth ? { minWidth: c.minWidth } : undefined}>
              {c.header}
            </SortTh>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.rows.map((r, i) => {
          const k = keyOf(r, i);
          const extra = typeof expanded === "function" ? expanded(r) : null;
          const cls = [clickable ? "ord-row" : "", activeKey != null && activeKey === k ? "open" : "", typeof rowClass === "function" ? rowClass(r) || "" : ""].filter(Boolean).join(" ");
          return (
            <Fragment key={k}>
              <tr className={cls || undefined} onClick={clickable ? () => onRowClick(r) : undefined} onKeyDown={clickable ? onKey(r) : undefined} tabIndex={clickable ? 0 : undefined} title={clickable ? rowTitle || t("adm.tbl.openRow") : undefined}>
                {visible.map((c) => <td key={c.key} data-label={c.header} className={cellCls(c, r) || undefined}>{cell(c, r)}</td>)}
              </tr>
              {extra}
            </Fragment>
          );
        })}
        {!loading && data.length === 0 && (
          <tr className="dt-empty-row"><td colSpan={colSpan} className="full"><div className="adm-empty"><Icon name={emptyIcon} size={32} /><b>{emptyText || t("adm.tbl.empty")}</b></div></td></tr>
        )}
      </tbody>
      {totals && data.length > 0 && <tfoot><tr>{visible.map(totalCell)}</tr></tfoot>}
    </table>
  );

  return (
    <div className={`dt ${className}`.trim()}>
      {bar && (
        <div className="dt-bar">
          <div className="dt-bar-main">
            {title && <h3 className="dt-title">{title}</h3>}
            <span className="dt-count adm-chip neutral" title={t("adm.tbl.rows", { n })}>{t("adm.tbl.rows", { n })}</span>
            {loading && <span className="dt-loading">{t("adm.ord.loading")}</span>}
            {children}
          </div>
          <div className="dt-bar-tools">
            {right}
            <ColumnPicker cols={list} columns={columns} />
          </div>
        </div>
      )}
      {maxHeight ? <div className={`acc-scroll dt-scroll ${sticky ? "sticky" : ""}`} style={{ maxHeight }}>{table}</div> : <div className="dt-wrap">{table}</div>}
    </div>
  );
}

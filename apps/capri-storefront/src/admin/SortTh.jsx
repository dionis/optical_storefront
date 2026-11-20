// Dónde se usa: cabeceras de las tablas del panel que ordenan la tabla (va con
// useSortable.js, que tiene la guía completa). Un <th> con un botón dentro: el
// texto de la columna y una flecha que se enciende en la columna activa
// (▲ asc / ▼ desc, apagada en las demás). Accesible: botón de verdad (Enter /
// espacio), aria-sort en el <th> y el aviso «Ordenar por…» como título.
//
//   <SortTh col="total" sort={sorted.sort} onSort={sorted.toggle} align="r">Total</SortTh>
//
//   col      clave que recibe `onSort` (la misma de `getters` / `row[col]`); sin `col` es un <th> normal
//   sort     { key, dir } del hook
//   onSort   (col, first) → normalmente `sorted.toggle`
//   align    "r" | "num" | "c" | "" — clase del <th> (las numéricas a la derecha; `num` en las tablas del estado de cuenta)
//   first    sentido con que arranca la columna al elegirla: "asc" | "desc".
//            Por defecto "desc" si align es "r" o "num" (lo numérico: de mayor a menor), si no "asc".
//   help     título (tooltip) propio; por defecto «Ordenar por {columna}»
//   className / colSpan / scope / style: pasan al <th>
import { useLang } from "../i18n/LanguageContext.jsx";
import "./tables.css";

export default function SortTh({ col, sort, onSort, align = "", first, help, className = "", children, ...rest }) {
  const { t } = useLang();
  const cls = [align, className].filter(Boolean).join(" ");
  if (!col || typeof onSort !== "function") return <th className={cls || undefined} {...rest}>{children}</th>;
  const on = sort?.key === col;
  const dir = on ? sort.dir : null;
  const start = first || (align === "r" || align === "num" ? "desc" : "asc");
  const text = typeof children === "string" ? children : "";
  const title = help || (text ? t("adm.tbl.sortBy", { col: text }) : t("adm.tbl.sort"));
  return (
    <th scope="col" className={`sortable ${on ? "on" : ""} ${cls}`.trim()} aria-sort={on ? (dir === "desc" ? "descending" : "ascending") : "none"} {...rest}>
      <button type="button" className="sort-btn" onClick={() => onSort(col, start)} title={title}>
        <span className="sort-label">{children}</span>
        <span className="sort-arr" aria-hidden="true">{dir === "desc" ? "▼" : "▲"}</span>
      </button>
    </th>
  );
}

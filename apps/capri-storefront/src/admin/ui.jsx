// Dónde se usa: todo el panel — piezas comunes para que CADA tarjeta sea
// accionable: cabecera con título, ayuda ("¿qué es esto?"), botón de ir a la
// pantalla relacionada y exportar (CSV / PDF). `Card` envuelve el contenido y
// lleva su propio nodo para imprimirlo o volcarlo a CSV sin cablear nada.
import { useEffect, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import HelpTip from "./HelpTip.jsx";
import { downloadText, elementToCsv, printElement, rowsToCsv } from "./exportUtils.js";
import { downloadXlsx } from "./exportXlsx.js";
import { exportReport } from "./ReportDoc.jsx";

/**
 * Alto de gráfico proporcional a la pantalla (los SVG necesitan un número):
 * `fraction` de la altura de la ventana acotado entre `min` y `max`, y se
 * recalcula al redimensionar o girar el móvil.
 */
export function useChartHeight(fraction = 0.21, min = 130, max = 230) {
  const calc = () => Math.round(Math.min(max, Math.max(min, (typeof window !== "undefined" ? window.innerHeight : 800) * fraction)));
  const [h, setH] = useState(calc);
  useEffect(() => {
    const on = () => setH(calc());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fraction, min, max]);
  return h;
}

/**
 * Ayuda «i» de una tarjeta: abre la misma ventana que los «?» (HelpTip.jsx),
 * delante de la pantalla y con el fondo desenfocado, con `title` y `text` ya
 * traducidos. Antes era un globo pequeño; el dueño pidió (7-nov-2026) que toda
 * ayuda se abra en ventana.
 */
export function InfoTip({ text, title }) {
  const { t } = useLang();
  if (!text) return null;
  return (
    <span className="adm-tip">
      <HelpTip variant="info" title={title || t("adm.ui.help")} body={text} label={t("adm.ui.help")} />
    </span>
  );
}

/**
 * Menú de exportación de un nodo: CSV (de sus tablas/KPI, o de `csv` si se
 * pasan columnas+filas explícitas), PDF (impresión aislada del nodo) y, si se
 * pasa `xlsx`, un libro Excel real (exportXlsx.js). `xlsx` es
 * `{ filename, sheets }` o una función que lo devuelve en el momento del clic;
 * `onCsv` sustituye el CSV del nodo por uno propio (p. ej. el del servidor);
 * `meta` (texto o función) va bajo el título del PDF: los filtros aplicados;
 * `beforePrint` se llama antes de clonar el nodo (abrir acordeones…) y puede
 * devolver una función que lo deshace.
 * `report` (función que devuelve la especificación de ReportDoc.jsx) sustituye
 * los tres formatos por el reporte formal: PDF apaisado con cabecera en el
 * color de la tienda, Excel con hoja «Resumen» + una por tabla, CSV con el
 * bloque general arriba y la lista debajo. Si devuelve null, se usa lo de antes.
 */
export function ExportMenu({ targetRef, title, csv, xlsx, onCsv: customCsv, meta, beforePrint, report, name = "export", compact = true }) {
  const { t } = useLang();
  const viaReport = (kind) => {
    if (typeof report !== "function") return false;
    const spec = report(kind);
    if (!spec) return false;
    exportReport(kind, spec);
    return true;
  };
  const onCsv = (e) => {
    e.stopPropagation();
    if (viaReport("csv")) return undefined;
    if (customCsv) return customCsv();
    const text = csv ? rowsToCsv(csv.cols, csv.rows) : elementToCsv(targetRef?.current);
    return downloadText(`${name}-${new Date().toISOString().slice(0, 10)}.csv`, text);
  };
  const onXlsx = (e) => {
    e.stopPropagation();
    if (viaReport("xlsx")) return;
    const spec = typeof xlsx === "function" ? xlsx() : xlsx;
    if (!spec?.sheets?.length) return;
    downloadXlsx(spec.filename || `${name}-${new Date().toISOString().slice(0, 10)}.xlsx`, spec.sheets);
  };
  const onPdf = (e) => {
    e.stopPropagation();
    if (viaReport("pdf")) return;
    const restore = beforePrint?.();
    printElement(targetRef?.current, title, typeof meta === "function" ? meta() : meta);
    if (typeof restore === "function") restore();
  };
  const cls = compact ? "adm-mini" : "btn-xs";
  const withXlsx = Boolean(xlsx || report);
  const pdf = <button key="pdf" type="button" className={cls} title={t("adm.ui.pdf")} onClick={onPdf}><Icon name="printer" size={14} />{!compact && "PDF"}</button>;
  const csvBtn = <button key="csv" type="button" className={cls} title={t("adm.ui.csv")} onClick={onCsv}><Icon name="excel" size={14} />{!compact && "CSV"}</button>;
  const xlsxBtn = withXlsx ? <button key="xlsx" type="button" className={cls} title={t("adm.ui.xlsx")} onClick={onXlsx}><Icon name="sheet" size={14} />{!compact && "Excel"}</button> : null;
  return (
    <span className="adm-export-menu adm-noprint">
      {withXlsx ? [pdf, xlsxBtn, csvBtn] : [csvBtn, pdf]}
    </span>
  );
}

/**
 * Tarjeta accionable. `onGo` hace clicable toda la cabecera (y muestra la
 * flecha "ir a"); `hint` añade el globo de ayuda; `csv` fija columnas para el
 * CSV; `exportable` (por defecto) muestra CSV/PDF.
 */
export function Card({ icon, title, hint, onGo, goLabel, csv, name, exportable = true, className = "", children, right, style }) {
  const { t } = useLang();
  const ref = useRef(null);
  return (
    <div className={`adm-card ${onGo ? "has-go" : ""} ${className}`} ref={ref} style={style}>
      {(title || exportable) && (
        <div className="adm-card-head">
          <h3 className={onGo ? "go" : ""} onClick={onGo} role={onGo ? "button" : undefined} tabIndex={onGo ? 0 : undefined} title={onGo ? (goLabel || t("adm.ui.open")) : undefined}
            onKeyDown={onGo ? (e) => { if (e.key === "Enter") onGo(e); } : undefined}>
            {icon && <Icon name={icon} size={16} />}{title}
            {onGo && <Icon name="arrowUpRight" size={14} className="adm-go-ico" />}
          </h3>
          <span className="adm-card-tools">
            {right}
            <InfoTip text={hint} title={title} />
            {exportable && <ExportMenu targetRef={ref} title={title} csv={csv} name={name || "panel"} />}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}

/** Barra de pestañas secundarias (Ejecutivo, Costos…). `items` = [{key, icon, label}]. */
export function SubTabs({ items, value, onChange, right }) {
  return (
    <div className="adm-subtabs adm-noprint">
      {items.map((it) => (
        <button key={it.key} type="button" className={value === it.key ? "on" : ""} onClick={() => onChange(it.key)}>
          {it.icon && <Icon name={it.icon} size={15} />}{it.label}
        </button>
      ))}
      {right && <span className="adm-subtabs-right">{right}</span>}
    </div>
  );
}

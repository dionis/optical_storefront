// Dónde se usa: todo el panel — piezas comunes para que CADA tarjeta sea
// accionable: cabecera con título, ayuda ("¿qué es esto?"), botón de ir a la
// pantalla relacionada y exportar (CSV / PDF). `Card` envuelve el contenido y
// lleva su propio nodo para imprimirlo o volcarlo a CSV sin cablear nada.
import { useEffect, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { downloadText, elementToCsv, printElement, rowsToCsv } from "./exportUtils.js";

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

/** Globo de ayuda: se abre al clic, se cierra con Escape o clic fuera. */
export function InfoTip({ text, title }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc); window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("keydown", onKey); };
  }, [open]);
  if (!text) return null;
  return (
    <span className="adm-tip" ref={ref}>
      <button type="button" className="adm-tip-btn" aria-label={t("adm.ui.help")} aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        <Icon name="info" size={14} />
      </button>
      {open && (
        <span className="adm-tip-pop" role="dialog" onClick={(e) => e.stopPropagation()}>
          {title && <b>{title}</b>}
          <span>{text}</span>
        </span>
      )}
    </span>
  );
}

/**
 * Menú de exportación de un nodo: CSV (de sus tablas/KPI, o de `csv` si se
 * pasan columnas+filas explícitas) y PDF (impresión aislada del nodo).
 */
export function ExportMenu({ targetRef, title, csv, name = "export", compact = true }) {
  const { t } = useLang();
  const onCsv = (e) => {
    e.stopPropagation();
    const text = csv ? rowsToCsv(csv.cols, csv.rows) : elementToCsv(targetRef?.current);
    downloadText(`${name}-${new Date().toISOString().slice(0, 10)}.csv`, text);
  };
  const onPdf = (e) => { e.stopPropagation(); printElement(targetRef?.current, title); };
  return (
    <span className="adm-export-menu adm-noprint">
      <button type="button" className={compact ? "adm-mini" : "btn-xs"} title={t("adm.ui.csv")} onClick={onCsv}><Icon name="excel" size={14} />{!compact && "CSV"}</button>
      <button type="button" className={compact ? "adm-mini" : "btn-xs"} title={t("adm.ui.pdf")} onClick={onPdf}><Icon name="printer" size={14} />{!compact && "PDF"}</button>
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

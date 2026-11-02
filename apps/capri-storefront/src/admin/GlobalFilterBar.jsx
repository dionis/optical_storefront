// Dónde se usa: AdminShell.jsx, justo debajo de la barra superior. La barra de
// filtros GLOBAL del panel: [tienda] [período segmentado] [rango] … [PDF · Excel
// · CSV]. Está pegada (sticky) bajo la cabecera y en el mismo sitio en todas
// las pestañas, haga scroll quien haga scroll — regla del dueño: «los filtros
// no se mueven; el operador siempre sabe dónde están».
//
// La tienda es la global de siempre (StoreFilter.jsx → adm_active_store) y el
// período es el nuevo global (periodStore.js → adm_period). Exportar manda a la
// pantalla que esté abierta: cada pantalla registra sus manejadores con
//
//   useRegisterExport({ pdf, xlsx, csv, label });   // funciones; las que falten
//                                                    // dejan su botón apagado
//
// y la barra los llama. Sin pantalla registrada, los tres botones quedan
// apagados con su explicación en el título. `menuHandlers(props)` convierte las
// props de un <ExportMenu> (targetRef/report/xlsx/csv/meta/beforePrint) en esos
// tres manejadores, para que adoptar la barra sea una línea.
//
// Qué pestañas la enseñan y con qué piezas: BAR_TABS. Una pestaña que no está
// en el mapa no tiene barra (el formulario de una tienda, el catálogo…).
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import StoreFilter from "./StoreFilter.jsx";
import { PERIODS, usePeriodFilter } from "./periodStore.js";
import { downloadText, elementToCsv, printElement, rowsToCsv } from "./exportUtils.js";
import { downloadXlsx } from "./exportXlsx.js";
import { exportReport } from "./ReportDoc.jsx";
import "./filter-bar.css";

/**
 * Pestaña → piezas de la barra. `store`: selector de tienda; `period`: período
 * y rango; `export`: PDF · Excel · CSV. Pestañas ausentes → sin barra.
 */
export const BAR_TABS = {
  // Precios y costos: la tienda decide qué variación se edita; no hay período.
  pricing: { store: true, period: false, export: true },
  exec: { store: true, period: true, export: true },
  storeorders: { store: true, period: true, export: true },
  possales: { store: true, period: true, export: true },
  pendingbalances: { store: true, period: true, export: true },
  cash: { store: true, period: true, export: true },
  salesboard: { store: true, period: true, export: true },
  statement: { store: true, period: true, export: true },
  storestatus: { store: true, period: false, export: true },
  audit: { store: true, period: true, export: false },
  sellers: { store: true, period: true, export: true },
  storecosts: { store: true, period: true, export: true },
  mysales: { store: true, period: true, export: true },
  approvals: { store: true, period: false, export: false },
  orders: { store: false, period: true, export: true },
  costs: { store: true, period: false, export: false },
};
export const barOptionsFor = (tab) => BAR_TABS[tab] || null;

// ── Registro de exportación ────────────────────────────────────────────────
// Dos contextos a propósito: las acciones (estables) para quien registra y el
// estado (cambia) para la barra. Si el hook dependiera del estado, registrar
// cambiaría el estado, que volvería a disparar el registro: bucle.
const ExportActions = createContext(null);
const ExportState = createContext(null);

/** Lo pone AdminShell alrededor del contenido; la barra lee `entry`. */
export function ExportRegistry({ children }) {
  const [entry, setEntry] = useState(null); // { ref, has: { pdf, xlsx, csv }, label }
  const actions = useMemo(() => ({
    register: (ref, has, label) => setEntry({ ref, has, label }),
    unregister: (ref) => setEntry((e) => (e && e.ref === ref ? null : e)),
  }), []);
  return <ExportActions.Provider value={actions}><ExportState.Provider value={entry}>{children}</ExportState.Provider></ExportActions.Provider>;
}

/**
 * La pantalla abierta registra qué sabe exportar. Los manejadores se leen en el
 * momento del clic (ref), así pueden cerrar sobre el estado actual sin volver a
 * registrarse; solo cambia el registro cuando aparece o desaparece un formato.
 */
export function useRegisterExport(handlers) {
  const ctx = useContext(ExportActions);
  const ref = useRef(handlers);
  ref.current = handlers;
  // `null` (todavía sin datos) = nada registrado: los tres botones apagados con «nada que exportar».
  const active = Boolean(handlers);
  const hasPdf = typeof handlers?.pdf === "function";
  const hasXlsx = typeof handlers?.xlsx === "function";
  const hasCsv = typeof handlers?.csv === "function";
  const label = handlers?.label || "";
  useEffect(() => {
    if (!ctx || !active) return undefined;
    ctx.register(ref, { pdf: hasPdf, xlsx: hasXlsx, csv: hasCsv }, label);
    return () => ctx.unregister(ref);
  }, [ctx, active, hasPdf, hasXlsx, hasCsv, label]);
}

/**
 * Las props de <ExportMenu> (ui.jsx) como manejadores de la barra: `report`
 * manda sobre todo (reporte formal); si no, `xlsx` (objeto o función), `csv`
 * (cols+rows) u `onCsv`, y PDF = impresión aislada de `targetRef` con `meta`
 * y `beforePrint`. Sin `xlsx` ni `report`, Excel queda apagado.
 */
export function menuHandlers({ targetRef, title, csv, xlsx, onCsv, meta, beforePrint, report, name = "export" } = {}) {
  const stamp = () => new Date().toISOString().slice(0, 10);
  const viaReport = (kind) => {
    if (typeof report !== "function") return false;
    const spec = report(kind);
    if (!spec) return false;
    exportReport(kind, spec);
    return true;
  };
  const pdf = () => {
    if (viaReport("pdf")) return;
    const restore = beforePrint?.();
    printElement(targetRef?.current, title, typeof meta === "function" ? meta() : meta);
    if (typeof restore === "function") restore();
  };
  const toXlsx = () => {
    if (viaReport("xlsx")) return;
    const spec = typeof xlsx === "function" ? xlsx() : xlsx;
    if (!spec?.sheets?.length) return;
    downloadXlsx(spec.filename || `${name}-${stamp()}.xlsx`, spec.sheets);
  };
  const toCsv = () => {
    if (viaReport("csv")) return undefined;
    if (onCsv) return onCsv();
    const text = csv ? rowsToCsv(csv.cols, csv.rows) : elementToCsv(targetRef?.current);
    return downloadText(`${name}-${stamp()}.csv`, text);
  };
  return { pdf, xlsx: xlsx || report ? toXlsx : undefined, csv: toCsv, label: title };
}

// ── Piezas ─────────────────────────────────────────────────────────────────
function PeriodControl() {
  const { t, lang } = useLang();
  const { period, from, to, setPeriod, setRange } = usePeriodFilter();
  const custom = period === "range";
  // Si el segmentado no cabe entero (escritorio estrecho), se desplaza por
  // dentro: el activo se trae a la vista y la clase `scrolls` pone el degradado.
  const segRef = useRef(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = segRef.current;
    if (!el) return undefined;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    check();
    el.querySelector("button.on")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(check) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [period, custom]);
  // Con un período de la lista, el rango se lee en corto («1 nov – 15 nov»);
  // pulsarlo pasa a «Rango» y abre las dos fechas.
  const short = (s) => {
    const d = new Date(`${s}T00:00:00`);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(lang === "en" ? "en-US" : "es-ES", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).replace(/\.$/, "");
  };
  return (
    <>
      <div className={`adm-bar-seg ${scrolls ? "scrolls" : ""}`} ref={segRef} role="group" aria-label={t("adm.bar.period")}>
        {PERIODS.map((p) => (
          <button key={p} type="button" className={period === p ? "on" : ""} aria-pressed={period === p} onClick={() => setPeriod(p)} title={t(`adm.ex.period.${p}`)}>
            {t(`adm.ex.per.${p}`)}
          </button>
        ))}
      </div>
      {custom ? (
        <span className="adm-bar-range on" title={t("adm.bar.range")}>
          <Icon name="calendar" size={13} />
          <input type="date" value={from} max={to} aria-label={t("adm.ex.from")} title={t("adm.ex.from")} onChange={(e) => e.target.value && setRange(e.target.value, undefined)} />
          <span className="adm-bar-range-sep" aria-hidden="true">–</span>
          <input type="date" value={to} min={from} aria-label={t("adm.ex.to")} title={t("adm.ex.to")} onChange={(e) => e.target.value && setRange(undefined, e.target.value)} />
        </span>
      ) : (
        <button type="button" className="adm-bar-range adm-bar-range-btn" onClick={() => setPeriod("range")} title={`${t("adm.ex.from")} ${from} – ${t("adm.ex.to")} ${to} · ${t("adm.bar.rangeHint")}`}>
          <Icon name="calendar" size={13} />
          <span>{from === to ? short(from) : `${short(from)} – ${short(to)}`}</span>
        </button>
      )}
    </>
  );
}

function ExportGroup() {
  const { t } = useLang();
  const entry = useContext(ExportState);
  const none = !entry;
  const run = (kind) => () => { const fn = entry?.ref?.current?.[kind]; if (typeof fn === "function") fn(); };
  const titleOf = (kind, label) => (none ? t("adm.bar.export.none") : !entry.has[kind] ? t("adm.bar.export.noFormat", { format: label }) : entry.label ? `${label} · ${entry.label}` : label);
  const btn = (kind, icon, text, label) => (
    <button key={kind} type="button" className="btn-xs" disabled={none || !entry.has[kind]} title={titleOf(kind, label)} aria-label={label} onClick={run(kind)}>
      <Icon name={icon} size={14} />{text}
    </button>
  );
  return (
    <span className="adm-bar-export" role="group" aria-label={t("adm.bar.export")}>
      <span className={`adm-export-menu ${none ? "idle" : ""}`}>
        {btn("pdf", "printer", "PDF", t("adm.ui.pdf"))}
        {btn("xlsx", "sheet", "Excel", t("adm.ui.xlsx"))}
        {btn("csv", "excel", "CSV", t("adm.ui.csv"))}
      </span>
    </span>
  );
}

/**
 * La barra. `tab` decide las piezas (BAR_TABS); `me` va al selector de tienda.
 * Con una pestaña sin barra no pinta nada (y el armazón pone --adm-bar-h: 0).
 */
export default function GlobalFilterBar({ tab, me, barRef }) {
  const { t } = useLang();
  const opts = barOptionsFor(tab);
  if (!opts) return null;
  return (
    <div className="adm-bar adm-noprint" ref={barRef} role="region" aria-label={t("adm.bar.aria")} data-tab={tab}>
      <div className="adm-bar-filters">
        {opts.store && <span className="adm-bar-item adm-bar-store"><StoreFilter me={me} compact /></span>}
        {opts.period && <span className="adm-bar-item adm-bar-period"><PeriodControl /></span>}
      </div>
      {opts.export && <ExportGroup />}
    </div>
  );
}

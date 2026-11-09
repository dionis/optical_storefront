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
// apagados con su explicación en el título.
//
// Exportar pregunta PARA QUIÉN: el reporte del dueño (completo) o el estado por
// tienda que se socializa (sin costo real, ganancia, margen, comisiones ni
// saldos). Lo recorta ReportDoc (specForAudience) y la elección llega hasta
// allí con `withReportAudience`; ver ExportGroup más abajo. `menuHandlers(props)` convierte las
// props de un <ExportMenu> (targetRef/report/xlsx/csv/meta/beforePrint) en esos
// tres manejadores, para que adoptar la barra sea una línea.
//
// Qué piezas enseña cada pestaña: BAR_TABS. La barra sale en TODAS las
// pestañas (regla del dueño: «los filtros deberían estar para todo y así
// siempre poder filtrar en cualquier momento»), y lo que cambia de una a otra
// es QUÉ piezas se activan — nunca si la barra está o no.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import OmniSearch from "./OmniSearch.jsx";
import StoreFilter, { useStoreFilter } from "./StoreFilter.jsx";
import { PERIODS, usePeriodFilter, usePeriodNotice } from "./periodStore.js";
import { downloadText, elementToCsv, printElement, rowsToCsv } from "./exportUtils.js";
import { downloadXlsx } from "./exportXlsx.js";
import { exportReport, withReportAudience } from "./ReportDoc.jsx";
import "./filter-bar.css";
// El aviso de salto automático comparte hoja con EmptyPeriod.jsx: es el mismo
// asunto (un período sin datos) visto desde la barra.
import "./empty-period.css";

/**
 * Pestaña → piezas de la barra. `store`: selector de tienda; `period`: período
 * y rango; `export`: PDF · Excel · CSV. El buscador global (OmniSearch) NO
 * está en el mapa porque va en TODAS sin excepción: es la pieza que enseña al
 * operador dónde se filtra, y buscar un pedido o un paciente tiene sentido
 * desde cualquier pantalla.
 *
 * ── CRITERIO (para no tener que adivinarlo mañana) ─────────────────────────
 * Una pieza se activa solo donde FILTRA ALGO de verdad. Un control que no
 * cambia nada es peor que no tenerlo: el operador lo mueve, no pasa nada y deja
 * de creerse la barra.
 *   · `store`  → la pantalla lee la tienda activa (useStoreFilter) o su
 *                contenido es de una tienda.  No: catálogo maestro, equipo,
 *                seguridad, perfil, reglas de alerta, configuración del POS.
 *   · `period` → la pantalla lee el período global (usePeriodFilter), es decir
 *                enseña hechos ENTRE DOS FECHAS. No: formularios y
 *                configuración (una tienda, un precio, una regla, un perfil) ni
 *                los «estado AHORA» (Estado de tienda, Aprobaciones).
 *   · `export` → la pantalla registra manejadores con useRegisterExport. Si no
 *                los registra, los tres botones saldrían apagados: fuera.
 *
 * ── PESTAÑA POR PESTAÑA ────────────────────────────────────────────────────
 * Con las tres piezas (dinero por tienda y período, y un informe que sacar):
 *   exec, salesboard, storeorders, possales, pendingbalances, cash, statement,
 *   sellers, storecosts, mysales.
 * Casos con matiz:
 *   pricing      un precio no es un informe → sin período; la tienda SÍ (decide
 *                qué variación se edita sobre el maestro).
 *   costs        reglas de costo: ni período ni exportación propia.
 *   storestatus  foto de AHORA (caja abierta, saldos, pendientes) → sin período.
 *   approvals    cola de aprobaciones vivas → sin período y sin exportación.
 *   audit        sí filtra por tienda y fechas, pero no registra exportación.
 *   orders       pedidos de la WEB: no hay tienda que elegir, y la pantalla lleva
 *                sus propias fechas (Hoy · 7 · 30 · 90 días · Todo, desde/hasta, y el
 *                enlace a un pedido abre «Todo»): el período de la barra no la
 *                filtraba, así que fuera (revisión 9-nov-2026). Exporta por su cuenta.
 * Solo el buscador (la pantalla no depende de tienda ni de fechas, y exporta
 * por su cuenta o no exporta):
 *   catalog           clave de grupo (ver abajo). «Productos y precios»
 *                     (`products`) SÍ lleva tienda y exportación (ver BAR_TABS).
 *   stores            el directorio y el formulario de una tienda.
 *   team, security, posconfig, alerts, profile, pos.
 *   `pos` aparte: la venta se hace en el terminal asignado (contexto del POS),
 *   no en la tienda del filtro global — activar `store` ahí daría a entender
 *   que se puede cobrar en otra tienda cambiando una píldora.
 * Claves de GRUPO del menú (overview, work, commercial, catalog, admin): no son
 * pestañas reales (AdminShell las usa como acordeón, y `overview` es además una
 * pestaña antigua que LEGACY_TABS manda a `exec`). Van listadas para que ni un
 * enlace viejo ni un `?tab=` a mano se queden sin barra.
 */
const NONE = { store: false, period: false, export: false };
const ALL = { store: true, period: true, export: true };
export const BAR_TABS = {
  // ── Dinero por tienda y período, con informe ──
  exec: ALL,
  salesboard: ALL,
  storeorders: ALL,
  possales: ALL,
  pendingbalances: ALL,
  cash: ALL,
  statement: ALL,
  sellers: ALL,
  storecosts: ALL,
  mysales: ALL,
  // ── Con matiz ──
  pricing: { store: true, period: false, export: true },
  costs: { store: true, period: false, export: false },
  storestatus: { store: true, period: false, export: true },
  approvals: { store: true, period: false, export: false },
  audit: { store: true, period: true, export: false },
  orders: NONE,
  // «Productos y precios» (Productos + Precios y costos, 6-nov-2026): la tienda
  // deja solo sus columnas en la matriz y elige maestro/variación en «Reglas y
  // comisiones». Exporta: la matriz registra su libro de Excel y las reglas el
  // informe de precios de siempre (PDF/Excel/CSV).
  products: { store: true, period: false, export: true },
  // ── Solo el buscador ──
  stores: NONE,
  team: NONE,
  security: NONE,
  posconfig: NONE,
  alerts: NONE,
  profile: NONE,
  pos: NONE,
  // ── Claves de grupo del menú / pestañas antiguas ──
  overview: NONE,
  work: NONE,
  commercial: NONE,
  catalog: NONE,
  admin: NONE,
};
/**
 * Las piezas de una pestaña. Una pestaña que NO esté en el mapa (una nueva que
 * nadie añadió aquí) cae en `NONE`: barra con buscador, sin filtros que no
 * filtren. Nunca devuelve `null` — la barra ya no se esconde.
 */
export const barOptionsFor = (tab) => BAR_TABS[tab] || NONE;

// ── Registro de exportación ────────────────────────────────────────────────
// Dos contextos a propósito: las acciones (estables) para quien registra y el
// estado (cambia) para la barra. Si el hook dependiera del estado, registrar
// cambiaría el estado, que volvería a disparar el registro: bucle.
const ExportActions = createContext(null);
const ExportState = createContext(null);

/** Lo pone AdminShell alrededor del contenido; la barra lee `entry`. */
export function ExportRegistry({ children }) {
  const [entry, setEntry] = useState(null); // { ref, has: { pdf, xlsx, csv }, label, audiences }
  const actions = useMemo(() => ({
    register: (ref, has, label, audiences) => setEntry({ ref, has, label, audiences }),
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
  // `audiences`: la pantalla exporta un REPORTE formal (una especificación de
  // ReportDoc), así que el mismo botón puede dar la versión del dueño y la de
  // compartir. Sin esa marca la barra no ofrece elegir: una pantalla que
  // imprime su propio nodo o arma sus propias hojas ignoraría la audiencia y
  // sacaría los costos igual — ofrecer una opción que no se cumple es peor
  // que no ofrecerla. `menuHandlers` la pone cuando recibe `report`.
  const audiences = handlers?.audiences === true;
  useEffect(() => {
    if (!ctx || !active) return undefined;
    ctx.register(ref, { pdf: hasPdf, xlsx: hasXlsx, csv: hasCsv }, label, audiences);
    return () => ctx.unregister(ref);
  }, [ctx, active, hasPdf, hasXlsx, hasCsv, label, audiences]);
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
  // Con `report` el documento sale de ReportDoc: se puede imprimir para el
  // dueño o para compartir (ver `audiences` en useRegisterExport).
  return { pdf, xlsx: xlsx || report ? toXlsx : undefined, csv: toCsv, label: title, audiences: typeof report === "function" };
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
          // `{ explicit: true }`: aquí el período lo elige una PERSONA, así que
          // queda marcado y el panel no se lo vuelve a cambiar por debajo
          // (periodStore.js → hasExplicitPeriod / autoSwitchPeriod).
          <button key={p} type="button" className={period === p ? "on" : ""} aria-pressed={period === p} onClick={() => setPeriod(p, { explicit: true })} title={t(`adm.ex.period.${p}`)}>
            {t(`adm.ex.per.${p}`)}
          </button>
        ))}
      </div>
      {/* Teléfono: los ocho períodos no caben como píldoras sin ocupar dos filas
          pegajosas; ahí el mismo control es un desplegable (responsive.css). */}
      <label className="adm-bar-period-sel">
        <select value={period} onChange={(e) => setPeriod(e.target.value, { explicit: true })} aria-label={t("adm.bar.period")} title={t("adm.bar.period")}>
          {PERIODS.map((p) => <option key={p} value={p}>{t(`adm.ex.per.${p}`)}</option>)}
        </select>
        <Icon name="chevronDown" size={14} />
      </label>
      {custom ? (
        <span className="adm-bar-range on" title={t("adm.bar.range")}>
          <Icon name="calendar" size={13} />
          <input type="date" value={from} max={to} aria-label={t("adm.ex.from")} title={t("adm.ex.from")} onChange={(e) => e.target.value && setRange(e.target.value, undefined, { explicit: true })} />
          <span className="adm-bar-range-sep" aria-hidden="true">–</span>
          <input type="date" value={to} min={from} aria-label={t("adm.ex.to")} title={t("adm.ex.to")} onChange={(e) => e.target.value && setRange(undefined, e.target.value, { explicit: true })} />
        </span>
      ) : (
        <button type="button" className="adm-bar-range adm-bar-range-btn" onClick={() => setPeriod("range", { explicit: true })} title={`${t("adm.ex.from")} ${from} – ${t("adm.ex.to")} ${to} · ${t("adm.bar.rangeHint")}`}>
          <Icon name="calendar" size={13} />
          <span>{from === to ? short(from) : `${short(from)} – ${short(to)}`}</span>
        </button>
      )}
    </>
  );
}

/**
 * «Este mes aún no tiene ventas: mostrando mes pasado». Cuando el panel cambia
 * el período él solo (periodStore.js → autoSwitchPeriod, el día 1 del mes) hay
 * que DECIRLO en el mismo sitio donde se ve el período: datos que cambian sin
 * explicación es lo que hizo creer al dueño que el panel estaba roto. Sin salto
 * automático no pinta nada, así que la barra queda igual que siempre.
 */
function AutoNotice() {
  const { t } = useLang();
  const { notice, dismiss } = usePeriodNotice();
  if (!notice) return null;
  const text = t("adm.period.auto.notice", { from: t(`adm.ex.period.${notice.fromPeriod}`), to: t(`adm.ex.period.${notice.toPeriod}`) });
  return (
    <div className="ep-notice" role="status" aria-label={t("adm.period.auto.aria")}>
      <Icon name="info" size={14} />
      <span className="ep-notice-txt">{text}</span>
      <button type="button" className="btn-xs ep-notice-ok" onClick={dismiss} title={t("adm.period.auto.dismiss")} aria-label={t("adm.period.auto.dismiss")}>
        {t("adm.period.auto.dismiss")}
      </button>
    </div>
  );
}

/**
 * Los tres formatos de la barra. `label` es el nombre largo (título y
 * `aria-label`); `text` lo que se lee en el botón, que es una sigla y no se
 * traduce.
 */
const FORMATS = [
  { kind: "pdf", icon: "printer", text: "PDF", label: "adm.ui.pdf" },
  { kind: "xlsx", icon: "sheet", text: "Excel", label: "adm.ui.xlsx" },
  { kind: "csv", icon: "excel", text: "CSV", label: "adm.ui.csv" },
];

/**
 * Exportar: los tres formatos y, al pulsar uno, PARA QUIÉN es.
 *
 * El dueño pidió dos versiones del mismo reporte: la suya, completa, y el
 * estado de la tienda que se socializa (a un encargado, a un socio, al
 * contable) sin costo real, ganancia, margen, comisiones ni saldos. Quién
 * recorta qué es ReportDoc (specForAudience); aquí solo se ELIGE, y la
 * elección viaja hasta `exportReport` con `withReportAudience`.
 *
 * Se pregunta en los TRES formatos, no solo en el PDF: el Excel y el CSV
 * salen de la misma especificación y llevan los mismos costos en su hoja
 * «Resumen» y en sus columnas; de hecho una hoja de cálculo es lo más fácil
 * de reenviar. Preguntar solo al imprimir dejaría abierta la puerta ancha.
 *
 * Si la pantalla no exporta un reporte formal (`audiences`), el botón hace lo
 * de siempre con una sola pulsación: ver useRegisterExport.
 */
function ExportGroup({ me, storeScoped }) {
  const { t } = useLang();
  const entry = useContext(ExportState);
  const { store, isAll, isWeb } = useStoreFilter(me);
  // `pick` = el formato pulsado que está esperando audiencia (y el botón al
  // que hay que devolver el foco si se cierra sin elegir).
  const [pick, setPick] = useState(null);
  const rootRef = useRef(null);
  const popRef = useRef(null);
  const none = !entry;
  const audiences = entry?.audiences === true;

  const close = (focusBack = true) => {
    const btn = pick?.btn;
    setPick(null);
    if (focusBack) btn?.focus?.();
  };
  // Escape, clic fuera y, si la pantalla deja de exportar, cerrar.
  useEffect(() => {
    if (!pick) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) close(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    popRef.current?.querySelector(".adm-aud-opt")?.focus();
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [pick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (none || !audiences) setPick(null); }, [none, audiences]);

  /** Llama al manejador de la pantalla con la audiencia elegida. */
  const call = (kind, audience) => {
    setPick(null);
    const fn = entry?.ref?.current?.[kind];
    if (typeof fn === "function") withReportAudience(audience, fn);
  };
  // El título del botón: `label` es el nombre largo («Exportar a PDF /
  // imprimir») y `f.text` la sigla, que es la que cabe en una pregunta.
  const titleOf = (f, label) => (none ? t("adm.bar.export.none") : !entry.has[f.kind] ? t("adm.bar.export.noFormat", { format: label }) : audiences ? t("adm.rpt.aud.pick", { format: f.text }) : entry.label ? `${label} · ${entry.label}` : label);
  const press = (f) => (e) => {
    if (!audiences) return call(f.kind, "owner");
    const btn = e.currentTarget;
    return setPick((p) => (p?.kind === f.kind ? null : { kind: f.kind, text: f.text, btn }));
  };
  const btn = (f) => {
    const label = t(f.label);
    return (
      <button key={f.kind} type="button" className={`btn-xs ${pick?.kind === f.kind ? "on" : ""}`} disabled={none || !entry.has[f.kind]}
        title={titleOf(f, label)} aria-label={label} aria-haspopup={audiences ? "menu" : undefined} aria-expanded={audiences ? pick?.kind === f.kind : undefined}
        onClick={press(f)}>
        <Icon name={f.icon} size={14} /><span className="adm-bar-export-txt">{f.text}</span>
      </button>
    );
  };
  // Qué significa «estado por tienda» en la pantalla que está abierta. Si no
  // hay una tienda concreta detrás, se DICE en la propia interfaz en vez de
  // sacar un documento ambiguo: con «Todas las tiendas» sale un bloque por
  // tienda, y en una pantalla que no es de una tienda sale lo mismo que se ve.
  const note = !storeScoped ? t("adm.rpt.aud.note.noStore") : isAll ? t("adm.rpt.aud.note.all") : isWeb ? t("adm.rpt.aud.note.web") : "";
  // Nombre y código de la tienda: nombres propios, no texto de interfaz.
  const storeName = storeScoped && !isAll && !isWeb && store ? [store.code, store.name].filter(Boolean).join(" · ") : "";
  // Las flechas recorren las dos opciones, como en cualquier menú del panel.
  const onPopKey = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(popRef.current?.querySelectorAll(".adm-aud-opt") || [])];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return (
    <span className="adm-bar-export" role="group" aria-label={t("adm.bar.export")} ref={rootRef}>
      <span className={`adm-export-menu ${none ? "idle" : ""}`}>
        {FORMATS.map(btn)}
      </span>
      {pick && (
        <div className="adm-aud-pop" role="menu" aria-label={t("adm.rpt.aud.title", { format: pick.text })} ref={popRef} onKeyDown={onPopKey}>
          <div className="adm-aud-head">
            <span>{t("adm.rpt.aud.title", { format: pick.text })}</span>
            <button type="button" className="adm-aud-x" onClick={() => close()} title={t("adm.rpt.aud.close")} aria-label={t("adm.rpt.aud.close")}>
              <Icon name="close" size={12} />
            </button>
          </div>
          <button type="button" className="adm-aud-opt" role="menuitem" onClick={() => call(pick.kind, "owner")} title={t("adm.rpt.aud.ownerHint")}>
            <Icon name="lock" size={15} />
            <span><b>{t("adm.rpt.aud.owner")}</b><small>{t("adm.rpt.aud.ownerHint")}</small></span>
          </button>
          <button type="button" className="adm-aud-opt share" role="menuitem" onClick={() => call(pick.kind, "share")} title={t("adm.rpt.aud.shareHint")}>
            <Icon name="share" size={15} />
            <span>
              <b>{t("adm.rpt.aud.share")}</b>
              <small>{t("adm.rpt.aud.shareHint")}</small>
              {storeName && <em>{storeName}</em>}
            </span>
          </button>
          {note && <p className="adm-aud-note"><Icon name="info" size={12} />{note}</p>}
        </div>
      )}
    </span>
  );
}

/**
 * La barra. Sale en TODAS las pestañas; `tab` decide qué piezas se activan
 * (BAR_TABS) y `me` va al selector de tienda. `go(tab, params)` es el salto del
 * panel, que usa el buscador para llevar a cada resultado: es opcional porque
 * hoy AdminShell todavía no lo baja hasta aquí — sin él OmniSearch navega por
 * la URL (ver su cabecera).
 */
export default function GlobalFilterBar({ tab, me, barRef, go = null }) {
  const { t } = useLang();
  const { notice } = usePeriodNotice();
  const opts = barOptionsFor(tab);
  // El aviso solo tiene sentido donde se ve el período, y va DENTRO de la barra
  // para que el alto que mide AdminShell (--adm-bar-h) lo incluya y no tape el
  // principio de la pantalla. `data-notice` deja que la barra envuelva a dos
  // filas en escritorio (empty-period.css), que normalmente es de una sola.
  const showNotice = Boolean(opts.period && notice);
  return (
    <div className="adm-bar adm-noprint" ref={barRef} role="region" aria-label={t("adm.bar.aria")} data-tab={tab} data-notice={showNotice ? "1" : undefined}>
      <div className="adm-bar-filters">
        {/* Primero el buscador, y en todas las pestañas: es lo único que está
            SIEMPRE, así que es lo que ancla la barra y lo que el operador
            aprende a buscar con los ojos. */}
        <span className="adm-bar-item adm-bar-search"><OmniSearch me={me} go={go} /></span>
        {opts.store && <span className="adm-bar-item adm-bar-store"><StoreFilter me={me} compact /></span>}
        {opts.period && <span className="adm-bar-item adm-bar-period"><PeriodControl /></span>}
      </div>
      {opts.export && <ExportGroup me={me} storeScoped={opts.store} />}
      {showNotice && <AutoNotice />}
    </div>
  );
}

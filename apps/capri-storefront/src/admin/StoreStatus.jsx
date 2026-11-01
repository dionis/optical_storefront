// Dónde se usa: pestaña «Estado de tienda» de /admin — la visión general de UNA
// tienda ahora mismo, para el dueño, los superadmin (cualquier tienda) y el
// supervisor y el encargado (las suyas; arrancan aquí). Ventas de hoy contra
// ayer, semana y mes; quién vende; cada punto de venta con su caja; lo que
// espera a alguien; las últimas ventas y los avisos. Solo lectura: cada
// acción vive en su pestaña y aquí se llega con un clic. Backend:
// GET /admin/store-status (lib/store-status.ts). La tienda la fija el filtro
// global del panel (StoreFilter → ?store=); con «Todas» o la online, la primera
// de las suyas, y se dice cuál.
//
// UNA vista (fit.css): barra de filtros + exportar arriba, tira de KPI y los
// bloques como acordeones con resumen en la cabecera; las tablas se desplazan
// por dentro (.acc-scroll). Exporta TODO como reporte formal (ReportDoc.jsx):
// PDF apaisado con cabecera en el color de la tienda, KPI, resúmenes y las
// tablas; Excel con hoja «Resumen» + una por bloque; CSV con el resumen arriba
// y las ventas recientes debajo.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { money, shortDate } from "./adminOrders.js";
import { adminFetch } from "./adminApi.js";
import StoreFilter, { useStoreFilter } from "./StoreFilter.jsx";
import Accordion, { AccordionGroup } from "./Accordion.jsx";
import { exportReport } from "./ReportDoc.jsx";
import { useSortable } from "./useSortable.js";
import SortTh from "./SortTh.jsx";
import "./screens.css";
import "./fit.css";

function pctDelta(cur, prev) {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 100);
}
const timeOf = (iso, lang) => new Date(iso).toLocaleTimeString(lang === "en" ? "en-US" : "es", { hour: "2-digit", minute: "2-digit" });
const ATT_TARGET = { approvals_pending: "approvals", voids_requested: "possales", ready_to_hand: "possales", register_open_long: "cash", till_without_register: "cash", no_active_till: "stores", counter_seller_inactive: "sellers" };
const SEV_ORDER = { bad: 0, warn: 1, info: 2 };
// Misma memoria que Accordion.jsx (adm.acc.<id>): el estado abierto se controla
// aquí para poder abrirlos todos al imprimir y devolverlos después.
const readOpen = (id, fallback) => { try { const v = localStorage.getItem(`adm.acc.${id}`); return v === null ? fallback : v === "1"; } catch { return fallback; } };

// Última respuesta por tienda (60 s): al volver a una tienda se pinta al
// instante y se refresca por detrás, en vez de dejar la pantalla en «cargando».
const CACHE = new Map();
const CACHE_MS = 60_000;

/** Props: `go`/`tabs` (navegación) y `me` (GET /admin/team/me) para el filtro de tienda. */
export default function StoreStatus({ go, tabs = [], me }) {
  const { t, lang } = useLang();
  const { storeId: globalId, isAll, isWeb, setStoreId, store: globalStore, stores: allStores } = useStoreFilter(me);
  const storeId = isAll || isWeb ? "" : globalId;
  const [data, setData] = useState(() => CACHE.get(storeId)?.data || null);
  const [state, setState] = useState("loading");
  const [openMap, setOpenMap] = useState({});
  const bodyRef = useRef(null);
  const can = (tab) => tabs.includes(tab);
  const link = (tab, params) => (go && can(tab) ? () => go(tab, params) : undefined);

  const load = (id = storeId, { force = false } = {}) => {
    const hit = CACHE.get(id);
    if (hit) setData(hit.data);
    if (hit && !force && Date.now() - hit.at < CACHE_MS) { setState("ok"); return; }
    setState("loading");
    adminFetch("/admin/store-status", { query: id ? { store: id } : {} })
      .then((r) => { CACHE.set(id, { data: r, at: Date.now() }); setData(r); setState("ok"); })
      .catch((e) => {
        // La tienda elegida ya no está en su alcance: el filtro vuelve a «Todas» y se carga la primera.
        if (id && (e?.reason === "store_not_found" || e?.reason === "forbidden_store")) { setStoreId(null); load(""); return; }
        setState("error");
      });
  };
  useEffect(() => { load(storeId); }, [storeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = (v) => money(v, "usd", lang);
  const s = data?.status;
  const storeLabel = s ? `${s.store.code} · ${s.store.name}` : "";

  // Datos derivados, calculados una vez por respuesta.
  const d = useMemo(() => {
    if (!s) return null;
    const attention = [...s.attention].sort((a, b) => (SEV_ORDER[a.tone] ?? 9) - (SEV_ORDER[b.tone] ?? 9));
    const sev = { bad: 0, warn: 0, info: 0 };
    for (const a of attention) sev[a.tone] = (sev[a.tone] || 0) + 1;
    const openRegisters = s.tills.filter((x) => x.register).length;
    const activeTills = s.tills.filter((x) => x.is_active).length;
    const cashExpected = s.tills.reduce((a, x) => a + (x.register?.expected || 0), 0);
    const p = s.pending;
    const pendingN = p.approvals + p.voids + p.ready.length + p.with_balance.count + p.insurance_claims;
    const sellersActive = s.sellers.filter((v) => v.active).length;
    const sellersToday = s.sellers.reduce((a, v) => a + (v.today_total || 0), 0);
    const sellersCount = s.sellers.reduce((a, v) => a + (v.today_count || 0), 0);
    const recentTotal = s.recent.filter((r) => r.status !== "voided").reduce((a, r) => a + (r.total || 0), 0);
    // El bloque más urgente se abre junto a los avisos: caja larga → cajas; aprobaciones/anulaciones/listos → pendientes; si no, cajas.
    const first = attention[0]?.kind;
    const urgent = first === "register_open_long" || first === "till_without_register" || first === "no_active_till" ? "tills" : first ? "pending" : "tills";
    return { attention, sev, openRegisters, activeTills, cashExpected, pendingN, sellersActive, sellersToday, sellersCount, recentTotal, urgent, dToday: pctDelta(s.today.total, s.yesterday.total) };
  }, [s]);

  // Cabeceras que ordenan (useSortable.js); los acordeones se pintan más abajo. Antes de los
  // `return` tempranos porque son hooks. La tabla de pendientes mezcla contadores y ventas listas: no se ordena.
  const tillsSorted = useSortable(s?.tills || [], { id: "ss-tills", getters: { sellers: (x) => x.sellers.length, status: (x) => (!x.is_active ? 0 : x.register ? 2 : 1), opened: (x) => x.register?.opened_at || null, opening: (x) => x.register?.opening ?? null, expected: (x) => x.register?.expected ?? null } });
  const sellersSorted = useSortable(s?.sellers || [], { id: "ss-sellers", defaultKey: "today_total", defaultDir: "desc", getters: { kind: (v) => (v.has_user ? 1 : 0) } });
  const recentSorted = useSortable(s?.recent || [], { id: "ss-recent", defaultKey: "created_at", defaultDir: "desc", getters: { status: (r) => (r.status === "voided" ? 2 : r.delivered ? 1 : 0) } });
  const sth = (sorted, col, label, align = "") => <SortTh col={col} sort={sorted.sort} onSort={sorted.toggle} align={align}>{label}</SortTh>;

  if (state === "loading" && !data) return <div className="adm-section"><div className="adm-src-note loading">{t("adm.ord.loading")}</div></div>;
  if (state === "error" && !data) {
    return <div className="adm-section"><div className="adm-demo-banner">{t("adm.ss.loadFailed")}</div><button className="btn-sm" onClick={() => load(storeId, { force: true })}>{t("adm.ss.retry")}</button></div>;
  }
  if (!s) return <div className="adm-section"><div className="adm-empty"><Icon name="store" size={36} /><b>{t("adm.pos.noStores")}</b></div></div>;

  const p = s.pending;
  const stamp = new Date().toISOString().slice(0, 10);
  const fileBase = `${t("adm.fit.ss.exportName")}-${s.store.code}-${stamp}`;
  const sevText = (tone) => t(`adm.fit.ss.sev.${tone}`);
  const attText = (a) => t(`adm.ss.att.${a.kind}`, { n: a.n, ref: a.ref || "" });
  const tillStatus = (x) => (!x.is_active ? t("adm.stores.tills.status.inactive") : x.register ? t("adm.fit.ss.open") : t("adm.my.cashClosed"));
  const sellerKind = (v) => (v.has_user ? t("adm.sel.counterUser") : t("adm.ss.referralOnly"));
  const saleStatus = (r) => (r.status === "voided" ? t("adm.my.voided") : r.delivered ? t("adm.my.delivered") : t("adm.fit.ss.status.completed"));

  // Columnas compartidas por tablas, Excel y CSV.
  // `sortKey` es la columna por la que ordena la cabecera en pantalla (recentSorted).
  const recentCols = [
    { header: t("adm.fit.ss.col.sale"), key: "number", width: 14, sortKey: "number" },
    { header: t("adm.fit.ss.col.when"), get: (r) => `${shortDate(r.created_at, lang)} ${timeOf(r.created_at, lang)}`, width: 16, sortKey: "created_at" },
    { header: t("adm.fit.ss.col.seller"), key: "seller_code", width: 10, sortKey: "seller_code" },
    { header: t("adm.fit.ss.col.terminal"), key: "terminal_code", width: 10, sortKey: "terminal_code" },
    { header: t("adm.fit.ss.col.status"), get: saleStatus, width: 12, sortKey: "status" },
    { header: t("adm.fit.ss.col.total"), key: "total", type: "money", width: 12, sortKey: "total" },
    { header: t("adm.fit.ss.col.balance"), key: "balance", type: "money", width: 12, sortKey: "balance" },
  ];
  // El reporte (ReportDoc): cabecera con la tienda y su color, KPI, los resúmenes
  // de cada acordeón como pastillas y una tabla por bloque. `recent` es la tabla
  // principal (va al CSV debajo del resumen).
  const report = () => {
    const theme = (allStores || []).find((x) => x.id === s.store.id) || globalStore || null;
    const store = { code: s.store.code, name: s.store.name, color: theme?.color || null, address: theme?.address || null, phone: theme?.phone || null };
    const now = new Date();
    const noSummary = [{ label: "", value: t("adm.fit.ss.pill.none"), tone: "good" }];
    return {
      title: t("adm.rpt.statusTitle", { store: s.store.name || s.store.code }),
      subtitle: t("adm.rpt.asOf", { when: now.toLocaleString(lang === "en" ? "en-US" : "es-US", { dateStyle: "medium", timeStyle: "short" }) }),
      store, period: null, generatedAt: now, lang, t,
      filename: fileBase,
      kpis: [
        { label: t("adm.my.today"), value: m(s.today.total), raw: s.today.total, sub: `${d.dToday !== null ? `${d.dToday > 0 ? "+" : ""}${d.dToday}% ${t("adm.fit.ss.vs")} · ` : ""}${s.today.count} ${t("adm.scr.count")}`, tone: d.dToday !== null ? (d.dToday >= 0 ? "good" : "bad") : "" },
        { label: t("adm.my.week"), value: m(s.week.total), raw: s.week.total, sub: `${s.week.count} ${t("adm.scr.count")} · ${t("adm.fit.ss.avg", { v: m(s.week.avg_ticket) })}` },
        { label: t("adm.my.month"), value: m(s.month.total), raw: s.month.total, sub: `${s.month.count} ${t("adm.scr.count")} · ${t("adm.fit.ss.avg", { v: m(s.month.avg_ticket) })}` },
        { label: t("adm.ss.pend.approvals"), value: String(p.approvals), raw: p.approvals },
        { label: t("adm.ss.pend.voids"), value: String(p.voids), raw: p.voids },
        { label: t("adm.ss.pend.ready"), value: String(p.ready.length), raw: p.ready.length },
        { label: t("adm.ss.pend.balance"), value: String(p.with_balance.count), raw: p.with_balance.count, sub: p.with_balance.count > 0 ? m(p.with_balance.amount) : undefined, neg: p.with_balance.count > 0 },
        { label: t("adm.ss.pend.insurance"), value: String(p.insurance_claims), raw: p.insurance_claims, sub: p.insurance_claims > 0 ? m(s.insurance_due) : undefined },
        { label: t("adm.fit.ss.pill.cash"), value: m(d.cashExpected), raw: d.cashExpected, sub: t("adm.ss.tillsNote", { open: d.openRegisters, active: d.activeTills }) },
      ],
      summaries: [
        { title: t("adm.fit.ss.alerts"), pills: d.attention.length ? [
          d.sev.bad ? { label: t("adm.fit.ss.pill.bad"), value: d.sev.bad, tone: "bad", strong: true } : null,
          d.sev.warn ? { label: t("adm.fit.ss.pill.warn"), value: d.sev.warn, tone: "warn" } : null,
          d.sev.info ? { label: t("adm.fit.ss.pill.info"), value: d.sev.info, tone: "muted" } : null,
        ] : noSummary },
        { title: t("adm.ss.tills"), pills: [{ label: t("adm.fit.ss.pill.open"), value: `${d.openRegisters}/${d.activeTills}`, tone: d.activeTills && !d.openRegisters ? "warn" : "" }, { label: t("adm.fit.ss.pill.cash"), value: m(d.cashExpected), strong: true }] },
        { title: t("adm.fit.ss.pending"), pills: [{ label: t("adm.fit.ss.pill.pending"), value: d.pendingN, tone: d.pendingN ? "warn" : "muted", strong: !!d.pendingN }, { label: t("adm.fit.ss.pill.ready"), value: p.ready.length }, { label: t("adm.fit.ss.pill.balance"), value: m(p.with_balance.amount) }] },
        { title: t("adm.ss.sellersToday"), pills: [{ label: t("adm.fit.ss.pill.sellers"), value: `${d.sellersActive}/${s.sellers.length}` }, { label: t("adm.fit.ss.pill.sales"), value: d.sellersCount }, { label: t("adm.fit.ss.pill.today"), value: m(d.sellersToday), strong: true }] },
        { title: t("adm.ss.recent"), pills: [{ label: t("adm.fit.ss.pill.sales"), value: s.recent.length }, { label: t("adm.scr.total"), value: m(d.recentTotal), strong: true }] },
      ],
      tables: [
        { title: t("adm.ss.recent"), sheet: t("adm.fit.ss.sheet.recent"), cols: recentCols, rows: s.recent, totals: { total: d.recentTotal }, totalsLabel: t("adm.fit.stage.total"), empty: t("adm.ss.noRecent"), main: true, rowCls: (r) => (r.status === "voided" ? "voided" : "") },
        { title: t("adm.fit.ss.alerts"), sheet: t("adm.fit.ss.sheet.alerts"), cols: [{ header: t("adm.fit.ss.col.severity"), get: (a) => sevText(a.tone), width: 10, tag: true, cls: (a) => (a.tone === "bad" ? "bad" : a.tone === "warn" ? "on" : "") }, { header: t("adm.fit.ss.col.alert"), get: attText, width: 70 }], rows: d.attention, empty: t("adm.ss.allGood") },
        { title: t("adm.ss.tills"), sheet: t("adm.fit.ss.sheet.tills"), cols: [
          { header: t("adm.fit.ss.col.till"), get: (x) => `${x.code}${x.name ? ` · ${x.name}` : ""}`, width: 24 },
          { header: t("adm.fit.ss.col.sellers"), get: (x) => x.sellers.map((v) => v.code).join(", "), width: 20 },
          { header: t("adm.fit.ss.col.status"), get: tillStatus, width: 12, tag: true, cls: (x) => (!x.is_active ? "bad" : x.register ? "good" : "") },
          { header: t("adm.fit.ss.col.opened"), get: (x) => (x.register ? timeOf(x.register.opened_at, lang) : ""), width: 12 },
          { header: t("adm.fit.ss.col.opening"), get: (x) => x.register?.opening ?? "", type: "money", width: 12 },
          { header: t("adm.fit.ss.col.expected"), get: (x) => x.register?.expected ?? "", type: "money", width: 14 },
        ], rows: s.tills, empty: t("adm.stores.tills.empty") },
        { title: t("adm.fit.ss.pending"), sheet: t("adm.fit.ss.sheet.pending"), cols: [{ header: t("adm.fit.ss.col.item"), key: "k", width: 28 }, { header: t("adm.fit.ss.col.n"), key: "n", type: "int", width: 10 }, { header: t("adm.fit.ss.col.amount"), key: "v", type: "money", width: 14, text: (r) => (r.v != null && r.n > 0 ? m(r.v) : "—") }], rows: [
          { k: t("adm.ss.pend.approvals"), n: p.approvals }, { k: t("adm.ss.pend.voids"), n: p.voids }, { k: t("adm.ss.pend.ready"), n: p.ready.length },
          { k: t("adm.ss.pend.balance"), n: p.with_balance.count, v: p.with_balance.amount }, { k: t("adm.ss.pend.insurance"), n: p.insurance_claims, v: s.insurance_due },
        ] },
        ...(p.ready.length ? [{ title: t("adm.ss.pend.ready"), sheet: t("adm.fit.ss.sheet.ready"), cols: [{ header: t("adm.fit.ss.col.sale"), key: "number", width: 14 }, { header: t("adm.fit.ss.col.seller"), key: "seller_code", width: 10 }, { header: t("adm.fit.ss.col.stage"), get: (r) => t(`adm.my.stage.${r.stage}`), width: 24 }, { header: t("adm.fit.ss.col.balance"), key: "balance", type: "money", width: 12 }], rows: p.ready }] : []),
        { title: t("adm.ss.sellersToday"), sheet: t("adm.fit.ss.sheet.sellers"), cols: [
          { header: t("adm.fit.ss.col.seller"), key: "name", width: 24 }, { header: t("adm.fit.ss.col.code"), key: "code", width: 10 }, { header: t("adm.fit.ss.col.terminal"), key: "terminal_code", width: 10 },
          { header: t("adm.fit.ss.col.kind"), get: sellerKind, width: 18 }, { header: t("adm.fit.ss.col.status"), get: (v) => (v.active ? t("adm.fit.ss.active") : t("adm.stores.tills.status.inactive")), width: 10, tag: true, cls: (v) => (v.active ? "good" : "bad") },
          { header: t("adm.fit.ss.col.today"), key: "today_total", type: "money", width: 12 }, { header: t("adm.fit.ss.col.count"), key: "today_count", type: "int", width: 10 },
        ], rows: s.sellers, totals: { today_total: d.sellersToday, today_count: d.sellersCount }, totalsLabel: t("adm.fit.stage.total"), empty: t("adm.ss.noSellersStore") },
      ],
      landscape: true,
    };
  };

  const kpi = (key, { label, value, note, tone, onClick, hero, on }) => (
    <button type="button" key={key} className={`adm-fit-kpi ${hero ? "hero" : ""} ${on ? "on" : ""}`} onClick={onClick} disabled={!onClick}>
      <small>{label}</small><b>{value}</b>{note && <i className={tone || ""}>{note}</i>}
    </button>
  );
  // Acordeones controlados: lo recordado (localStorage) o el valor por defecto; al imprimir, todos abiertos.
  const openIf = (id, fallback = false) => openMap[id] ?? readOpen(id, fallback);
  const toggled = (id) => (o) => setOpenMap((prev) => ({ ...prev, [id]: o }));

  return (
    <div className="adm-section ss adm-fit" ref={bodyRef}>
      <div className="adm-fit-bar">
        <div className="adm-fit-title">
          <h2>{t("adm.tab.storestatus")}</h2>
          <p className="adm-fit-sub">{t("adm.ss.sub")}</p>
        </div>
        <div className="adm-fit-tools adm-noprint">
          <StoreFilter me={me} />
          {/* Con «Todas» o la online se enseña la primera tienda: se dice cuál. */}
          {(!globalStore || globalStore.id !== s.store.id) && (
            <span className="scr-store-note" title={data.stores.length > 1 ? t("adm.scr.storeHint") : undefined}>
              <Icon name="store" size={12} /> {t("adm.scr.storeShown", { store: storeLabel })}
            </span>
          )}
          <button type="button" className="btn-xs" onClick={() => load(storeId, { force: true })} disabled={state === "loading"} aria-label={t("adm.my.refresh")} title={t("adm.my.refresh")}><Icon name="refresh" size={13} /></button>
          <span className="adm-fit-export adm-export-menu">
            <button type="button" className="btn-xs" title={t("adm.ui.pdf")} onClick={() => exportReport("pdf", report())}><Icon name="printer" size={14} />PDF</button>
            <button type="button" className="btn-xs" title={t("adm.ui.xlsx")} onClick={() => exportReport("xlsx", report())}><Icon name="sheet" size={14} />Excel</button>
            <button type="button" className="btn-xs" title={t("adm.ui.csv")} onClick={() => exportReport("csv", report())}><Icon name="excel" size={14} />CSV</button>
          </span>
        </div>
      </div>

      <div className="adm-fit-kpis">
        {kpi("today", { hero: true, label: t("adm.my.today"), value: m(s.today.total), onClick: link("salesboard"),
          note: `${d.dToday !== null ? `${d.dToday > 0 ? "+" : ""}${d.dToday}% ${t("adm.fit.ss.vs")} · ` : ""}${s.today.count} ${t("adm.scr.count")} · ${t("adm.fit.ss.avg", { v: m(s.today.avg_ticket) })}`, tone: d.dToday !== null ? (d.dToday >= 0 ? "good" : "bad") : "" })}
        {["week", "month"].map((k) => kpi(k, { label: t(`adm.my.${k}`), value: m(s[k].total), note: `${s[k].count} ${t("adm.scr.count")} · ${t("adm.fit.ss.avg", { v: m(s[k].avg_ticket) })}`, onClick: link("salesboard") }))}
        {kpi("approvals", { label: t("adm.ss.pend.approvals"), value: p.approvals, on: p.approvals > 0, onClick: link("approvals") })}
        {kpi("voids", { label: t("adm.ss.pend.voids"), value: p.voids, on: p.voids > 0, onClick: link("possales") })}
        {kpi("ready", { label: t("adm.ss.pend.ready"), value: p.ready.length, on: p.ready.length > 0, onClick: link("possales") })}
        {kpi("balance", { label: t("adm.ss.pend.balance"), value: p.with_balance.count, note: p.with_balance.count > 0 ? m(p.with_balance.amount) : undefined, on: p.with_balance.count > 0, onClick: link("possales") })}
        {kpi("insurance", { label: t("adm.ss.pend.insurance"), value: p.insurance_claims, note: p.insurance_claims > 0 ? m(s.insurance_due) : undefined, on: p.insurance_claims > 0, onClick: link("possales") })}
      </div>

      <div className="adm-fit-body">
        <AccordionGroup>
          <Accordion id="ss-alerts" icon="alert" title={t("adm.fit.ss.alerts")} subtitle={t("adm.fit.ss.alertsSub")} open={openIf("ss-alerts", true)} onToggle={toggled("ss-alerts")} badge={d.attention.length || null}
            summary={d.attention.length ? [
              d.sev.bad ? { label: t("adm.fit.ss.pill.bad"), value: d.sev.bad, tone: "bad", strong: true } : null,
              d.sev.warn ? { label: t("adm.fit.ss.pill.warn"), value: d.sev.warn, tone: "warn" } : null,
              d.sev.info ? { label: t("adm.fit.ss.pill.info"), value: d.sev.info, tone: "muted" } : null,
            ] : [{ label: "", value: t("adm.fit.ss.pill.none"), tone: "good" }]}>
            {d.attention.length === 0 ? <div className="adm-fit-alerts"><div className="ss-allgood"><Icon name="checkCircle" size={16} /> {t("adm.ss.allGood")}</div></div> : (
              <div className="adm-fit-alerts">
                {d.attention.map((a, i) => {
                  const onClick = link(ATT_TARGET[a.kind]);
                  return (
                    <button type="button" key={`${a.kind}-${a.ref || i}`} className={`ss-alert ${a.tone}`} onClick={onClick} disabled={!onClick}>
                      <Icon name={a.tone === "info" ? "info" : "alert"} size={14} />
                      <span>{attText(a)}</span>
                      {onClick && <Icon name="chevronRight" size={14} />}
                    </button>
                  );
                })}
              </div>
            )}
          </Accordion>

          <Accordion id="ss-tills" icon="receipt" title={t("adm.ss.tills")} subtitle={t("adm.ss.tillsNote", { open: d.openRegisters, active: d.activeTills })} open={openIf("ss-tills", d.urgent === "tills")} onToggle={toggled("ss-tills")}
            right={<>{link("cash") && <button type="button" className="btn-xs" onClick={link("cash")}>{t("adm.tab.cash")} <Icon name="arrowRight" size={12} /></button>}{link("stores") && <button type="button" className="btn-xs" onClick={link("stores")}>{t("adm.ss.manageTills")} <Icon name="arrowRight" size={12} /></button>}</>}
            summary={[
              { label: t("adm.fit.ss.pill.open"), value: `${d.openRegisters}/${d.activeTills}`, tone: d.activeTills && !d.openRegisters ? "warn" : "" },
              { label: t("adm.fit.ss.pill.cash"), value: m(d.cashExpected), strong: true },
            ]}>
            {!s.tills.length ? <div className="adm-nodata">{t("adm.stores.tills.empty")}</div> : (
              <div className="acc-scroll dense">
                <table className="adm-table adm-fit-table">
                  <thead><tr>{sth(tillsSorted, "code", t("adm.fit.ss.col.till"))}{sth(tillsSorted, "sellers", t("adm.fit.ss.col.sellers"))}{sth(tillsSorted, "status", t("adm.fit.ss.col.status"))}{sth(tillsSorted, "opened", t("adm.fit.ss.col.opened"))}{sth(tillsSorted, "opening", t("adm.fit.ss.col.opening"), "r")}{sth(tillsSorted, "expected", t("adm.fit.ss.col.expected"), "r")}</tr></thead>
                  <tbody>
                    {tillsSorted.rows.map((x) => {
                      const onClick = link("cash");
                      return (
                        <tr key={x.id} className={`${onClick ? "row-go" : ""} ${x.is_active ? "" : "off"}`} onClick={onClick} title={onClick ? t("adm.fit.ss.goCash") : undefined}>
                          <td><b>{x.code}</b>{x.name ? ` · ${x.name}` : ""}</td>
                          <td className="muted">{x.sellers.length ? x.sellers.map((v) => v.code).join(", ") : t("adm.ss.noSellers")}</td>
                          <td>{!x.is_active ? <span className="adm-chip bad">{t("adm.stores.tills.status.inactive")}</span> : x.register ? <span className="adm-chip ok"><Icon name="wallet" size={11} />{t("adm.fit.ss.open")}</span> : <span className="adm-chip neutral"><Icon name="wallet" size={11} />{t("adm.my.cashClosed")}</span>}</td>
                          <td>{x.register ? timeOf(x.register.opened_at, lang) : "—"}</td>
                          <td className="num">{x.register ? m(x.register.opening) : "—"}</td>
                          <td className="num"><b>{x.register ? m(x.register.expected) : "—"}</b></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Accordion>

          <Accordion id="ss-pending" icon="hand" title={t("adm.fit.ss.pending")} subtitle={t("adm.fit.ss.pendingSub")} open={openIf("ss-pending", d.urgent === "pending")} onToggle={toggled("ss-pending")} badge={d.pendingN || null}
            summary={[
              { label: t("adm.fit.ss.pill.pending"), value: d.pendingN, tone: d.pendingN ? "warn" : "muted", strong: !!d.pendingN },
              { label: t("adm.fit.ss.pill.ready"), value: p.ready.length },
              { label: t("adm.fit.ss.pill.balance"), value: m(p.with_balance.amount) },
            ]}>
            <div className="acc-scroll dense">
              <table className="adm-table adm-fit-table">
                <thead><tr><th>{t("adm.fit.ss.col.item")}</th><th className="r">{t("adm.fit.ss.col.n")}</th><th className="r">{t("adm.fit.ss.col.amount")}</th></tr></thead>
                <tbody>
                  {[
                    { k: "approvals", n: p.approvals, tab: "approvals", title: t("adm.fit.ss.goApprovals") },
                    { k: "voids", n: p.voids, tab: "possales", title: t("adm.fit.ss.goSales") },
                    { k: "balance", n: p.with_balance.count, v: p.with_balance.amount, tab: "possales", title: t("adm.fit.ss.goSales") },
                    { k: "insurance", n: p.insurance_claims, v: s.insurance_due, tab: "possales", title: t("adm.fit.ss.goSales") },
                  ].map((x) => {
                    const onClick = link(x.tab);
                    return (
                      <tr key={x.k} className={onClick ? "row-go" : ""} onClick={onClick} title={onClick ? x.title : undefined}>
                        <td><b>{t(`adm.ss.pend.${x.k}`)}</b></td>
                        <td className="num">{x.n ? <span className="adm-chip warn">{x.n}</span> : <span className="muted">0</span>}</td>
                        <td className="num">{x.v != null && x.n > 0 ? m(x.v) : "—"}</td>
                      </tr>
                    );
                  })}
                  {p.ready.map((r) => {
                    const onClick = link("possales");
                    return (
                      <tr key={r.id} className={onClick ? "row-go" : ""} onClick={onClick} title={onClick ? t("adm.fit.ss.goSales") : undefined}>
                        <td><Icon name="hand" size={12} /> <b>{r.number}</b>{r.seller_code ? ` · ${r.seller_code}` : ""} <span className="muted">· {t(`adm.my.stage.${r.stage}`)}</span></td>
                        <td className="num"><span className="adm-chip ok">{t("adm.ss.pend.ready")}</span></td>
                        <td className="num">{r.balance > 0 ? t("adm.my.toCollect", { v: m(r.balance) }) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted ss-foot">{t("adm.ss.balanceFoot", { v: m(s.balance_due) })}</p>
          </Accordion>

          <Accordion id="ss-sellers" icon="sellers" title={t("adm.ss.sellersToday")} open={openIf("ss-sellers")} onToggle={toggled("ss-sellers")}
            right={link("sellers") && <button type="button" className="btn-xs" onClick={link("sellers")}>{t("adm.tab.sellers")} <Icon name="arrowRight" size={12} /></button>}
            summary={[
              { label: t("adm.fit.ss.pill.sellers"), value: `${d.sellersActive}/${s.sellers.length}` },
              { label: t("adm.fit.ss.pill.sales"), value: d.sellersCount },
              { label: t("adm.fit.ss.pill.today"), value: m(d.sellersToday), strong: true },
            ]}>
            {!s.sellers.length ? <div className="adm-nodata">{t("adm.ss.noSellersStore")}</div> : (
              <div className="acc-scroll dense">
                <table className="adm-table adm-fit-table">
                  <thead><tr>{sth(sellersSorted, "name", t("adm.fit.ss.col.seller"))}{sth(sellersSorted, "terminal_code", t("adm.fit.ss.col.terminal"))}{sth(sellersSorted, "kind", t("adm.fit.ss.col.kind"))}{sth(sellersSorted, "today_count", t("adm.fit.ss.col.count"), "r")}{sth(sellersSorted, "today_total", t("adm.fit.ss.col.today"), "r")}</tr></thead>
                  <tbody>
                    {sellersSorted.rows.map((v) => {
                      const onClick = link("sellers");
                      return (
                        <tr key={v.id} className={`${onClick ? "row-go" : ""} ${v.active ? "" : "off"}`} onClick={onClick} title={onClick ? t("adm.fit.ss.goSellers") : undefined}>
                          <td><b>{v.name}</b> <span className="sel-code">{v.code}</span>{!v.active && <span className="adm-chip bad" style={{ marginLeft: 6 }}>{t("adm.stores.tills.status.inactive")}</span>}</td>
                          <td>{v.terminal_code || "—"}</td>
                          <td className="muted">{sellerKind(v)}</td>
                          <td className="num">{v.today_count}</td>
                          <td className="num"><b>{m(v.today_total)}</b></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Accordion>

          <Accordion id="ss-recent" icon="receipt" title={t("adm.ss.recent")} open={openIf("ss-recent")} onToggle={toggled("ss-recent")}
            right={link("possales") && s.recent.length > 0 && <button type="button" className="btn-xs" onClick={link("possales")}>{t("adm.my.seeAll")} <Icon name="arrowRight" size={12} /></button>}
            summary={[{ label: t("adm.fit.ss.pill.sales"), value: s.recent.length }, { label: t("adm.scr.total"), value: m(d.recentTotal), strong: true }]}>
            {!s.recent.length ? <div className="adm-nodata">{t("adm.ss.noRecent")}</div> : (
              <div className="acc-scroll dense">
                <table className="adm-table adm-fit-table">
                  <thead><tr>{recentCols.map((c) => <SortTh key={c.header} col={c.sortKey} sort={recentSorted.sort} onSort={recentSorted.toggle} align={c.type === "money" ? "r" : ""}>{c.header}</SortTh>)}</tr></thead>
                  <tbody>
                    {recentSorted.rows.map((r) => {
                      const onClick = link("possales");
                      return (
                        <tr key={r.id} className={`${onClick ? "row-go" : ""} ${r.status === "voided" ? "off" : ""}`} onClick={onClick} title={onClick ? t("adm.fit.ss.goSales") : undefined}>
                          <td><b>{r.number}</b></td>
                          <td className="muted">{shortDate(r.created_at, lang)} {timeOf(r.created_at, lang)}</td>
                          <td>{r.seller_code || "—"}</td>
                          <td>{r.terminal_code || "—"}</td>
                          <td>{r.status === "voided" ? <span className="adm-chip bad">{t("adm.my.voided")}</span> : r.delivered ? <span className="adm-chip ok">{t("adm.my.delivered")}</span> : <span className="adm-chip neutral">{t("adm.fit.ss.status.completed")}</span>}</td>
                          <td className="num"><b>{m(r.total)}</b></td>
                          <td className="num">{r.status !== "voided" && r.balance > 0 ? m(r.balance) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Accordion>
        </AccordionGroup>
      </div>
    </div>
  );
}

// Mapa de inicio. Dónde se usa: AdminDashboard.jsx, en cada recarga del
// navegador (`<WelcomeBriefing me={me} go={go} onDone=… />`). Se pinta como capa
// sobre el ÁREA DE CONTENIDO del panel (portal dentro de `.adm-main`: la barra
// lateral queda nítida y usable), con el fondo difuminado y una tarjeta centrada
// donde CADA cifra es un botón que lleva a operar (`go(tab, params)`):
//
//   ventas (ayer · hoy · esta semana · semana pasada · este mes · mes pasado)
//     → Ejecutivo con ese período (vendedor: Mi panel);
//   costos de los mismos períodos (solo quien ve costos; el vendedor ve su
//     comisión) → Ejecutivo › Costos;
//   pendientes: en laboratorio / por entregar → Pedidos de la tienda; dinero en
//     la calle / atrasados → Cobros pendientes; por aprobar → Aprobaciones;
//     cajas abiertas → Caja;
//   una línea por tienda (nunca al vendedor) → fija esa tienda y abre el Ejecutivo;
//   avisos derivados de los pendientes, cada uno con su destino.
//
// Una sola lectura: GET /admin/pos/start-map?store= (lib/start-map.ts), ya
// acotada por rol en el servidor: el vendedor recibe SUS cifras y los saldos de
// su tienda; costo y ganancia solo llegan cuando `access.profit`. Esqueletos
// mientras carga; si falla, las cifras quedan en «—» y los botones siguen
// llevando a su pantalla. Escape, el fondo y «Omitir» la cierran; «Empezar»
// también. Props: `me` (GET /admin/team/me), `onDone`, `go`.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { adminFetch } from "./adminApi.js";
import { money } from "./adminOrders.js";
import { navGroupsFor, tabsOf } from "./AdminShell.jsx";
import { useStoreFilter } from "./StoreFilter.jsx";
import { WEB_STORE, defaultColorForStore, setActiveStore, webStoreLabel, webStoreOf } from "./useStoreTheme.js";
import "./start-map.css";

const PERIODS = ["yesterday", "today", "this_week", "last_week", "this_month", "last_month"];
/** Período del mapa → período de la barra del Ejecutivo / Pedidos de la tienda (StoreOrders.jsx usePeriod). */
const EXEC_PERIOD = { yesterday: "yesterday", today: "today", this_week: "week", last_week: "lastWeek", this_month: "month", last_month: "lastMonth" };

const cents = (c) => (Number(c) || 0) / 100;

/** Variación contra el período anterior: null sin base de comparación. */
function deltaOf(cur, prev) {
  if (prev == null || !Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return { pct, tone: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}

const Skel = ({ w = "70%", sm = false }) => <span className={`adm-skel ${sm ? "sm" : ""}`} style={{ width: w }} aria-hidden="true" />;

/** Tesela-botón: etiqueta, cifra grande y una línea de contexto. */
function Tile({ label, value, sub, delta, tone = "", loading = false, failed = false, onClick, title }) {
  return (
    <button type="button" className={`sm-tile ${tone}`} onClick={onClick} title={title || undefined}>
      <small>{label}</small>
      {loading ? <Skel /> : <b>{failed ? "—" : value}</b>}
      {loading ? <Skel sm /> : (
        <span>
          {delta && <i className={`delta ${delta.tone}`}><Icon name={delta.tone === "down" ? "trendDown" : delta.tone === "up" ? "trendUp" : "moreH"} size={10} />{delta.pct > 0 ? "+" : ""}{delta.pct}%</i>}
          {sub}
        </span>
      )}
      <Icon name="chevronRight" size={14} className="chev" />
    </button>
  );
}

/** Capa de posición: ocupa `.adm-main` (desde su borde izquierdo hasta el derecho). */
function useMainOffset() {
  const [left, setLeft] = useState(0);
  const [host, setHost] = useState(null);
  useEffect(() => {
    const main = typeof document !== "undefined" ? document.querySelector(".adm-main") : null;
    setHost(main || (typeof document !== "undefined" ? document.body : null));
    if (!main) return undefined;
    const measure = () => setLeft(Math.max(0, Math.round(main.getBoundingClientRect().left)));
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(main);
    window.addEventListener("resize", measure);
    // La barra lateral se contrae con transición: medir también al acabar.
    const shell = main.closest(".adm-shell");
    shell?.addEventListener("transitionend", measure);
    return () => { ro?.disconnect(); window.removeEventListener("resize", measure); shell?.removeEventListener("transitionend", measure); };
  }, []);
  return { left, host };
}

export default function WelcomeBriefing({ me, onDone, go }) {
  const { t, lang } = useLang();
  const { store, stores, param } = useStoreFilter(me);
  const tabs = useMemo(() => tabsOf(navGroupsFor(me)), [me]);
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const cardRef = useRef(null);
  const { left, host } = useMainOffset();

  useEffect(() => {
    let on = true;
    adminFetch(`/admin/pos/start-map${param("store") ? `?${param("store")}` : ""}`)
      .then((d) => on && setData(d))
      .catch(() => on && setFailed(true));
    return () => { on = false; };
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Foco en la tarjeta en cuanto existe (el portal espera a `.adm-main`).
  useEffect(() => { if (host) cardRef.current?.focus({ preventScroll: true }); }, [host]);
  // Escape cierra, y el contenido de detrás no hace scroll.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onDone?.(); } };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const seller = me?.is_admin === false && me?.role === "seller";
  const m = (c) => money(cents(c), "usd", lang);
  const displayName = me?.display_name || me?.first_name || String(me?.email || "").split("@")[0];
  const initials = displayName.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  const roleLabel = me?.role ? t(`adm.team.role.${me.role}`) : "";
  const today = useMemo(() => new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es-ES", { weekday: "long", day: "numeric", month: "long" }).format(new Date()), [lang]);

  // Dónde está: su tienda (vendedor, o la que diga el servidor) o el filtro global del panel.
  const where = data?.me?.store_code
    ? { label: `${data.me.store_code} · ${data.me.store_name}`, color: data.me.store_color || defaultColorForStore(data.me.store_name) }
    : store ? { label: store.online && !store.establishment_id ? t("adm.theme.online") : `${store.code} · ${store.name}`, color: store.color || defaultColorForStore(store.name) } : { label: t("adm.theme.allStores"), color: null };

  const showProfit = Boolean(data?.access?.profit);
  const showCommission = !showProfit && Boolean(data?.access?.commission);
  // Mientras carga, la fila de costos solo se esboza a quien puede llegar a verla.
  const mayProfit = me?.is_admin !== false || (me?.privileges || []).some((x) => x === "costs.view" || x === "costs.manage");
  const loading = !data && !failed;
  const p = (k) => data?.periods?.[k];
  const pend = data?.pending;

  // Destinos: la primera pestaña que el rol tiene (AdminShell.navGroupsFor); go() cae en la primera suya si no.
  const first = (...keys) => keys.find((k) => tabs.includes(k)) || tabs[0];
  const jump = (tab, params) => { go?.(tab, params); onDone?.(); };
  const toSales = (k) => jump(first("exec", "mysales"), { period: EXEC_PERIOD[k] });
  const toCosts = (k) => jump(first("exec", "storecosts", "mysales"), { sub: "costs", period: EXEC_PERIOD[k] });
  const toCommission = (k) => jump(first("mysales", "exec"), { period: EXEC_PERIOD[k] });
  const toLab = (stage) => jump(first("storeorders", "possales", "mysales"), { stage });
  const toBalances = (overdue) => jump(first("pendingbalances", "possales", "mysales"), overdue ? { overdue: 1 } : {});
  const toApprovals = () => jump(first("approvals", "pos"), {});
  const toCash = () => jump("cash", {});
  const toStore = (id) => { setActiveStore(id === WEB_STORE.id ? WEB_STORE.id : id); jump(first("exec", "storestatus", "mysales"), {}); };

  const storeInfo = useMemo(() => {
    const map = new Map(stores.map((s) => [s.id, { name: `${s.code ? `${s.code} · ` : ""}${s.name}`, color: s.color || defaultColorForStore(s.name) }]));
    map.set(WEB_STORE.id, { name: webStoreLabel(stores, t), color: webStoreOf(stores).color });
    return map;
  }, [stores, t]);

  // Avisos: lo que no puede esperar, cada uno con su destino.
  const alerts = [];
  if (pend) {
    if (pend.overdue_balances.count > 0) alerts.push({ k: "overdue", tone: "bad", text: t("adm.wb.alert.overdue", { n: pend.overdue_balances.count }), go: () => toBalances(true) });
    if (pend.open_tills > 0) alerts.push({ k: "tills", tone: "warn", text: t("adm.wb.alert.tills", { n: pend.open_tills }), go: toCash });
    if (pend.approvals > 0) alerts.push({ k: "approvals", tone: "warn", text: t("adm.wb.alert.approvals", { n: pend.approvals }), go: toApprovals });
    if (pend.to_deliver.count > 0) alerts.push({ k: "deliver", tone: "info", text: t("adm.wb.alert.deliver", { n: pend.to_deliver.count }), go: () => toLab("ready") });
    if (data?.truncated) alerts.push({ k: "trunc", tone: "info", text: t("adm.wb.alert.truncated"), go: () => toSales("this_month") });
  }

  const body = (
    <div className="sm-overlay" style={{ "--sm-left": `${left}px` }}>
      <div className="sm-backdrop" onClick={() => onDone?.()} aria-hidden="true" />
      <div className="sm-card" role="dialog" aria-modal="true" aria-label={t("adm.wb.title")} tabIndex={-1} ref={cardRef}>
        <button type="button" className="sm-close" onClick={() => onDone?.()} aria-label={t("adm.wb.close")} title={t("adm.wb.close")}><Icon name="close" size={16} /></button>

        <div className="sm-head">
          <span className="sm-avatar">{me?.photo_url ? <img src={me.photo_url} alt="" /> : initials}</span>
          <div className="sm-who">
            <h2>{t("adm.wb.greeting", { name: displayName })}</h2>
            <small>
              {roleLabel && <span>{roleLabel}</span>}
              {roleLabel && <span className="sep">·</span>}
              <span><i className="sm-dot" style={{ background: where.color || "var(--adm-muted)" }} /> {where.label}</span>
              {me?.seller_code && <span className="adm-team-tag code">{me.seller_code}</span>}
              <span className="sep">·</span>
              <span>{today}</span>
            </small>
            <p className="sm-hint">{seller ? t("adm.wb.mine") : t("adm.wb.business")} · {t("adm.wb.hint")}</p>
          </div>
        </div>

        {data && (
          <div className="sm-alerts" role="group" aria-label={t("adm.wb.row.alerts")}>
            {alerts.map((a) => <button key={a.k} type="button" className={`sm-alert ${a.tone}`} onClick={a.go}><Icon name={a.tone === "info" ? "info" : "alert"} size={12} /> {a.text} <Icon name="chevronRight" size={12} /></button>)}
            {!alerts.length && <span className="sm-alert ok"><Icon name="checkCircle" size={12} /> {t("adm.wb.allClear")}</span>}
          </div>
        )}

        <section className="sm-row" aria-label={t("adm.wb.row.sales")}>
          <div className="sm-row-head"><h3>{t("adm.wb.row.sales")}</h3><span>{seller ? t("adm.wb.mine") : t("adm.wb.business")}</span></div>
          <div className="sm-grid cols-6">
            {PERIODS.map((k) => {
              const f = p(k);
              return (
                <Tile key={k} label={t(`adm.wb.p.${k}`)} tone={k === "today" ? "hero" : ""} loading={loading} failed={!f}
                  value={f ? m(f.sales_cents) : "—"} sub={f ? t("adm.wb.sales", { n: f.count }) : ""}
                  delta={f?.prev ? deltaOf(f.sales_cents, f.prev.sales_cents) : null}
                  title={f ? `${f.from} → ${f.to}` : undefined} onClick={() => toSales(k)} />
              );
            })}
          </div>
        </section>

        {(showProfit || (loading && mayProfit)) && !seller && (
          <section className="sm-row" aria-label={t("adm.wb.row.costs")}>
            <div className="sm-row-head"><h3>{t("adm.wb.row.costs")}</h3><span>{t("adm.wb.costsHint")}</span></div>
            <div className="sm-grid cols-6">
              {PERIODS.map((k) => {
                const f = p(k);
                const has = f && f.cost_cents != null;
                return (
                  <Tile key={k} label={t(`adm.wb.p.${k}`)} tone="cost" loading={loading} failed={!has}
                    value={has ? m(f.cost_cents) : "—"} sub={has ? (f.profit_cents != null ? t("adm.wb.profit", { v: m(f.profit_cents) }) : "") : t("adm.wb.noCost")}
                    delta={has && f.prev && f.prev.cost_cents != null ? deltaOf(f.cost_cents, f.prev.cost_cents) : null}
                    onClick={() => toCosts(k)} />
                );
              })}
            </div>
          </section>
        )}

        {showCommission && (
          <section className="sm-row" aria-label={t("adm.wb.row.commission")}>
            <div className="sm-row-head"><h3>{t("adm.wb.row.commission")}</h3></div>
            <div className="sm-grid cols-6">
              {PERIODS.map((k) => {
                const f = p(k);
                const has = f && f.commission_cents != null;
                return (
                  <Tile key={k} label={t(`adm.wb.p.${k}`)} tone="gold" loading={loading} failed={!has}
                    value={has ? m(f.commission_cents) : "—"} sub={f ? t("adm.wb.sales", { n: f.count }) : ""}
                    delta={has && f.prev && f.prev.commission_cents != null ? deltaOf(f.commission_cents, f.prev.commission_cents) : null}
                    onClick={() => toCommission(k)} />
                );
              })}
            </div>
          </section>
        )}

        <section className="sm-row" aria-label={t("adm.wb.row.pending")}>
          <div className="sm-row-head"><h3>{t("adm.wb.row.pending")}</h3></div>
          <div className="sm-grid cols-6">
            <Tile label={t("adm.wb.inLab")} loading={loading} failed={!pend} value={pend ? String(pend.in_lab.count) : "—"}
              sub={pend ? (pend.in_lab.count ? t("adm.wb.worth", { v: m(pend.in_lab.cents) }) : t("adm.wb.none")) : ""} onClick={() => toLab("in_lab")} />
            <Tile label={t("adm.wb.toDeliver")} loading={loading} failed={!pend} value={pend ? String(pend.to_deliver.count) : "—"} tone={pend?.to_deliver.count ? "hero" : ""}
              sub={pend ? (pend.to_deliver.count ? t("adm.wb.toCollect", { v: m(pend.to_deliver.balance_cents) }) : t("adm.wb.none")) : ""} onClick={() => toLab("ready")} />
            <Tile label={t("adm.wb.onStreet")} loading={loading} failed={!pend} value={pend ? m(pend.on_street.cents) : "—"} tone={pend?.on_street.count ? "warn" : ""}
              sub={pend ? t("adm.wb.balances", { n: pend.on_street.count }) : ""} onClick={() => toBalances(false)} />
            <Tile label={t("adm.wb.overdue")} loading={loading} failed={!pend} value={pend ? m(pend.overdue_balances.cents) : "—"} tone={pend?.overdue_balances.count ? "bad" : ""}
              sub={pend ? t("adm.wb.balances", { n: pend.overdue_balances.count }) : ""} onClick={() => toBalances(true)} />
            <Tile label={t("adm.wb.toApprove")} loading={loading} failed={!pend} value={pend ? String(pend.approvals) : "—"} tone={pend?.approvals ? "warn" : ""}
              sub={pend ? (pend.approvals ? t("adm.wb.requests", { n: pend.approvals }) : t("adm.wb.none")) : ""} onClick={toApprovals} />
            <Tile label={t("adm.wb.openTills")} loading={loading} failed={!pend} value={pend ? String(pend.open_tills) : "—"}
              sub={pend ? (pend.open_tills ? t("adm.wb.tills", { n: pend.open_tills }) : t("adm.wb.cashClosed")) : ""} onClick={toCash} />
          </div>
        </section>

        {!seller && (loading || data?.stores?.length > 0) && (
          <section className="sm-row" aria-label={t("adm.wb.row.stores")}>
            <div className="sm-row-head"><h3>{t("adm.wb.row.stores")}</h3></div>
            <div className="sm-stores-head" aria-hidden="true">
              <span />
              <span className="hero">{t("adm.wb.col.today")}</span>
              <span>{t("adm.wb.col.week")}</span>
              <span className="optional">{t("adm.wb.col.month")}</span>
              <span>{t("adm.wb.col.street")}</span>
              <span className="optional">{t("adm.wb.col.lab")}</span>
              <span />
            </div>
            <div className="sm-stores">
              {loading && [0, 1].map((i) => <div key={i} className="sm-store" aria-hidden="true"><span className="name"><Skel w="60%" /></span><span className="cell"><Skel w="100%" /></span><span className="cell"><Skel w="100%" /></span><span className="cell optional"><Skel w="100%" /></span><span className="cell"><Skel w="100%" /></span><span className="cell optional"><Skel w="100%" /></span><span /></div>)}
              {data?.stores?.map((s) => {
                const info = storeInfo.get(s.id) || { name: `${s.code} · ${s.name}`, color: s.color || defaultColorForStore(s.name) };
                return (
                  <button key={s.id} type="button" className="sm-store" onClick={() => toStore(s.id)}>
                    <span className="name"><i className="sm-dot" style={{ background: info.color || "var(--adm-muted)" }} />{info.name}</span>
                    <span className="cell hero"><small>{t("adm.wb.col.today")}</small><b>{m(s.today_cents)}</b></span>
                    <span className="cell"><small>{t("adm.wb.col.week")}</small><b>{m(s.week_cents)}</b></span>
                    <span className="cell optional"><small>{t("adm.wb.col.month")}</small><b>{m(s.month_cents)}</b></span>
                    <span className="cell street"><small>{t("adm.wb.col.street")}</small><b>{m(s.on_street_cents)}</b></span>
                    <span className="cell optional"><small>{t("adm.wb.col.lab")}</small><b>{s.in_lab}{s.to_deliver ? ` + ${s.to_deliver}` : ""}</b></span>
                    <Icon name="chevronRight" size={14} className="chev" />
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <div className="sm-foot">
          {failed && <p className="sm-err">{t("adm.wb.error")}</p>}
          <button type="button" className="btn-sm ghost" onClick={() => onDone?.()}>{t("adm.wb.skip")}</button>
          {go && <button type="button" className="btn-sm outline" onClick={() => jump("pos", {})}><Icon name="plus" size={14} /> {t("adm.wb.newSale")}</button>}
          <button type="button" className="btn-sm primary" onClick={() => onDone?.()}>{t("adm.wb.start")} <Icon name="chevronRight" size={14} /></button>
        </div>
      </div>
    </div>
  );

  if (!host) return null;
  return createPortal(body, host);
}

/**
 * Antes: «ya se mostró en esta pestaña» (sessionStorage). El mapa sale en CADA
 * recarga del navegador, así que siempre es falso; AdminDashboard puede dejar
 * de llamarlo (`useState(() => !demo && me)`).
 */
export function briefingShown() {
  return false;
}

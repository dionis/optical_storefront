// Dónde se usa: pestaña «Mi panel» de /admin — el panel del vendedor (E8) y la
// pantalla con la que arranca un usuario vendedor: su tienda y punto de venta
// (con la caja abierta o no), accesos a vender y a la caja, sus cifras de hoy,
// semana y mes, las ventas de la tienda hoy y su parte, comisión y meta, sus
// últimas ventas y los pedidos que volvieron del laboratorio (HU-50, HU-52,
// HU-53). La lista completa de sus ventas (HU-51) está en «Ventas de tienda».
import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { money, shortDate } from "./adminOrders.js";
import { adminFetch } from "./adminApi.js";

const PERIODS = ["today", "week", "month"];
const ZERO = { total: 0, count: 0, avg_ticket: 0 };

export default function MySales({ go }) {
  const { t, lang } = useLang();
  const [d, setD] = useState(null);
  const [state, setState] = useState("loading");
  const load = () => {
    setState("loading");
    adminFetch("/admin/sales-analytics/me").then((r) => { setD(r); setState("ok"); }).catch(() => setState("error"));
  };
  useEffect(load, []);
  const m = (v) => money(v, "usd", lang);
  if (state === "loading" && !d) return <div className="adm-section"><div className="adm-src-note loading">{t("adm.ord.loading")}</div></div>;
  if (state === "error" || !d) return <div className="adm-section"><div className="adm-demo-banner">{t("adm.err.pos.generic")}</div></div>;

  const pct = d.goal ? Math.min(100, Math.round((d.goal.done / (d.goal.amount || 1)) * 100)) : 0;
  const wp = d.workplace;
  const st = d.store_today;
  const share = st && st.total > 0 ? Math.round((st.mine / st.total) * 100) : 0;
  const tillName = wp?.terminal ? (wp.terminal.name ? `${wp.terminal.code} · ${wp.terminal.name}` : wp.terminal.code) : null;

  return (
    <div className="adm-section pos my-dash">
      <div className="adm-head-row">
        <div>
          <h2>{t("adm.tab.mysales")}</h2>
          {wp && (
            <p className="adm-sub my-where">
              <Icon name="store" size={14} /> {wp.store.code} · {wp.store.name}
              {tillName && <> · <Icon name="receipt" size={14} /> {tillName}</>}
            </p>
          )}
        </div>
        <div className="my-head-tags">
          {wp && (
            <button type="button" className={`adm-chip ${wp.cash_open ? "ok" : "neutral"}`} onClick={() => go?.("cash")} title={t("adm.my.cashHint")}>
              <Icon name="wallet" size={12} /> {t(wp.cash_open ? "adm.my.cashOpen" : "adm.my.cashClosed")}
            </button>
          )}
          {d.seller_code && <span className="adm-team-tag code">{d.seller_code}</span>}
          <button type="button" className="btn-xs" onClick={load} disabled={state === "loading"} aria-label={t("adm.my.refresh")} title={t("adm.my.refresh")}><Icon name="refresh" size={13} /></button>
        </div>
      </div>

      {go && (
        <div className="my-actions">
          <button type="button" className="btn-sm primary big" onClick={() => go("pos")}><Icon name="plus" size={15} /> {t("adm.tab.pos")}</button>
          <button type="button" className="btn-sm" onClick={() => go("cash")}><Icon name="wallet" size={14} /> {t("adm.tab.cash")}</button>
          <button type="button" className="btn-sm" onClick={() => go("possales")}><Icon name="receipt" size={14} /> {t("adm.tab.possales")}</button>
        </div>
      )}

      <div className="my-periods">
        {PERIODS.map((k) => {
          const s = d[k] || ZERO;
          return (
            <button type="button" key={k} className={`my-period ${k === "today" ? "hero" : ""}`} onClick={() => go?.("possales")}>
              <small>{t(`adm.my.${k}`)}</small>
              <b>{m(s.total)}</b>
              <span className="muted">{t("adm.my.periodSub", { n: s.count, avg: m(s.avg_ticket) })}</span>
            </button>
          );
        })}
      </div>

      <div className="my-grid">
        {st && (
          <div className="adm-card">
            <h3><Icon name="store" size={16} /> {t("adm.my.storeToday", { code: wp.store.code })}</h3>
            <div className="my-store">
              <div><small className="muted">{t("adm.my.storeTotal")}</small><b>{m(st.total)}</b><span className="muted">{t("adm.my.storeCount", { n: st.count })}</span></div>
              <div><small className="muted">{t("adm.my.mine")}</small><b>{m(st.mine)}</b><span className="muted">{t("adm.my.share", { pct: share })}</span></div>
            </div>
            <div className="my-goal" aria-label={t("adm.my.share", { pct: share })}><i style={{ width: `${share}%` }} /></div>
          </div>
        )}

        <div className="adm-card">
          <h3><Icon name="percent" size={16} /> {t("adm.my.goalTitle")}</h3>
          {d.commission ? <p>{t("adm.my.commission", { pct: d.commission.pct, v: m(d.commission.amount) })}</p> : <p className="muted">{t("adm.my.noCommission")}</p>}
          {d.goal ? (
            <>
              <div className="my-goal"><i style={{ width: `${pct}%` }} /></div>
              <p>{t("adm.my.goal", { done: m(d.goal.done), goal: m(d.goal.amount), left: m(d.goal.left) })}</p>
            </>
          ) : <p className="muted">{t("adm.my.noGoal")}</p>}
          <p className="muted">{t("adm.my.balance", { v: m(d.balance_due ?? 0) })}</p>
        </div>
      </div>

      <div className="my-grid">
        <div className="adm-card">
          <h3><Icon name="receipt" size={16} /> {t("adm.my.recent")}</h3>
          {!(d.recent || []).length ? <div className="adm-nodata">{t("adm.my.noRecent")}</div> : (
            <ul className="my-recent">
              {d.recent.map((r) => (
                <li key={r.id}>
                  <span className="my-recent-main"><b>{r.number}</b><small className="muted">{shortDate(r.created_at, lang)}</small></span>
                  <span className="my-recent-tags">
                    {r.status === "voided" && <span className="adm-chip bad">{t("adm.my.voided")}</span>}
                    {r.status !== "voided" && r.balance > 0 && <span className="adm-chip neutral">{t("adm.my.toCollect", { v: m(r.balance) })}</span>}
                    {r.status !== "voided" && r.delivered && <span className="adm-chip ok">{t("adm.my.delivered")}</span>}
                  </span>
                  <b className="my-recent-total">{m(r.total)}</b>
                </li>
              ))}
            </ul>
          )}
          {go && (d.recent || []).length > 0 && <button type="button" className="btn-xs" onClick={() => go("possales")}>{t("adm.my.seeAll")} <Icon name="arrowRight" size={12} /></button>}
        </div>

        <div className="adm-card">
          <h3><Icon name="hand" size={16} /> {t("adm.my.ready", { n: (d.ready || []).length })}</h3>
          {!(d.ready || []).length ? <div className="adm-nodata">{t("adm.my.noneReady")}</div> : (
            <ul className="pos-lines">
              {d.ready.map((r) => (
                <li key={r.id}>
                  <Icon name="hand" size={16} />
                  <span><b>{r.number}</b> · {t(`adm.my.stage.${r.stage}`)}{r.balance > 0 ? ` · ${t("adm.my.toCollect", { v: m(r.balance) })}` : ""}</span>
                  {go && <button type="button" className="btn-xs" onClick={() => go("possales")}>{t("adm.my.open")}</button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

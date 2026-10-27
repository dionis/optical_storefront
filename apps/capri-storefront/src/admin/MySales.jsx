// Dónde se usa: pestaña «Mis cifras» de /admin — el panel del vendedor (E8):
// hoy, semana y mes; comisión y meta; pedidos de sus clientes que ya volvieron
// del laboratorio para avisarles (HU-50, HU-52, HU-53). La lista de sus ventas
// con qué vendió, a quién y el saldo (HU-51) está en «Ventas de tienda».
import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { KpiCard } from "./charts.jsx";
import { money } from "./adminOrders.js";
import { adminFetch } from "./adminApi.js";

export default function MySales({ go }) {
  const { t, lang } = useLang();
  const [d, setD] = useState(null);
  const [state, setState] = useState("loading");
  useEffect(() => {
    adminFetch("/admin/sales-analytics/me").then((r) => { setD(r); setState("ok"); }).catch(() => setState("error"));
  }, []);
  const m = (v) => money(v, "usd", lang);
  if (state === "loading") return <div className="adm-section"><div className="adm-src-note loading">{t("adm.ord.loading")}</div></div>;
  if (state === "error" || !d) return <div className="adm-section"><div className="adm-demo-banner">{t("adm.err.pos.generic")}</div></div>;
  const block = (k, s) => (
    <div className="adm-card my-block" key={k}>
      <h3>{t(`adm.my.${k}`)}</h3>
      <div className="board-kpis">
        <KpiCard label={t("adm.board.kpi.count")} value={String(s.count)} icon={<Icon name="receipt" />} />
        <KpiCard label={t("adm.board.kpi.total")} value={m(s.total)} icon={<Icon name="dollar" />} />
        <KpiCard label={t("adm.board.kpi.avg")} value={m(s.avg_ticket)} icon={<Icon name="trendUp" />} />
      </div>
    </div>
  );
  const pct = d.goal ? Math.min(100, Math.round((d.goal.done / (d.goal.amount || 1)) * 100)) : 0;
  return (
    <div className="adm-section pos">
      <div className="adm-head-row"><h2>{t("adm.tab.mysales")}</h2>{d.seller_code && <span className="adm-team-tag code">{d.seller_code}</span>}</div>
      {block("today", d.today)}
      {block("week", d.week)}
      {block("month", d.month)}
      <div className="adm-card">
        <h3>{t("adm.my.goalTitle")}</h3>
        {d.commission ? <p>{t("adm.my.commission", { pct: d.commission.pct, v: m(d.commission.amount) })}</p> : <p className="muted">{t("adm.my.noCommission")}</p>}
        {d.goal ? (
          <>
            <div className="my-goal"><i style={{ width: `${pct}%` }} /></div>
            <p>{t("adm.my.goal", { done: m(d.goal.done), goal: m(d.goal.amount), left: m(d.goal.left) })}</p>
          </>
        ) : <p className="muted">{t("adm.my.noGoal")}</p>}
        <p className="muted">{t("adm.my.balance", { v: m(d.balance_due) })}</p>
      </div>
      <div className="adm-card">
        <h3>{t("adm.my.ready", { n: d.ready.length })}</h3>
        {d.ready.length === 0 ? <div className="adm-nodata">{t("adm.my.noneReady")}</div> : (
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
  );
}

// Dónde se usa: Ejecutivo → pestaña "Costos operacionales" — la misma foto que
// la de ventas pero mirando el dinero que sale: ingreso vs costo, margen y
// ganancia objetivo, reparto del ingreso por concepto (materiales, comisiones,
// porcentajes de operación), costo por día, costo por marca, por vendedor y
// últimos pedidos con su margen. Todo clicable y exportable. Backend:
// GET /admin/costing/summary (+ reglas para la ganancia objetivo).
import { useEffect, useMemo, useState } from "react";
import { KpiCard, LineChart, BarChart, DonutChart } from "./charts.jsx";
import { rangeFor } from "./analytics.js";
import { isDemoLogin } from "./adminAuth.js";
import { money as fmtMoney, shortDate } from "./adminOrders.js";
import { fetchCostSummary, marginTone } from "./adminCosting.js";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { Card, useChartHeight } from "./ui.jsx";
import { SellersMini } from "./Executive.jsx";

const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const pct = (v) => (v == null || Number.isNaN(v) ? "—" : `${Math.round(v)}%`);
const PALETTE = ["#0b2f66", "#0e5ad0", "#b8921e", "#d6123e", "#1e6b3a", "#6b4fa8", "#8a5a00", "#2f74ff", "#5b6472", "#c9a44a"];

/** Reparto del ingreso: barra apilada por concepto + ganancia (resto). */
export function AllocationBar({ byKind, revenue, profitTargetPct, lang, go }) {
  const { t } = useLang();
  const total = Number(revenue) || 0;
  const parts = (byKind || []).filter((k) => k.amount > 0);
  const cost = parts.reduce((a, k) => a + k.amount, 0);
  const profit = Math.max(0, total - cost);
  const segs = [...parts.map((k, i) => ({ key: k.key, label: k.label, amount: k.amount, color: PALETTE[(i + 1) % PALETTE.length] })), { key: "profit", label: t("adm.cost.profit"), amount: profit, color: "#1a9d5c" }];
  if (total <= 0) return <div className="adm-nodata">{t("adm.cost.noOrders")}</div>;
  const target = profitTargetPct != null ? (total * profitTargetPct) / 100 : null;
  return (
    <div className="alloc">
      <div className="alloc-bar" role="img" aria-label={t("adm.cost.allocation")}>
        {segs.map((s) => s.amount > 0 && (
          <button type="button" key={s.key} className="alloc-seg" style={{ width: `${(s.amount / total) * 100}%`, background: s.color }} title={`${s.label}: ${fmtMoney(s.amount, "usd", lang)} (${pct((s.amount / total) * 100)})`} onClick={() => go("costs", { sub: s.key === "profit" ? "profit" : "rules" })} />
        ))}
        {target != null && <i className="alloc-target" style={{ right: `${Math.min(100, (target / total) * 100)}%` }} title={t("adm.cost.targetLine", { pct: profitTargetPct })} />}
      </div>
      <ul className="alloc-legend">
        {segs.map((s) => (
          <li key={s.key}><button type="button" onClick={() => go("costs", { sub: s.key === "profit" ? "profit" : "rules" })}><i style={{ background: s.color }} /><span>{s.label}</span><b>{fmtMoney(s.amount, "usd", lang)}</b><em>{pct((s.amount / total) * 100)}</em></button></li>
        ))}
      </ul>
    </div>
  );
}

export default function ExecutiveCosts({ preset = "30d", go }) {
  const { t, lang } = useLang();
  const demo = isDemoLogin();
  const [data, setData] = useState(null);
  const [state, setState] = useState(demo ? "demo" : "loading");
  const H = useChartHeight(0.17, 110, 200);
  useEffect(() => {
    if (demo) return undefined;
    let on = true;
    setState("loading");
    fetchCostSummary({ from: ymd(rangeFor(preset).from) }).then((d) => { if (on) { setData(d); setState("ok"); } }).catch(() => { if (on) setState("error"); });
    return () => { on = false; };
  }, [preset, demo]);

  const tot = data?.totals || {};
  const byDay = data?.by_day || [];
  const costSeries = useMemo(() => byDay.map((d) => ({ label: d.date.slice(5), value: d.cost })), [byDay]);
  const marginSeries = useMemo(() => byDay.map((d) => ({ label: d.date.slice(5), value: d.margin })), [byDay]);
  const brandDonut = useMemo(() => (data?.by_brand || []).filter((b) => b.frame_cost > 0).map((b) => ({ label: b.name, value: Math.round(b.frame_cost * 100) / 100 })), [data]);
  const recent = (data?.orders || []).slice(0, 7);
  const incomplete = (data?.orders || []).filter((o) => o.undefined_costs > 0).length;
  const commissions = (data?.by_seller || []).reduce((a, s) => a + (s.commission || 0), 0);
  const gapTone = tot.profit_gap == null ? "" : tot.profit_gap >= 0 ? "good" : "bad";

  return (
    <div className="adm-exec">
      {state === "loading" && !data && <div className="adm-src-note loading">{t("adm.real.loading")}</div>}
      {state === "error" && <div className="adm-demo-banner">{t("adm.err.cost.loadFailed")}</div>}
      {demo && <div className="adm-demo-banner">{t("adm.sec.demoNote")}</div>}
      {data && (
        <div className="adm-exec-alerts">
          {incomplete > 0 ? <button type="button" className="exec-alert warn" onClick={() => go("costs", { sub: "rules" })}><Icon name="alert" size={14} />{t("adm.cost.alertIncomplete", { n: incomplete })}<Icon name="arrowRight" size={13} /></button>
            : <button type="button" className="exec-alert ok" onClick={() => go("costs", { sub: "profit" })}><Icon name="checkCircle" size={14} /> {t("adm.cost.allDefined")}</button>}
          {tot.profit_target_pct == null && <button type="button" className="exec-alert info" onClick={() => go("costs", { sub: "allocation" })}><Icon name="percent" size={14} />{t("adm.cost.noTarget")}<Icon name="arrowRight" size={13} /></button>}
          {tot.profit_target_pct != null && tot.profit_gap < 0 && <button type="button" className="exec-alert crit" onClick={() => go("costs", { sub: "allocation" })}><Icon name="trendDown" size={14} />{t("adm.cost.belowTarget", { pct: tot.profit_target_pct })}<Icon name="arrowRight" size={13} /></button>}
          {data.truncated && <span className="exec-alert info">{t("adm.real.truncated", { n: 300 })}</span>}
        </div>
      )}

      <div className="adm-kpis adm-exec-kpis">
        <KpiCard label={t("adm.cost.revenue")} value={fmtMoney(tot.revenue, "usd", lang)} icon={<Icon name="dollar" />} sub={t("adm.cost.ordersN", { n: tot.orders ?? 0 })} hint={t("adm.cost.h.revenue")} onClick={() => go("exec", { sub: "sales" })} />
        <KpiCard label={t("adm.cost.cost")} value={fmtMoney(tot.cost, "usd", lang)} icon={<Icon name="receipt" />} hint={t("adm.cost.h.cost")} onClick={() => go("costs", { sub: "rules" })} />
        <KpiCard label={t("adm.cost.margin")} value={fmtMoney(tot.margin, "usd", lang)} icon={<Icon name="trendUp" />} sub={pct(tot.margin_pct)} deltaGood={marginTone(tot.margin_pct) !== "bad"} hint={t("adm.cost.h.margin")} onClick={() => go("costs", { sub: "profit" })} />
        <KpiCard label={t("adm.cost.target")} value={tot.profit_target_pct == null ? "—" : fmtMoney(tot.profit_target_amount, "usd", lang)} icon={<Icon name="gauge" />} sub={tot.profit_target_pct == null ? t("adm.cost.noTargetShort") : t("adm.cost.gap", { v: fmtMoney(tot.profit_gap, "usd", lang) })} hint={t("adm.cost.h.target")} onClick={() => go("costs", { sub: "allocation" })} />
        <KpiCard label={t("adm.sel.commissions")} value={fmtMoney(commissions, "usd", lang)} icon={<Icon name="sellers" />} hint={t("adm.cost.h.commissions")} onClick={() => go("sellers")} />
        <KpiCard label={t("adm.cost.incomplete")} value={String(incomplete)} icon={<Icon name="alert" />} sub={t("adm.cost.incompleteHint")} hint={t("adm.cost.h.incomplete")} onClick={() => go("costs", { sub: incomplete ? "rules" : "profit" })} />
      </div>

      <div className="exec-grid cols-3-1">
        <Card icon="layers" title={t("adm.cost.allocation")} hint={t("adm.cost.allocationHint")} onGo={() => go("costs", { sub: "allocation" })} goLabel={t("adm.cost.tab.allocation")} name="reparto" csv={{ cols: [[t("adm.cost.line"), "label"], [t("adm.cost.amount"), "amount"]], rows: data?.by_kind || [] }}>
          <AllocationBar byKind={data?.by_kind} revenue={tot.revenue} profitTargetPct={tot.profit_target_pct} lang={lang} go={go} />
        </Card>
        <SellersMini preset={preset} go={go} lang={lang} showCommission />
      </div>

      <div className="exec-grid cols-2">
        <Card icon="receipt" title={t("adm.cost.costByDay")} hint={t("adm.cost.h.costByDay")} onGo={() => go("costs", { sub: "profit" })} goLabel={t("adm.cost.tab.profit")} name="costo-dia" csv={{ cols: [[t("adm.col.date"), "date"], [t("adm.cost.revenue"), "revenue"], [t("adm.cost.cost"), "cost"], [t("adm.cost.margin"), "margin"]], rows: byDay }}>
          <LineChart data={costSeries} valuePrefix="$" color="#d6123e" height={H} />
        </Card>
        <Card icon="trendUp" title={t("adm.cost.marginByDay")} hint={t("adm.cost.h.marginByDay")} onGo={() => go("costs", { sub: "profit" })} goLabel={t("adm.cost.tab.profit")} name="margen-dia" csv={{ cols: [[t("adm.col.date"), "date"], [t("adm.cost.margin"), "margin"]], rows: byDay }}>
          <BarChart data={marginSeries} color="#1a9d5c" height={H} />
        </Card>
      </div>

      <div className="exec-grid cols-1-2-1">
        <Card icon="tagIcon" title={t("adm.cost.byBrand")} hint={t("adm.cost.h.byBrand")} onGo={() => go("costs", { sub: "rules" })} goLabel={t("adm.cost.tab.rules")} name="costo-marca" csv={{ cols: [[t("adm.exec.brands"), "name"], [t("adm.kpi.orders"), "orders"], [t("adm.cost.revenue"), "revenue"], [t("adm.cost.frameCost"), "frame_cost"]], rows: data?.by_brand || [] }}>
          {brandDonut.length === 0 ? <div className="adm-empty compact" role="button" onClick={() => go("costs", { sub: "rules" })}><Icon name="glasses" size={26} /><b>{t("adm.cost.noBrandCost")}</b><p>{t("adm.cost.noBrandCostHint")}</p></div>
            : <DonutChart data={brandDonut} height={H} size={120} onSelect={() => go("costs", { sub: "rules" })} />}
        </Card>
        <Card icon="clock" title={t("adm.cost.recentMargin")} hint={t("adm.cost.h.recent")} onGo={() => go("costs", { sub: "profit" })} goLabel={t("adm.cost.tab.profit")} name="pedidos-margen">
          {recent.length === 0 ? <div className="adm-nodata">{t("adm.cost.noOrders")}</div> : (
            <div className="adm-table-wrap">
              <table className="adm-table exec-recent">
                <tbody>
                  {recent.map((o) => (
                    <tr key={o.id} className="ord-row" onClick={() => go("costs", { sub: "profit", order: o.id })} title={t("adm.cost.openSheet")}>
                      <td><b>#{o.display_id}</b>{o.undefined_costs > 0 && <span className="adm-chip warn" style={{ marginLeft: 6, fontSize: 10 }}><Icon name="alert" size={10} /></span>}</td>
                      <td>{shortDate(o.created_at, lang)}</td>
                      <td>{o.customer_name || "—"}</td>
                      <td className="r num">{fmtMoney(o.revenue, "usd", lang)}</td>
                      <td className="r num" style={{ color: "var(--adm-red)" }}>−{fmtMoney(o.cost_total, "usd", lang)}</td>
                      <td className="r"><span className={`margin-pct ${marginTone(o.margin_pct)}`}>{fmtMoney(o.margin, "usd", lang)} · {pct(o.margin_pct)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card icon="clipboard" title={t("adm.cost.topConcepts")} hint={t("adm.cost.h.topConcepts")} onGo={() => go("costs", { sub: "rules" })} goLabel={t("adm.cost.tab.rules")} name="conceptos">
          {(data?.by_kind || []).length === 0 ? <div className="adm-nodata">{t("adm.chart.noData")}</div> : (
            <div className="adm-thumbbars tight">
              {data.by_kind.slice(0, 6).map((k) => {
                const max = Math.max(...data.by_kind.map((x) => x.amount), 1);
                return (
                  <div className="adm-tb-row clickable" key={k.key} onClick={() => go("costs", { sub: k.kind === "order_percent" ? "allocation" : "rules" })}>
                    <div className="adm-tb-main">
                      <div className="adm-tb-top"><span className="adm-tb-name">{k.label}</span><b>{fmtMoney(k.amount, "usd", lang)}</b></div>
                      <div className="adm-tb-track"><div className="adm-tb-fill" style={{ width: `${(k.amount / max) * 100}%` }} /></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

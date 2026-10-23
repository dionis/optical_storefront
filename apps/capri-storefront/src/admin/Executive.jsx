// Dónde se usa: Ejecutivo → pestaña "Ventas" — la foto completa del negocio en
// UNA vista: alertas, KPI, pipeline por etapa, ventas por vendedor, tendencia
// diaria, mezcla por marca, últimos pedidos y salud del catálogo. Cada tarjeta
// y cada cifra es clicable: ayuda, ir a la pantalla relacionada o exportar.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { KpiCard, LineChart, BarChart, DonutChart } from "./charts.jsx";
import { summarize, summarizeOrders, rangeFor, subscribe as onAnalytics } from "./analytics.js";
import { fetchBoardWindow, buildCatalogIndex, toAnalyticsOrder } from "./realAnalytics.js";
import { isDemoLogin } from "./adminAuth.js";
import { STAGE_BY_KEY, TERMINAL_BY_KEY, money as fmtMoney, shortDate, orderLabel } from "./adminOrders.js";
import { fetchDiscontinued } from "./catalogAdmin.js";
import { fetchSellerStats } from "./adminSellers.js";
import { useCatalog } from "../data/catalogStore.js";
import { BRANDS } from "../data/brands.js";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { Card, useChartHeight } from "./ui.jsx";
import { SOURCE_ICON } from "./sellerShared.jsx";

export const STAGE_ICON = { confirmed: "receipt", in_lab: "lab", shipped: "box", in_transit: "truck", delivered: "checkCircle", payment_pending: "clock", canceled: "alert", refunded: "undo" };
const BRAND_LOGO_BY_NAME = Object.fromEntries(BRANDS.map((b) => [b.name, b.logo]));
const BRAND_SLUG_BY_NAME = Object.fromEntries(BRANDS.map((b) => [b.name, b.slug]));
const int = (n) => (Number(n) || 0).toLocaleString("es");
const usd = (n) => "$" + (Number(n) || 0).toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const daysSince = (iso) => (Date.now() - new Date(iso).getTime()) / 864e5;
const demoSnap = () => { try { return (localStorage.getItem("oer_orders") || "").length; } catch { return 0; } };

/** Ventas por vendedor (top 5) + por red social, reutilizado en Ventas y Costos. */
export function SellersMini({ preset, go, lang, showCommission = false }) {
  const { t } = useLang();
  const [stats, setStats] = useState(null);
  useEffect(() => {
    if (isDemoLogin()) return undefined;
    let on = true;
    fetchSellerStats({ from: ymd(rangeFor(preset).from) }).then((s) => { if (on) setStats(s); }).catch(() => {});
    return () => { on = false; };
  }, [preset]);
  const rows = (stats?.sellers || []).filter((s) => s.orders > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const max = Math.max(1, ...rows.map((r) => r.revenue));
  const sources = (stats?.sources || []).slice(0, 5);
  return (
    <Card icon="sellers" title={t("adm.exec.bySeller")} hint={t("adm.exec.bySellerHint")} onGo={() => go("sellers")} goLabel={t("adm.tab.sellers")} name="vendedores"
      csv={{ cols: [[t("adm.sel.name"), "name"], [t("adm.sel.code"), "code"], [t("adm.kpi.orders"), "orders"], [t("adm.sel.sales"), "revenue"], [t("adm.sel.commissions"), "commission"]], rows: stats?.sellers || [] }}>
      {!stats ? <div className="adm-skel" style={{ height: 80 }} /> : rows.length === 0 ? (
        <div className="adm-empty compact" onClick={() => go("sellers")} role="button"><Icon name="megaphone" size={26} /><b>{t("adm.exec.noSellerSales")}</b><p>{t("adm.exec.noSellerSalesHint", { n: stats.unattributed?.orders ?? 0 })}</p></div>
      ) : (
        <div className="adm-thumbbars tight">
          {rows.map((r) => (
            <div className="adm-tb-row clickable" key={r.id} onClick={() => go("orders", { seller: r.code })} title={t("adm.exec.goOrdersSeller", { code: r.code })}>
              <div className="adm-tb-thumb sm"><span className="sel-avatar mini">{String(r.name || "?").slice(0, 2).toUpperCase()}</span></div>
              <div className="adm-tb-main">
                <div className="adm-tb-top"><span className="adm-tb-name">{r.name} <small className="muted">· {r.orders} {t("adm.exec.ordersShort")}</small></span><b>{showCommission ? fmtMoney(r.commission, "usd", lang) : fmtMoney(r.revenue, "usd", lang)}</b></div>
                <div className="adm-tb-track"><div className="adm-tb-fill" style={{ width: `${(r.revenue / max) * 100}%` }} /></div>
              </div>
            </div>
          ))}
          {stats.unattributed?.orders > 0 && <small className="muted">{t("adm.sel.unattributed", { n: stats.unattributed.orders })} · {fmtMoney(stats.unattributed.revenue, "usd", lang)}</small>}
        </div>
      )}
      {sources.length > 0 && (
        <div className="exec-sources">
          {sources.map((s) => <button type="button" className="adm-chip neutral" key={s.source} onClick={() => go("sellers")} title={t("adm.exec.sourceTitle")}><Icon name={SOURCE_ICON[s.source] || "link"} size={12} />{t(`adm.src.${s.source}`) === `adm.src.${s.source}` ? s.source : t(`adm.src.${s.source}`)} · {s.orders}</button>)}
        </div>
      )}
    </Card>
  );
}

export default function Executive({ preset = "30d", go }) {
  const { t, lang } = useLang();
  const demo = isDemoLogin();
  const snap = useSyncExternalStore(onAnalytics, demoSnap, () => 0);
  const { products, cases } = useCatalog();
  const [win, setWin] = useState(null);
  const [state, setState] = useState(demo ? "demo" : "loading");
  const [discontinued, setDiscontinued] = useState(null);

  useEffect(() => {
    if (demo) return undefined;
    let on = true;
    setState("loading");
    fetchBoardWindow(rangeFor(preset)).then((w) => { if (on) { setWin(w); setState("real"); } }).catch(() => { if (on) setState("error"); });
    return () => { on = false; };
  }, [preset, demo]);
  useEffect(() => {
    if (demo) return undefined;
    let on = true;
    fetchDiscontinued().then((d) => { if (on) setDiscontinued(d.length); }).catch(() => {});
    return () => { on = false; };
  }, [demo]);

  const catalogIndex = useMemo(() => buildCatalogIndex(products, cases), [products, cases]);
  const range = useMemo(() => rangeFor(preset), [preset]);
  const { s, boardOrders } = useMemo(() => {
    if (state === "real" && win) {
      const board = win.orders || [];
      const revenue = board.filter((o) => !o.terminal).map((o) => toAnalyticsOrder(o, catalogIndex));
      return { s: summarizeOrders(revenue, range), boardOrders: board };
    }
    return { s: summarize(range), boardOrders: [] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, win, catalogIndex, preset, snap]);

  const ops = useMemo(() => {
    const by = { confirmed: { n: 0, v: 0 }, in_lab: { n: 0, v: 0 }, shipped: { n: 0, v: 0 }, in_transit: { n: 0, v: 0 }, delivered: { n: 0, v: 0 } };
    let pendingPay = 0, canceled = 0, stuck = 0, todayN = 0, todayV = 0;
    for (const o of boardOrders) {
      if (o.terminal === "payment_pending") { pendingPay += 1; continue; }
      if (o.terminal === "canceled" || o.terminal === "refunded") { canceled += 1; continue; }
      if (by[o.stage]) { by[o.stage].n += 1; by[o.stage].v += o.total || 0; }
      if ((o.stage === "confirmed" || o.stage === "in_lab") && daysSince(o.created_at) > 7) stuck += 1;
      if (new Date(o.created_at).toDateString() === new Date().toDateString()) { todayN += 1; todayV += o.total || 0; }
    }
    return { by, pendingPay, canceled, stuck, todayN, todayV };
  }, [boardOrders]);

  const toPrepare = ops.by.confirmed.n + ops.by.in_lab.n;
  const inDelivery = ops.by.shipped.n + ops.by.in_transit.n;
  const maxStage = Math.max(1, ...Object.values(ops.by).map((x) => x.n));
  const recent = state === "real" ? boardOrders.slice(0, 7) : [];
  const alerts = [];
  if (state === "real") {
    if (ops.pendingPay) alerts.push({ tone: "warn", txt: t("adm.exec.alertPay", { n: int(ops.pendingPay) }), go: () => go("orders", { terminal: "payment_pending" }) });
    if (ops.stuck) alerts.push({ tone: "crit", txt: t("adm.exec.alertStuck", { n: int(ops.stuck) }), go: () => go("orders", { stage: "in_lab" }) });
    if (win?.truncated) alerts.push({ tone: "info", txt: t("adm.real.truncated", { n: int(win.scanLimit) }) });
  }
  const brandSlug = (label) => BRAND_SLUG_BY_NAME[label] || String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const H = useChartHeight(0.17, 110, 200);

  return (
    <div className="adm-exec">
      {state === "loading" && <div className="adm-src-note loading">{t("adm.real.loading")}</div>}
      {state === "error" && <div className="adm-demo-banner">{t("adm.real.loadFailed")}</div>}
      {demo && <div className="adm-demo-banner">{t("adm.exec.demoNote")}</div>}
      {state === "real" && (
        <div className="adm-exec-alerts">
          {alerts.length === 0
            ? <button type="button" className="exec-alert ok" onClick={() => go("orders")}><Icon name="checkCircle" size={14} /> {t("adm.exec.allClear")}</button>
            : alerts.map((a, i) => <button type="button" key={i} className={`exec-alert ${a.tone}`} onClick={a.go}>{a.txt}{a.go && <Icon name="arrowRight" size={13} />}</button>)}
        </div>
      )}

      <div className="adm-kpis adm-exec-kpis">
        <KpiCard label={t("adm.kpi.revenue")} value={usd(s.kpis.revenue)} icon={<Icon name="dollar" />} sub={t("adm.kpi.unitsSub", { n: int(s.kpis.units) })} hint={t("adm.kpi.h.revenue")} onClick={() => go("exec", { sub: "detail" })} />
        <KpiCard label={t("adm.kpi.orders")} value={int(s.kpis.ordersCount)} icon={<Icon name="receipt" />} hint={t("adm.kpi.h.orders")} onClick={() => go("orders", { preset })} />
        <KpiCard label={t("adm.kpi.aov")} value={usd(s.kpis.aov)} icon={<Icon name="trendUp" />} hint={t("adm.kpi.h.aov")} onClick={() => go("exec", { sub: "overview" })} />
        <KpiCard label={t("adm.exec.today")} value={`${int(ops.todayN)} · ${usd(ops.todayV)}`} icon={<Icon name="calendar" />} hint={t("adm.kpi.h.today")} onClick={() => go("orders", { preset: "today" })} />
        <KpiCard label={t("adm.exec.toPrepare")} value={int(toPrepare)} icon={<Icon name="lab" />} sub={t("adm.exec.toPrepareSub")} hint={t("adm.kpi.h.toPrepare")} onClick={() => go("orders", { stage: "in_lab" })} />
        <KpiCard label={t("adm.exec.inDelivery")} value={int(inDelivery)} icon={<Icon name="truck" />} hint={t("adm.kpi.h.inDelivery")} onClick={() => go("orders", { stage: "in_transit" })} />
      </div>

      <div className="exec-grid cols-3-1">
        <Card icon="layers" title={t("adm.exec.pipeline")} hint={t("adm.exec.pipelineHint")} onGo={() => go("orders")} goLabel={t("adm.tab.orders")} name="pipeline">
          {state !== "real" ? <div className="adm-nodata">{t("adm.sales.noneInRange")}</div> : (
            <div className="exec-pipe">
              {Object.entries(ops.by).map(([key, v]) => {
                const st = STAGE_BY_KEY[key];
                return (
                  <button type="button" key={key} className="exec-pipe-col" onClick={() => go("orders", { stage: key })} title={t("adm.exec.goOrdersStage", { stage: st ? t(st.label) : key })}>
                    <span className="exec-pipe-n">{int(v.n)}</span>
                    <span className="exec-pipe-bar"><i style={{ height: `${Math.max(8, (v.n / maxStage) * 100)}%` }} /></span>
                    <span className="exec-pipe-k"><Icon name={STAGE_ICON[key] || "box"} size={13} />{st ? t(st.label) : key}</span>
                    <span className="exec-pipe-v">{usd(v.v)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
        <SellersMini preset={preset} go={go} lang={lang} />
      </div>

      <div className="exec-grid cols-2">
        <Card icon="sales" title={t("adm.chart.salesByDay")} hint={t("adm.chart.h.salesByDay")} onGo={() => go("exec", { sub: "detail" })} goLabel={t("adm.tab.sales")} name="ventas-dia" csv={{ cols: [[t("adm.col.date"), "label"], [t("adm.kpi.revenue"), "value"]], rows: s.salesSeries }}>
          <LineChart data={s.salesSeries} valuePrefix="$" color="#0b2f66" height={H} />
        </Card>
        <Card icon="orders" title={t("adm.sales.ordersByDay")} hint={t("adm.chart.h.ordersByDay")} onGo={() => go("orders", { preset })} goLabel={t("adm.tab.orders")} name="pedidos-dia" csv={{ cols: [[t("adm.col.date"), "label"], [t("adm.kpi.orders"), "value"]], rows: s.ordersSeries }}>
          <BarChart data={s.ordersSeries} color="#0e5ad0" height={H} />
        </Card>
      </div>

      <div className="exec-grid cols-1-2-1">
        <Card icon="tagIcon" title={t("adm.chart.salesByBrand")} hint={t("adm.chart.h.salesByBrand")} onGo={() => go("products")} goLabel={t("adm.tab.products")} name="ventas-marca" csv={{ cols: [[t("adm.exec.brands"), "label"], [t("adm.kpi.revenue"), "value"]], rows: s.topBrands }}>
          <DonutChart data={s.topBrands} iconByLabel={BRAND_LOGO_BY_NAME} height={H} size={120} onSelect={(label) => go("costs", { sub: "prices", q: label, brand: brandSlug(label) })} />
        </Card>
        <Card icon="clock" title={t("adm.exec.recent")} hint={t("adm.exec.recentHint")} onGo={() => go("orders")} goLabel={t("adm.tab.orders")} name="ultimos-pedidos">
          {recent.length === 0 ? <div className="adm-nodata">{t("adm.sales.noneInRange")}</div> : (
            <div className="adm-table-wrap">
              <table className="adm-table exec-recent">
                <tbody>
                  {recent.map((o) => {
                    const st = o.terminal ? TERMINAL_BY_KEY[o.terminal] : STAGE_BY_KEY[o.stage];
                    return (
                      <tr key={o.id} className="ord-row" onClick={() => go("orders", { order: o.id })} title={t("adm.exec.openOrder")}>
                        <td><b>{orderLabel(o)}</b></td>
                        <td>{shortDate(o.created_at, lang)}</td>
                        <td>{o.customer?.name || o.email || "—"}{o.seller_code && <span className="adm-chip gold" style={{ marginLeft: 6, fontSize: 10 }}>{o.seller_code}</span>}</td>
                        <td><span className={`exec-chip ${o.terminal ? "term" : o.stage}`}><Icon name={STAGE_ICON[o.terminal || o.stage] || "box"} size={12} />{st ? t(st.label) : o.stage}</span></td>
                        <td className="r"><b>{fmtMoney(o.total, o.currency_code, lang)}</b></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card icon="glasses" title={t("adm.exec.catalogHealth")} hint={t("adm.exec.catalogHint")} onGo={() => go("products")} goLabel={t("adm.tab.products")} name="catalogo">
          <div className="exec-mini-kpis">
            <button type="button" onClick={() => go("products")}><small>{t("adm.exec.activeFrames")}</small><b>{int(products.length)}</b></button>
            <button type="button" onClick={() => go("products")}><small>{t("adm.prod.cases")}</small><b>{int(cases.length)}</b></button>
            <button type="button" onClick={() => go("products")}><small>{t("adm.exec.discontinued")}</small><b>{discontinued == null ? "—" : int(discontinued)}</b></button>
            <button type="button" onClick={() => go("products")}><small>{t("adm.exec.brands")}</small><b>{int(new Set(products.map((p) => p.brand)).size)}</b></button>
          </div>
        </Card>
      </div>
    </div>
  );
}

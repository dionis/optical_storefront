// Dónde se usa: pestaña Ejecutivo de /admin — KPIs, series por día, mezcla por marca y alertas operativas.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { KpiCard, LineChart, BarChart, DonutChart } from "./charts.jsx";
import { summarize, summarizeOrders, rangeFor, subscribe as onAnalytics } from "./analytics.js";
import { fetchBoardWindow, buildCatalogIndex, toAnalyticsOrder } from "./realAnalytics.js";
import { isDemoLogin } from "./adminAuth.js";
import { STAGE_BY_KEY, TERMINAL_BY_KEY, money as fmtMoney, shortDate, orderLabel } from "./adminOrders.js";
import { fetchDiscontinued } from "./catalogAdmin.js";
import { useCatalog } from "../data/catalogStore.js";
import { BRANDS } from "../data/brands.js";
import { useLang } from "../i18n/LanguageContext.jsx";

const BRAND_LOGO_BY_NAME = Object.fromEntries(BRANDS.map((b) => [b.name, b.logo]));
const int = (n) => (Number(n) || 0).toLocaleString("es");
const usd = (n) => "$" + (Number(n) || 0).toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Horas desde un ISO, para detectar pedidos atascados sin salir. */
const daysSince = (iso) => (Date.now() - new Date(iso).getTime()) / 864e5;

/**
 * DASHBOARD EJECUTIVO — la foto completa del negocio en una pantalla:
 * ingresos/pedidos del período, pipeline operativo por etapa, alertas que
 * piden acción (pagos pendientes, pedidos atascados), tendencia diaria, tops
 * por producto/marca, últimos pedidos y salud del catálogo. Todo con pedidos
 * REALES del order board; con el login demo cae a la demo y lo dice.
 */
const demoSnap = () => {
  try { return (localStorage.getItem("oer_orders") || "").length; } catch { return 0; }
};

export default function Executive({ preset = "30d", setPreset, onGoOrders }) {
  const { t, lang } = useLang();
  const demo = isDemoLogin();
  // Con el login demo, re-render al sembrarse/borrarse la demo (si no, los KPI
  // se quedan en $0 hasta cambiar de pestaña).
  const snap = useSyncExternalStore(onAnalytics, demoSnap, () => 0);
  const { products, cases } = useCatalog();
  const [win, setWin] = useState(null);           // ventana real {orders,truncated,scanLimit}
  const [state, setState] = useState(demo ? "demo" : "loading");
  const [discontinued, setDiscontinued] = useState(null);

  useEffect(() => {
    if (demo) return undefined;
    let on = true;
    setState("loading");
    fetchBoardWindow(rangeFor(preset))
      .then((w) => { if (on) { setWin(w); setState("real"); } })
      .catch(() => { if (on) setState("error"); });
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

  // Agregado del período (misma maquinaria que Resumen/Ventas).
  const { s, boardOrders } = useMemo(() => {
    if (state === "real" && win) {
      const board = win.orders || [];
      const revenue = board.filter((o) => !o.terminal).map((o) => toAnalyticsOrder(o, catalogIndex));
      return { s: summarizeOrders(revenue, range), boardOrders: board };
    }
    return { s: summarize(range), boardOrders: [] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, win, catalogIndex, preset, snap]);

  // Pipeline + alertas: solo con pedidos reales (el demo no tiene etapas).
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
  const recent = (state === "real" ? boardOrders.slice(0, 8) : []);
  const alerts = [];
  if (state === "real") {
    if (ops.pendingPay) alerts.push({ tone: "warn", txt: t("adm.exec.alertPay", { n: int(ops.pendingPay) }) });
    if (ops.stuck) alerts.push({ tone: "crit", txt: t("adm.exec.alertStuck", { n: int(ops.stuck) }) });
    if (win?.truncated) alerts.push({ tone: "info", txt: t("adm.real.truncated", { n: int(win.scanLimit) }) });
  }

  return (
    <div className="adm-section adm-exec">
      <div className="adm-head-row">
        <h2>{t("adm.exec.title")}</h2>
        <div className="adm-range">
          {["today", "7d", "30d", "90d"].map((k) => (
            <button key={k} className={preset === k ? "on" : ""} onClick={() => setPreset(k)}>{t(`adm.range.${k}`)}</button>
          ))}
        </div>
      </div>

      {state === "loading" && <div className="adm-src-note loading">{t("adm.real.loading")}</div>}
      {state === "error" && <div className="adm-demo-banner">{t("adm.real.loadFailed")}</div>}
      {demo && <div className="adm-demo-banner">{t("adm.exec.demoNote")}</div>}

      {/* Alertas accionables primero: para eso es un dashboard ejecutivo. */}
      {state === "real" && (
        <div className="adm-exec-alerts">
          {alerts.length === 0
            ? <span className="exec-alert ok">✓ {t("adm.exec.allClear")}</span>
            : alerts.map((a, i) => <span key={i} className={`exec-alert ${a.tone}`}>{a.txt}</span>)}
        </div>
      )}

      <div className="adm-kpis adm-exec-kpis">
        <KpiCard label={t("adm.kpi.revenue")} value={usd(s.kpis.revenue)} icon="💵" sub={t("adm.kpi.unitsSub", { n: int(s.kpis.units) })} />
        <KpiCard label={t("adm.kpi.orders")} value={int(s.kpis.ordersCount)} icon="🧾" />
        <KpiCard label={t("adm.kpi.aov")} value={usd(s.kpis.aov)} icon="📈" />
        <KpiCard label={t("adm.exec.today")} value={`${int(ops.todayN)} · ${usd(ops.todayV)}`} icon="🗓️" />
        <KpiCard label={t("adm.exec.toPrepare")} value={int(toPrepare)} icon="🛠️" sub={t("adm.exec.toPrepareSub")} />
        <KpiCard label={t("adm.exec.inDelivery")} value={int(inDelivery)} icon="🚚" />
      </div>

      {/* Pipeline operativo por etapa */}
      {state === "real" && (
        <div className="adm-card">
          <h3>{t("adm.exec.pipeline")}</h3>
          <div className="exec-pipe">
            {Object.entries(ops.by).map(([key, v]) => {
              const st = STAGE_BY_KEY[key];
              return (
                <button type="button" key={key} className="exec-pipe-col" onClick={onGoOrders} title={t("adm.exec.goOrders")}>
                  <span className="exec-pipe-n">{int(v.n)}</span>
                  <span className="exec-pipe-bar"><i style={{ height: `${Math.max(8, (v.n / maxStage) * 100)}%` }} /></span>
                  <span className="exec-pipe-k">{st ? `${st.icon} ${t(st.label)}` : key}</span>
                  <span className="exec-pipe-v">{usd(v.v)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="adm-grid-2">
        <div className="adm-card"><h3>{t("adm.chart.salesByDay")}</h3><LineChart data={s.salesSeries} valuePrefix="$" color="#01326b" /></div>
        <div className="adm-card"><h3>{t("adm.sales.ordersByDay")}</h3><BarChart data={s.ordersSeries} color="#0a4a9e" /></div>
      </div>

      <div className="adm-grid-2">
        <div className="adm-card"><h3>{t("adm.chart.salesByBrand")}</h3><DonutChart data={s.topBrands} iconByLabel={BRAND_LOGO_BY_NAME} /></div>
        <div className="adm-card">
          <h3>{t("adm.exec.recent")}</h3>
          {recent.length === 0 ? <div className="adm-nodata">{t("adm.sales.noneInRange")}</div> : (
            <div className="adm-table-wrap">
              <table className="adm-table exec-recent">
                <tbody>
                  {recent.map((o) => {
                    const st = o.terminal ? TERMINAL_BY_KEY[o.terminal] : STAGE_BY_KEY[o.stage];
                    return (
                      <tr key={o.id}>
                        <td><b>{orderLabel(o)}</b></td>
                        <td>{shortDate(o.created_at, lang)}</td>
                        <td>{o.customer?.name || o.email || "—"}</td>
                        <td><span className={`exec-chip ${o.terminal ? "term" : o.stage}`}>{st ? `${st.icon} ${t(st.label)}` : o.stage}</span></td>
                        <td className="r"><b>{fmtMoney(o.total, o.currency_code, lang)}</b></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Salud del catálogo */}
      <div className="adm-kpis adm-exec-cat">
        <KpiCard label={t("adm.exec.activeFrames")} value={int(products.length)} icon="👓" />
        <KpiCard label={t("adm.prod.cases")} value={int(cases.length)} icon="🧰" />
        <KpiCard label={t("adm.exec.discontinued")} value={discontinued == null ? "—" : int(discontinued)} icon="📦" />
        <KpiCard label={t("adm.exec.brands")} value={int(new Set(products.map((p) => p.brand)).size)} icon="🏷️" />
      </div>
    </div>
  );
}

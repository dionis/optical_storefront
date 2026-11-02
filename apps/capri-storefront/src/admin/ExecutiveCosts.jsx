// Dónde se usa: Ejecutivo → acordeón «Costos y margen» — la misma foto que
// la de ventas pero mirando el dinero que sale, escrita para quien nunca ha
// leído un estado de resultados: seis KPI de una palabra (Pagado · Neto ·
// Costo · Ganancia · Objetivo · Incompletas), cada uno con su guía («?»,
// HelpTip, temas `cost.*`), un glosario plegado con qué incluye cada costo,
// el reparto del ingreso (barra + detalle plegado), ventas por vendedor con
// sus redes, UNA gráfica «Ventas vs costo por día» con el margen sobre cada
// par de barras, y abajo costo por marca, últimos pedidos y en qué se va el
// costo. Todo clicable y exportable. Backend:
// GET /admin/costing/summary?from&to&store (+ reglas para la ganancia objetivo).
//
//   <ExecutiveCosts range={{ from: Date, to: Date }} store="all" | "web" | id go={go}
//     onSeller={(code) => …}                 clic en un vendedor (abre su panel; lo pone quien monta)
//     channels={(seller) => <SellerChannels by_source={seller.by_source} compact />} />
//
// `channels` (render prop, opcional) pinta las redes de un vendedor; recibe la
// fila `{ code, name, orders, revenue, cost, margin, commission, by_source }`
// con `by_source = [{ source, orders, revenue }]`. Sin él, se pintan aquí los
// iconos de cada red con su número de ventas.
import { useEffect, useMemo, useRef, useState } from "react";
import { KpiCard, DonutChart, CompareBarChart } from "./charts.jsx";
import { rangeFor } from "./analytics.js";
import { isDemoLogin } from "./adminAuth.js";
import { money as fmtMoney, shortDate } from "./adminOrders.js";
import { fetchCostSummary, marginTone } from "./adminCosting.js";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import Accordion from "./Accordion.jsx";
import HelpTip from "./HelpTip.jsx";
import { SOURCE_ICON } from "./sellerShared.jsx";
import { Card, ExportMenu, useChartHeight } from "./ui.jsx";
import "./ex-costs.css";

// Día local (toISOString correría el día cerca de medianoche).
const ymd = (d) => { const x = new Date(d); const p = (n) => String(n).padStart(2, "0"); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; };
const pct = (v) => (v == null || Number.isNaN(v) ? "—" : `${Math.round(v)}%`);
/** «31/10» / «10/31»: día y mes, para una columna de 46 px (la fecha completa va en el title). */
const dayMonth = (v, lang) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(lang === "en" ? "en-US" : "es", { day: "2-digit", month: "2-digit" }); };
const pct1 = (v) => (v == null || Number.isNaN(v) ? "—" : `${(Math.round(v * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`);

/** Grupo de una partida por su `kind` (para colorear el reparto). */
export function groupOfKind(kind, key = "") {
  if (kind === "shipping" || kind === "tax" || kind === "payment_fixed" || key === "order_percent:payment_fee" || key === "payment_fee") return "deduction";
  if (kind === "seller_commission" || kind === "seller") return "seller";
  if (kind === "order_percent") return "percent";
  if (kind === "manual") return "manual";
  return "material";
}
// Colores por grupo (los mismos en claro y, aclarados por ex-costs.css, en oscuro).
const GROUP_COLOR = { deduction: "var(--exc-g-deduction, #8a93a2)", material: "var(--exc-g-material, #0b2f66)", percent: "var(--exc-g-percent, #b8921e)", seller: "var(--exc-g-seller, #6b4fa8)", manual: "var(--exc-g-manual, #0e5ad0)", profit: "var(--exc-g-profit, #1a9d5c)" };
const GROUP_ORDER = ["deduction", "material", "percent", "seller", "manual"];
/** Glosario: grupo → tema de ayuda, icono y pantalla donde se edita. */
const GLOSSARY = [
  { g: "deduction", topic: "cost.deductions", icon: "truck", sub: "rules" },
  { g: "material", topic: "cost.materials", icon: "glasses", sub: "rules" },
  { g: "percent", topic: "cost.percent", icon: "percent", sub: "allocation" },
  { g: "seller", topic: "cost.commission", icon: "sellers", sub: "profit" },
  { g: "manual", topic: "cost.cost", icon: "edit", sub: "profit" },
  { g: "profit", topic: "cost.target", icon: "trendUp", sub: "allocation" },
];
/** Redes que se muestran siempre, en este orden; las demás solo si tienen ventas. */
const CHANNELS = ["whatsapp", "instagram", "tiktok", "facebook", "link"];

/**
 * Reparto del dinero de una venta (o del período): primero lo que se descuenta
 * (envío, impuestos, Stripe), luego materiales, partidas por porcentaje y
 * comisión del vendedor; lo que queda es la ganancia. La marca ◆ señala dónde
 * debería empezar la ganancia para cumplir el objetivo (30 % del neto).
 * `compact` quita la lista de conceptos; `detail` la mete en un acordeón plegado.
 */
export function AllocationBar({ byKind, revenue, targetAmount, lang, go, compact = false, detail = false }) {
  const { t } = useLang();
  const total = Number(revenue) || 0;
  const parts = (byKind || []).filter((k) => k.amount > 0).map((k) => ({ ...k, group: k.group || groupOfKind(k.kind, k.key) }))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  const cost = parts.reduce((a, k) => a + k.amount, 0);
  const profit = total - cost;
  const segs = [...parts.map((k, i) => ({ key: `${k.key || k.label}-${i}`, label: k.label, amount: k.amount, group: k.group, color: GROUP_COLOR[k.group] })), { key: "profit", label: t("adm.cost.profit"), amount: Math.max(0, profit), group: "profit", color: GROUP_COLOR.profit }];
  if (total <= 0) return <div className="adm-nodata">{t("adm.cost.noOrders")}</div>;
  const target = targetAmount != null && targetAmount > 0 ? targetAmount : null;
  const goTo = (g) => go("costs", { sub: g === "percent" || g === "profit" ? "allocation" : g === "seller" ? "profit" : "rules" });
  const legend = segs.filter((s) => s.amount > 0 || s.group === "profit");
  const rows = detail ? [...legend].sort((a, b) => b.amount - a.amount) : legend;
  return (
    <div className="alloc">
      <div className="alloc-bar" role="img" aria-label={t("adm.cost.allocation")}>
        {segs.map((s) => s.amount > 0 && (
          <button type="button" key={s.key} className={`alloc-seg g-${s.group}`} style={{ width: `${(s.amount / total) * 100}%`, background: s.color }} title={`${s.label}: ${fmtMoney(s.amount, "usd", lang)} (${pct((s.amount / total) * 100)})`} onClick={() => goTo(s.group)} />
        ))}
        {profit < 0 && <span className="alloc-neg" title={t("adm.cost.lossTitle", { v: fmtMoney(-profit, "usd", lang) })}>−{fmtMoney(-profit, "usd", lang)}</span>}
        {target != null && <i className="alloc-target" style={{ right: `${Math.min(100, Math.max(0, (target / total) * 100))}%` }} title={t("adm.cost.targetMark", { v: fmtMoney(target, "usd", lang) })} />}
      </div>
      <div className="alloc-groups">
        {["deduction", "material", "percent", "seller", "manual", "profit"].map((g) => {
          const amt = g === "profit" ? profit : parts.filter((p) => p.group === g).reduce((a, p) => a + p.amount, 0);
          if (g !== "profit" && amt <= 0) return null;
          return <button type="button" key={g} className={`adm-chip g-${g}`} onClick={() => goTo(g)}><i style={{ background: GROUP_COLOR[g] }} />{t(`adm.cost.group.${g}`)} <b>{fmtMoney(amt, "usd", lang)}</b> <em>{pct((amt / total) * 100)}</em></button>;
        })}
      </div>
      {!compact && !detail && (
        <ul className="alloc-legend">
          {legend.map((s) => (
            <li key={s.key}><button type="button" onClick={() => goTo(s.group)}><i style={{ background: s.color }} /><span>{s.label}</span><b>{fmtMoney(s.amount, "usd", lang)}</b><em>{pct((s.amount / total) * 100)}</em></button></li>
          ))}
        </ul>
      )}
      {detail && (
        <Accordion id="cost-split-detail" icon="clipboard" title={t("adm.ecost.split.detail")} subtitle={t("adm.ecost.split.detailSub", { n: rows.length })} className="exc-acc" bodyClassName="exc-acc-body">
          <table className="adm-table exc-split">
            <thead><tr><th>{t("adm.ecost.col.concept")}</th><th>{t("adm.ecost.col.group")}</th><th className="r">{t("adm.ecost.col.amount")}</th><th className="r">{t("adm.ecost.col.pct")}</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.key} className="ord-row" onClick={() => goTo(s.group)} title={t("adm.ui.open")}>
                  <td><i className="exc-dot" style={{ background: s.color }} />{s.label}</td>
                  <td className="muted">{t(`adm.cost.group.${s.group}`)}</td>
                  <td className="r num">{fmtMoney(s.amount, "usd", lang)}</td>
                  <td className="r num muted">{pct1((s.amount / total) * 100)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2}>{t("adm.cost.gross")}</td><td className="r num">{fmtMoney(total, "usd", lang)}</td><td className="r num">100%</td></tr></tfoot>
          </table>
        </Accordion>
      )}
    </div>
  );
}

/** Nombre de una red (clave `adm.src.*`; si no existe, el token tal cual). */
function useSourceLabel() {
  const { t } = useLang();
  return (k) => (t(`adm.src.${k}`) === `adm.src.${k}` ? k : t(`adm.src.${k}`));
}

/**
 * Redes por las que vendió un vendedor: un icono por red con el número de
 * ventas debajo. Respaldo cuando quien monta no pasa `channels`.
 */
export function ChannelIcons({ by_source = [], size = 15 }) {
  const { t } = useLang();
  const label = useSourceLabel();
  const by = Object.fromEntries(by_source.map((x) => [x.source, x.orders || 0]));
  const keys = [...CHANNELS, ...by_source.map((x) => x.source).filter((k) => !CHANNELS.includes(k))];
  return (
    <span className="exc-channels" aria-label={t("adm.ecost.sellers.channels")}>
      {keys.map((k) => (
        <span key={k} className={`exc-ch ${by[k] ? "on" : ""}`} title={t("adm.ecost.sellers.via", { n: by[k] || 0, net: label(k) })}>
          <Icon name={SOURCE_ICON[k] || "link"} size={size} />
          <b>{by[k] || 0}</b>
        </span>
      ))}
    </span>
  );
}

/** Ventas por vendedor del período, con el total en grande y sus redes; clic → `onSeller(code)`. */
function SellersCard({ data, lang, go, onSeller, channels }) {
  const { t } = useLang();
  const rows = useMemo(() => {
    const src = new Map();
    for (const o of data?.orders || []) {
      if (!o.seller_code) continue;
      const m = src.get(o.seller_code) || new Map();
      const k = o.seller_source || "link";
      const cur = m.get(k) || { source: k, orders: 0, revenue: 0 };
      cur.orders += 1; cur.revenue += Number(o.gross ?? o.revenue) || 0;
      m.set(k, cur); src.set(o.seller_code, m);
    }
    return (data?.by_seller || []).filter((s) => s.code && s.orders > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 6)
      .map((s) => ({ ...s, by_source: [...(src.get(s.code)?.values() || [])].sort((a, b) => b.orders - a.orders) }));
  }, [data]);
  const none = (data?.by_seller || []).find((s) => !s.code);
  const max = Math.max(1, ...rows.map((r) => r.revenue));
  const open = (code) => { if (onSeller) onSeller(code); else go("sellers", { seller: code }); };
  return (
    <Card icon="sellers" title={t("adm.ecost.sellers.title")} right={<HelpTip topic="cost.commission" />} onGo={() => go("sellers")} goLabel={t("adm.tab.sellers")} name="vendedores"
      csv={{ cols: [[t("adm.sel.name"), "name"], [t("adm.sel.code"), "code"], [t("adm.kpi.orders"), "orders"], [t("adm.sel.sales"), "revenue"], [t("adm.cost.cost"), "cost"], [t("adm.cost.margin"), "margin"], [t("adm.sel.commissions"), "commission"]], rows: data?.by_seller || [] }}>
      {!data ? <div className="adm-skel" style={{ height: 80 }} /> : rows.length === 0 ? (
        <div className="adm-empty compact" onClick={() => go("sellers")} role="button"><Icon name="megaphone" size={26} /><b>{t("adm.ecost.sellers.none")}</b>{none?.orders > 0 && <p>{t("adm.ecost.sellers.unassigned", { n: none.orders, v: fmtMoney(none.revenue, "usd", lang) })}</p>}</div>
      ) : (
        <div className="exc-sellers">
          {rows.map((r) => (
            <button type="button" className="exc-seller" key={r.code} onClick={() => open(r.code)} title={t("adm.ecost.sellers.open", { name: r.name })}>
              <span className="sel-avatar mini exc-seller-av">{String(r.name || r.code || "?").slice(0, 2).toUpperCase()}</span>
              <span className="exc-seller-top"><span className="exc-seller-name">{r.name}</span><small className="muted">{t("adm.ecost.sellers.orders", { n: r.orders })}</small></span>
              <b className="exc-seller-total">{fmtMoney(r.revenue, "usd", lang)}</b>
              <span className="adm-tb-track exc-seller-bar"><span className="adm-tb-fill" style={{ width: `${(r.revenue / max) * 100}%` }} /></span>
              <span className="exc-seller-ch">{channels ? channels(r) : <ChannelIcons by_source={r.by_source} />}</span>
            </button>
          ))}
          {none?.orders > 0 && <small className="muted exc-unassigned">{t("adm.ecost.sellers.unassigned", { n: none.orders, v: fmtMoney(none.revenue, "usd", lang) })}</small>}
        </div>
      )}
    </Card>
  );
}

/** Glosario plegado: qué incluye cada costo, en el orden en que se descuenta. */
function Glossary({ go }) {
  const { t } = useLang();
  return (
    <Accordion id="cost-glossary" icon="info" title={t("adm.ecost.gl.title")} subtitle={t("adm.ecost.gl.sub")} className="exc-acc exc-glossary" bodyClassName="exc-acc-body">
      <ol className="exc-gl">
        {GLOSSARY.map((e, i) => (
          <li key={e.g} className={`exc-gl-row g-${e.g}`}>
            <span className="exc-gl-step" style={{ background: GROUP_COLOR[e.g] }}>{i + 1}</span>
            <span className="exc-gl-body">
              <span className="exc-gl-name"><Icon name={e.icon} size={14} />{t(`adm.ecost.gl.${e.g}.name`)} <HelpTip topic={e.topic} /></span>
              <span className="exc-gl-def">{t(`adm.ecost.gl.${e.g}.def`)}</span>
              <span className="exc-gl-items">{t(`adm.ecost.gl.${e.g}.items`)}</span>
            </span>
            <button type="button" className="adm-mini exc-gl-go" onClick={() => go("costs", { sub: e.sub })} title={t("adm.ui.open")}><Icon name="arrowUpRight" size={13} /></button>
          </li>
        ))}
      </ol>
    </Accordion>
  );
}

export default function ExecutiveCosts({ preset, range: givenRange, store = "", go, onSeller, channels }) {
  const { t, lang } = useLang();
  const demo = isDemoLogin();
  const [data, setData] = useState(null);
  const [state, setState] = useState(demo ? "demo" : "loading");
  const H = useChartHeight(0.14, 90, 150);
  const HC = useChartHeight(0.22, 170, 240);
  const cmpRef = useRef(null);
  // `range` manda; `preset` (hoy/7d/30d/90d) se conserva para quien aún lo pase.
  const range = useMemo(() => givenRange || rangeFor(preset || "30d"), [givenRange, preset]);
  const from = ymd(range.from);
  const to = ymd(range.to);
  useEffect(() => {
    if (demo) return undefined;
    let on = true;
    setState("loading");
    fetchCostSummary({ from, to, store }).then((d) => { if (on) { setData(d); setState("ok"); } }).catch(() => { if (on) setState("error"); });
    return () => { on = false; };
  }, [from, to, store, demo]);

  const tot = data?.totals || {};
  const byDay = data?.by_day || [];
  const cmpSeries = useMemo(() => byDay.map((d) => ({ label: d.date.slice(5), date: d.date, sales: d.revenue, cost: d.cost, profit: d.margin, orders: d.orders })), [byDay]);
  const brandDonut = useMemo(() => (data?.by_brand || []).filter((b) => b.frame_cost > 0).map((b) => ({ label: b.name, value: Math.round(b.frame_cost * 100) / 100 })), [data]);
  const recent = (data?.orders || []).slice(0, 7);
  const incomplete = (data?.orders || []).filter((o) => o.undefined_costs > 0).length;
  const opCost = (tot.materials || 0) + (tot.percent_items || 0) + (tot.commission || 0) + (tot.manual || 0);
  const money = (v) => fmtMoney(v, "usd", lang);
  const label = (key, topic) => <>{t(key)} <HelpTip topic={topic} /></>;

  const cmpCols = [[t("adm.col.date"), "date"], [t("adm.kpi.orders"), "orders"], [t("adm.chart.sales"), "revenue"], [t("adm.chart.cost"), "cost"], [t("adm.chart.profit"), "margin"], [t("adm.chart.margin") + " %", "margin_pct"]];
  const cmpRows = byDay.map((d) => ({ ...d, margin_pct: d.revenue > 0 ? Math.round((d.margin / d.revenue) * 1000) / 10 : null }));
  const cmpXlsx = () => ({ filename: `${t("adm.ecost.cmp.name")}-${from}-${to}.xlsx`, sheets: [{ name: t("adm.ecost.cmp.sheet"), cols: cmpCols.map(([header, key]) => ({ header, key, type: key === "date" ? "text" : "number" })), rows: cmpRows }] });

  return (
    <div className="adm-exec exc-root">
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

      {/* Seis cifras de una palabra; el «?» de cada una abre la definición, la fórmula y un ejemplo. */}
      <div className="adm-kpis adm-exec-kpis exc-kpis">
        <KpiCard label={label("adm.ecost.kpi.paid", "cost.paid")} value={money(tot.gross ?? tot.revenue)} icon={<Icon name="dollar" />} sub={t("adm.cost.ordersN", { n: tot.orders ?? 0 })} hint={t("adm.cost.h.gross")} onClick={() => go("exec", { sub: "sales" })} />
        <KpiCard label={label("adm.ecost.kpi.net", "cost.net")} value={money(tot.net_base)} icon={<Icon name="wallet" />} sub={t("adm.ecost.kpi.deducted", { v: money(tot.deductions) })} hint={t("adm.cost.h.netBase")} onClick={() => go("costs", { sub: "rules" })} />
        <KpiCard label={label("adm.ecost.kpi.cost", "cost.cost")} value={money(opCost)} icon={<Icon name="receipt" />} sub={t("adm.ecost.kpi.costSub", { m: money(tot.materials), p: money(opCost - (tot.materials || 0)) })} hint={t("adm.cost.h.opCost")} onClick={() => go("costs", { sub: "rules" })} />
        <KpiCard label={label("adm.ecost.kpi.profit", "cost.profit")} value={money(tot.profit ?? tot.margin)} icon={<Icon name="trendUp" />} sub={t("adm.ecost.kpi.ofNet", { pct: pct(tot.profit_pct_net) })} deltaGood={tot.profit_gap == null ? true : tot.profit_gap >= 0} hint={t("adm.cost.h.ownerProfit")} onClick={() => go("costs", { sub: "profit" })} />
        <KpiCard label={label("adm.ecost.kpi.target", "cost.target")} value={tot.profit_target_pct == null ? "—" : `${pct(tot.profit_target_pct)} · ${money(tot.profit_target_amount)}`} icon={<Icon name="gauge" />}
          sub={tot.profit_target_pct == null ? t("adm.cost.noTargetShort") : tot.profit_gap >= 0 ? t("adm.ecost.kpi.targetOk", { v: money(tot.profit_gap) }) : t("adm.ecost.kpi.targetSub", { v: money(-tot.profit_gap) })} hint={t("adm.cost.h.target")} onClick={() => go("costs", { sub: "allocation" })} />
        <KpiCard label={label("adm.ecost.kpi.incomplete", "cost.incomplete")} value={String(incomplete)} icon={<Icon name="alert" />} sub={t("adm.ecost.kpi.incompleteSub")} hint={t("adm.cost.h.incomplete")} onClick={() => go("costs", { sub: incomplete ? "rules" : "profit" })} />
      </div>

      <Glossary go={go} />

      <div className="exec-grid cols-3-1 exc-mid">
        <Card icon="layers" title={t("adm.cost.allocation")} right={<HelpTip topic="cost.split" />} onGo={() => go("costs", { sub: "allocation" })} goLabel={t("adm.cost.tab.allocation")} name="reparto" csv={{ cols: [[t("adm.cost.line"), "label"], [t("adm.cost.amount"), "amount"]], rows: data?.by_kind || [] }}>
          <AllocationBar byKind={data?.by_kind} revenue={tot.gross ?? tot.revenue} targetAmount={tot.profit_target_amount} lang={lang} go={go} detail />
        </Card>
        <SellersCard data={data} lang={lang} go={go} onSeller={onSeller} channels={channels} />
      </div>

      <Card icon="sales" title={t("adm.ecost.cmp.title")} onGo={() => go("costs", { sub: "profit" })} goLabel={t("adm.cost.tab.profit")} className="exc-cmp" exportable={false}
        right={<><HelpTip topic="cost.marginChart" /><ExportMenu targetRef={cmpRef} title={t("adm.ecost.cmp.title")} name={t("adm.ecost.cmp.name")} csv={{ cols: cmpCols, rows: cmpRows }} xlsx={cmpXlsx} meta={`${from} – ${to}`} /></>}>
        <div ref={cmpRef}>
          <CompareBarChart data={cmpSeries} height={HC} format={money} labels={{ sales: t("adm.chart.sales"), cost: t("adm.chart.cost"), profit: t("adm.chart.profit"), margin: t("adm.chart.margin") }} onSelect={(d) => go("costs", { sub: "profit", day: d.date })} />
        </div>
      </Card>

      <div className="exc-bottom">
        <Card icon="tagIcon" title={t("adm.cost.byBrand")} hint={t("adm.cost.h.byBrand")} onGo={() => go("costs", { sub: "rules" })} goLabel={t("adm.cost.tab.rules")} name="costo-marca" csv={{ cols: [[t("adm.exec.brands"), "name"], [t("adm.kpi.orders"), "orders"], [t("adm.cost.revenue"), "revenue"], [t("adm.cost.frameCost"), "frame_cost"]], rows: data?.by_brand || [] }}>
          {brandDonut.length === 0 ? <div className="adm-empty compact" role="button" onClick={() => go("costs", { sub: "rules" })}><Icon name="glasses" size={26} /><b>{t("adm.cost.noBrandCost")}</b><p>{t("adm.cost.noBrandCostHint")}</p></div>
            : <DonutChart data={brandDonut} height={H} size={110} onSelect={() => go("costs", { sub: "rules" })} />}
        </Card>
        <Card icon="clock" title={t("adm.cost.recentMargin")} hint={t("adm.cost.h.recent")} onGo={() => go("costs", { sub: "profit" })} goLabel={t("adm.cost.tab.profit")} name="pedidos-margen">
          {recent.length === 0 ? <div className="adm-nodata">{t("adm.cost.noOrders")}</div> : (
            <table className="adm-table exec-recent exc-recent">
              <tbody>
                {recent.map((o) => (
                  <tr key={o.id} className="ord-row" onClick={() => go("costs", { sub: "profit", order: o.id })} title={`${t("adm.cost.openSheet")} · ${t("adm.ecost.recent.net", { v: money(o.net_base) })}`}>
                    <td className="exc-id"><b>#{o.display_id}</b>{o.undefined_costs > 0 && <Icon name="alert" size={11} className="exc-warn" />}</td>
                    <td className="exc-date" title={shortDate(o.created_at, lang)}>{dayMonth(o.created_at, lang)}</td>
                    <td className="exc-cust"><span>{o.customer_name || "—"}</span></td>
                    <td className="r num exc-total"><b>{money(o.gross ?? o.revenue)}</b><small>{t("adm.ecost.recent.net", { v: money(o.net_base) })}</small></td>
                    <td className="r exc-margin"><span className={`margin-pct ${o.profit_gap == null ? marginTone(o.margin_pct) : o.profit_gap >= 0 ? "good" : "bad"}`}>{money(o.margin)}<em>{pct(o.profit_pct_net)}</em></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                      <div className="adm-tb-top"><span className="adm-tb-name">{k.label}</span><b>{money(k.amount)}</b></div>
                      <div className="adm-tb-track"><div className="adm-tb-fill" style={{ width: `${(k.amount / max) * 100}%`, background: GROUP_COLOR[groupOfKind(k.kind, k.key)] }} /></div>
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

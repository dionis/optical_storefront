// Dónde se usa: pestaña «Panel de ventas» de /admin — el panel global del dueño
// (E9) con datos reales de todas las tiendas y la web: cifras, comparación con
// el periodo anterior, rankings, filtros combinables, de una cifra a la venta
// individual y exportación. El supervisor y el encargado lo ven limitado a sus
// tiendas (HU-67); el alcance lo pone el servidor.
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useLensCatalog } from "../data/lensCatalog.js";
import Icon from "./icons.jsx";
import { KpiCard, LineChart } from "./charts.jsx";
import { Card } from "./ui.jsx";
import { money } from "./adminOrders.js";
import { adminFetch, ADMIN_API_URL } from "./adminApi.js";
import { getSession } from "./adminApi.js";
import { methodName, posContext } from "./posApi.js";

const BYS = ["establishment", "seller", "product", "brand", "category", "lens_design", "lens_material", "lens_photo", "lens_ar", "payment_method", "terminal"];
const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => ymd(new Date(Date.now() - n * 86400_000));
const PRESETS = { today: 0, "7d": 6, "30d": 29, "90d": 89 };

const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)) p.set(k, Array.isArray(v) ? v.join(",") : String(v));
  return p.toString();
};

function delta(cur, prev) {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

export default function SalesBoard() {
  const { t, lang } = useLang();
  const { DESIGNS, MATERIALS, PHOTO, AR } = useLensCatalog();
  const [ctx, setCtx] = useState(null);
  const [f, setF] = useState({ from: daysAgo(29), to: daysAgo(0), stores: [], payment_methods: [], categories: [], rx: "" });
  const [by, setBy] = useState("establishment");
  const [summary, setSummary] = useState(null);
  const [series, setSeries] = useState(null);
  const [rows, setRows] = useState([]);
  const [drill, setDrill] = useState(null); // { label, extra }
  const [sales, setSales] = useState([]);
  const [state, setState] = useState("loading");

  useEffect(() => { posContext().then(setCtx).catch(() => setCtx({ stores: [], payment_methods: [] })); }, []);
  const query = useMemo(() => qs({ ...f, rx: f.rx }), [f]);

  useEffect(() => {
    let on = true;
    setState("loading");
    Promise.all([
      adminFetch(`/admin/sales-analytics/summary?${query}`),
      adminFetch(`/admin/sales-analytics/timeseries?${query}`),
    ])
      .then(([s, ts]) => { if (on) { setSummary(s); setSeries(ts); setState("ok"); } })
      .catch(() => on && setState("error"));
    return () => { on = false; };
  }, [query]);
  useEffect(() => {
    let on = true;
    adminFetch(`/admin/sales-analytics/breakdown?${query}&by=${by}`).then((r) => on && setRows(r.rows || [])).catch(() => on && setRows([]));
    return () => { on = false; };
  }, [query, by]);
  useEffect(() => {
    if (!drill) { setSales([]); return undefined; }
    let on = true;
    adminFetch(`/admin/sales-analytics/sales?${qs({ ...f, ...drill.extra })}`).then((r) => on && setSales(r.sales || [])).catch(() => on && setSales([]));
    return () => { on = false; };
  }, [drill, f]);

  const storeLabel = (id) => (id === "web" ? t("adm.board.web") : ctx?.stores.find((s) => s.id === id)?.code || id || "—");
  const L = (o) => (o ? o[lang] ?? o.es : null);
  const label = (r) => {
    if (r.key === null || r.key === undefined) return t("adm.board.none");
    switch (by) {
      case "establishment": return storeLabel(r.key);
      case "product": return r.label || r.key;
      case "category": return t(`adm.board.cat.${r.key}`);
      case "lens_design": return L(DESIGNS.find((d) => d.id === r.key)?.label) || r.key;
      case "lens_material": return L(MATERIALS.find((d) => d.id === r.key)?.label) || r.key;
      case "lens_photo": return L(PHOTO.find((d) => d.id === r.key)?.label) || r.key;
      case "lens_ar": return L([...(AR.sv || []), ...(AR.bifprog || [])].find((d) => d.id === r.key)?.label) || r.key;
      case "payment_method": return methodName(ctx?.payment_methods.find((m) => m.code === r.key), t, lang) || r.key;
      case "terminal": return ctx?.stores.flatMap((s) => s.terminals).find((x) => x.id === r.key)?.code || r.key;
      default: return r.key;
    }
  };
  // De una fila del ranking a sus ventas (HU-64).
  const drillExtra = (r) => {
    if (r.key === null || r.key === undefined) return null;
    switch (by) {
      case "establishment": return { stores: [r.key] };
      case "product": return { products: [r.key] };
      case "brand": return { brands: [r.key] };
      case "category": return { categories: [r.key] };
      case "lens_design": return { lens_designs: [r.key] };
      case "payment_method": return { payment_methods: [r.key] };
      default: return {};
    }
  };

  const exportCsv = async () => {
    const s = getSession();
    const res = await fetch(`${ADMIN_API_URL}/admin/sales-analytics/export?${query}`, { headers: { Authorization: `Bearer ${s?.token}` } });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ventas_${f.from}_${f.to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const m = (v) => money(v, "usd", lang);
  const cur = summary?.current;
  const prev = summary?.previous;
  const toggle = (k, v) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));

  return (
    <div className="adm-section pos">
      <div className="adm-head-row">
        <h2>{t("adm.tab.salesboard")}</h2>
        <button type="button" className="btn-sm" onClick={exportCsv}><Icon name="excel" size={14} /> {t("adm.board.export")}</button>
      </div>
      <p className="adm-sub">{t("adm.board.sub")}</p>

      <div className="adm-card board-filters">
        <div className="pos-row">
          {Object.keys(PRESETS).map((p) => (
            <button key={p} type="button" className="btn-xs" onClick={() => setF((x) => ({ ...x, from: daysAgo(PRESETS[p]), to: daysAgo(0) }))}>{t(`adm.board.preset.${p}`)}</button>
          ))}
          <label>{t("adm.board.from")}<input type="date" value={f.from} onChange={(e) => setF((x) => ({ ...x, from: e.target.value }))} /></label>
          <label>{t("adm.board.to")}<input type="date" value={f.to} onChange={(e) => setF((x) => ({ ...x, to: e.target.value }))} /></label>
          <label>{t("adm.board.rx")}
            <select value={f.rx} onChange={(e) => setF((x) => ({ ...x, rx: e.target.value }))}>
              <option value="">{t("adm.board.any")}</option><option value="1">{t("adm.board.withRx")}</option><option value="0">{t("adm.board.withoutRx")}</option>
            </select>
          </label>
        </div>
        <div className="board-chips">
          <b>{t("adm.board.stores")}</b>
          {(ctx?.stores || []).map((s) => <button key={s.id} type="button" className={`chip ${f.stores.includes(s.id) ? "on" : ""}`} onClick={() => toggle("stores", s.id)}>{s.code}</button>)}
          {ctx?.is_admin && <button type="button" className={`chip ${f.stores.includes("web") ? "on" : ""}`} onClick={() => toggle("stores", "web")}>{t("adm.board.web")}</button>}
        </div>
        <div className="board-chips">
          <b>{t("adm.board.payment")}</b>
          {(ctx?.payment_methods || []).map((pm) => <button key={pm.code} type="button" className={`chip ${f.payment_methods.includes(pm.code) ? "on" : ""}`} onClick={() => toggle("payment_methods", pm.code)}>{methodName(pm, t, lang)}</button>)}
        </div>
        <div className="board-chips">
          <b>{t("adm.board.category")}</b>
          {["frame", "case", "own_frame"].map((c) => <button key={c} type="button" className={`chip ${f.categories.includes(c) ? "on" : ""}`} onClick={() => toggle("categories", c)}>{t(`adm.board.cat.${c}`)}</button>)}
        </div>
      </div>

      {state === "error" && <div className="adm-demo-banner">{t("adm.err.pos.generic")}</div>}
      {cur && (
        <div className="board-kpis">
          <KpiCard label={t("adm.board.kpi.total")} value={m(cur.total)} delta={delta(cur.total, prev?.total)} deltaGood={cur.total >= (prev?.total || 0)} icon={<Icon name="dollar" />} onClick={() => setDrill({ label: t("adm.board.kpi.total"), extra: {} })} hint={t("adm.board.vsPrev", { v: m(prev?.total || 0) })} />
          <KpiCard label={t("adm.board.kpi.count")} value={String(cur.count)} delta={delta(cur.count, prev?.count)} deltaGood={cur.count >= (prev?.count || 0)} icon={<Icon name="receipt" />} onClick={() => setDrill({ label: t("adm.board.kpi.count"), extra: {} })} hint={t("adm.board.vsPrev", { v: String(prev?.count || 0) })} />
          <KpiCard label={t("adm.board.kpi.avg")} value={m(cur.avg_ticket)} delta={delta(cur.avg_ticket, prev?.avg_ticket)} deltaGood={cur.avg_ticket >= (prev?.avg_ticket || 0)} icon={<Icon name="trendUp" />} />
          <KpiCard label={t("adm.board.kpi.balance")} value={m(summary.balance_due)} icon={<Icon name="wallet" />} hint={t("adm.board.kpi.balanceHint")} />
          <KpiCard label={t("adm.board.kpi.insurance")} value={m(summary.insurance_due)} icon={<Icon name="clipboard" />} />
          <KpiCard label={t("adm.board.kpi.discount")} value={m(cur.discount)} icon={<Icon name="percent" />} />
        </div>
      )}
      {series && (
        <Card title={t("adm.board.byDay")} name="salesByDay" icon="trendUp">
          <LineChart data={series.current.map((d) => ({ label: d.day.slice(5), value: d.total }))} valuePrefix="$" />
        </Card>
      )}

      <Card title={t("adm.board.ranking")} name="ranking" icon="layers"
        right={<select value={by} onChange={(e) => setBy(e.target.value)} aria-label={t("adm.board.by")} title={t("adm.board.by")}>{BYS.map((b) => <option key={b} value={b}>{t(`adm.board.by.${b}`)}</option>)}</select>}>
        <table className="adm-table responsive">
          <thead><tr><th>{t(`adm.board.by.${by}`)}</th><th>{t("adm.board.kpi.total")}</th><th>{t("adm.board.kpi.count")}</th><th>{t("adm.board.units")}</th><th>{t("adm.board.share")}</th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const extra = drillExtra(r);
              return (
                <tr key={`${r.key}-${i}`} className={extra ? "ord-row" : ""} onClick={extra ? () => setDrill({ label: label(r), extra }) : undefined}>
                  <td data-label={t(`adm.board.by.${by}`)}><b>{label(r)}</b></td>
                  <td data-label={t("adm.board.kpi.total")}>{m(r.total)}</td>
                  <td data-label={t("adm.board.kpi.count")}>{r.count}</td>
                  <td data-label={t("adm.board.units")}>{r.units}</td>
                  <td data-label={t("adm.board.share")}><span className="board-bar"><i style={{ width: `${r.share}%` }} /></span> {r.share}%</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan="5" className="full"><div className="adm-nodata">{t("adm.chart.noData")}</div></td></tr>}
          </tbody>
        </table>
      </Card>

      {drill && (
        <Card title={t("adm.board.salesOf", { label: drill.label })} name="drill" icon="receipt" right={<button type="button" className="btn-xs" onClick={() => setDrill(null)} aria-label={t("adm.ord.clear")}><Icon name="close" size={12} /></button>}>
          <table className="adm-table responsive">
            <thead><tr><th>{t("adm.pos.sales.number")}</th><th>{t("adm.pos.sales.when")}</th><th>{t("adm.pos.store")}</th><th>{t("adm.pos.sales.seller")}</th><th>{t("adm.board.items")}</th><th>{t("adm.board.kpi.total")}</th></tr></thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.order_id}>
                  <td data-label={t("adm.pos.sales.number")}><b>{s.number || t("adm.board.web")}</b></td>
                  <td data-label={t("adm.pos.sales.when")}>{new Date(s.sold_at).toLocaleString(lang === "en" ? "en-US" : "es-US", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td data-label={t("adm.pos.store")}>{s.channel === "web" ? t("adm.board.web") : storeLabel(s.establishment_id)}</td>
                  <td data-label={t("adm.pos.sales.seller")}>{s.seller_code || "—"}</td>
                  <td data-label={t("adm.board.items")}><small>{s.items.replace(/own_frame/g, t("adm.pos.own.tag"))}</small></td>
                  <td data-label={t("adm.board.kpi.total")}>{m(s.total)}</td>
                </tr>
              ))}
              {sales.length === 0 && <tr><td colSpan="6" className="full"><div className="adm-nodata">{t("adm.chart.noData")}</div></td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

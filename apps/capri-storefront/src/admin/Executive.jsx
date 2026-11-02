// Dónde se usa: Ejecutivo → acordeón «Tendencias» (ExecutiveHub.jsx). Las
// gráficas del período, cada una UNA sola vez en toda la cabina: ventas por
// día, pedidos por día, ventas por vendedor, por marca y —solo con la tienda
// online a la vista— accesos vs compras y día de la semana. Se alimentan de las
// MISMAS ventas que la tira de KPI y la lista «Pedidos y etapas»
// (useStoreSales → /admin/sales-analytics/sales), así que siguen el filtro
// global de tienda (todas / web / una tienda) y el período sin segunda fuente.
// Los KPI y los últimos pedidos ya no se repiten aquí: viven en la tira y en
// la lista. `CatalogMini` (salud del catálogo) sigue para el acordeón «Catálogo».
//
//   <Trends rows={sales.rows} range={{ from: Date, to: Date }} web={sf.isAll || sf.isWeb}
//          sellers={sellerRows.rows} onSeller={openSeller} go={go} />
import { useEffect, useMemo, useState } from "react";
import { LineChart, BarChart, DonutChart, AccessVsBuyChart, WeekdayChart } from "./charts.jsx";
import { summarizeOrders } from "./analytics.js";
import { isDemoLogin } from "./adminAuth.js";
import { money as fmtMoney } from "./adminOrders.js";
import { fetchDiscontinued } from "./catalogAdmin.js";
import { useCatalog } from "../data/catalogStore.js";
import { BRANDS } from "../data/brands.js";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { Card, useChartHeight } from "./ui.jsx";
import { SellerChannels } from "./SellerPanel.jsx";
import "./fit.css";

export { STAGE_ICON } from "./StageBar.jsx";
const BRAND_LOGO_BY_NAME = Object.fromEntries(BRANDS.map((b) => [b.name, b.logo]));
const BRAND_SLUG_BY_NAME = Object.fromEntries(BRANDS.map((b) => [b.name, b.slug]));
const int = (n, lang) => (Number(n) || 0).toLocaleString(lang === "en" ? "en-US" : "es");

/** Una venta de la lista como pedido de analytics.js (summarizeOrders): día, total, marca y modelo. */
export function saleToTrendOrder(r, noBrand = "—") {
  const total = Number(r.total) || 0;
  const qty = Number(r.units) || 1;
  return {
    id: r.order_id || r.sale_id,
    t: r.sold_at,
    total,
    itemsCount: qty,
    items: [{ name: r.frame_model || r.items || "—", sku: r.frame_sku || "", brand: r.frame_brand || noBrand, kind: "frame", qty, total }],
    stage: null,
    terminal: null,
    has_prescription: Boolean(r.has_rx),
    demo: false,
  };
}

/**
 * Ventas por vendedor, en corto: barras con nombre, nº y total (o comisión), de
 * mayor a menor; pulsar abre el panel del vendedor (`onSeller(code)`). Las filas
 * son las de sellerRowsFromInsights (ExecutiveHub), la misma fuente que el
 * acordeón «Vendedores».
 */
export function SellersMini({ rows = [], zero = 0, onSeller, go, showCommission = false }) {
  const { t, lang } = useLang();
  const top = rows.slice(0, 6);
  const max = Math.max(1, ...top.map((r) => r.sales));
  return (
    <Card icon="sellers" title={t("adm.exec.bySeller")} hint={t("adm.ex.tr.bySellerHint")} onGo={go ? () => go("sellers") : undefined} goLabel={t("adm.tab.sellers")} name="vendedores"
      csv={{ cols: [[t("adm.ex.sellers.name"), "name"], [t("adm.sp.col.code"), "code"], [t("adm.ex.sellers.count"), "count"], [t("adm.ex.sellers.sales"), "sales"], [t("adm.ex.sellers.commission"), "commission"], [t("adm.ex.sellers.share"), "share"]], rows }}>
      {top.length === 0 ? <div className="adm-nodata">{t("adm.ex.sellers.empty")}</div> : (
        <div className="adm-thumbbars tight">
          {top.map((r) => (
            <div className={`adm-tb-row ${onSeller ? "clickable" : ""}`} key={r.code} onClick={onSeller ? () => onSeller(r.code) : undefined} role={onSeller ? "button" : undefined} title={onSeller ? t("adm.sp.open") : undefined}>
              <div className="adm-tb-thumb sm"><span className="sel-avatar mini">{String(r.name || r.code || "?").slice(0, 2).toUpperCase()}</span></div>
              <div className="adm-tb-main">
                <div className="adm-tb-top">
                  <span className="adm-tb-name">{r.name} <small className="muted">· {int(r.count, lang)} {t("adm.exec.ordersShort")}</small>{r.by_source && <SellerChannels by_source={r.by_source} compact className="sp-cell-channels" />}</span>
                  <b>{fmtMoney(r.sales, "usd", lang)}{showCommission && r.commission != null && <small className="muted"> · {fmtMoney(r.commission, "usd", lang)}</small>}</b>
                </div>
                <div className="adm-tb-track"><div className="adm-tb-fill" style={{ width: `${(r.sales / max) * 100}%` }} /></div>
              </div>
            </div>
          ))}
          {zero > 0 && <small className="muted">{t("adm.sp.zero", { n: zero })}</small>}
        </div>
      )}
    </Card>
  );
}

/** Salud del catálogo: monturas activas, estuches, descatalogadas y marcas. */
export function CatalogMini({ go, bare = false }) {
  const { t, lang } = useLang();
  const { products, cases } = useCatalog();
  const [discontinued, setDiscontinued] = useState(null);
  useEffect(() => {
    if (isDemoLogin()) return undefined;
    let on = true;
    fetchDiscontinued().then((d) => { if (on) setDiscontinued(d.length); }).catch(() => {});
    return () => { on = false; };
  }, []);
  const body = (
    <div className="exec-mini-kpis">
      <button type="button" onClick={() => go("products")}><small>{t("adm.exec.activeFrames")}</small><b>{int(products.length, lang)}</b></button>
      <button type="button" onClick={() => go("products")}><small>{t("adm.prod.cases")}</small><b>{int(cases.length, lang)}</b></button>
      <button type="button" onClick={() => go("products")}><small>{t("adm.exec.discontinued")}</small><b>{discontinued == null ? "—" : int(discontinued, lang)}</b></button>
      <button type="button" onClick={() => go("products")}><small>{t("adm.exec.brands")}</small><b>{int(new Set(products.map((p) => p.brand)).size, lang)}</b></button>
    </div>
  );
  if (bare) return body;
  return <Card icon="glasses" title={t("adm.exec.catalogHealth")} hint={t("adm.exec.catalogHint")} onGo={() => go("products")} goLabel={t("adm.tab.products")} name="catalogo">{body}</Card>;
}

/**
 * Las gráficas del período. `rows`: ventas de useStoreSales (las anuladas se
 * descartan); `range`: { from: Date, to: Date }; `web`: la tienda online está a
 * la vista (todas o web) — solo entonces hay accesos, que se miden en la web;
 * `sellers` / `zero`: filas de sellerRowsFromInsights; `onSeller(code)` abre el
 * panel del vendedor; `go` para las tarjetas que saltan a otra pantalla.
 */
export default function Trends({ rows = [], range, web = true, sellers = [], zero = 0, onSeller, go, showCommission = false, loading = false }) {
  const { t, lang } = useLang();
  const noBrand = t("adm.ex.tr.noBrand");
  const s = useMemo(() => summarizeOrders(rows.filter((r) => r.status !== "voided").map((r) => saleToTrendOrder(r, noBrand)), range), [rows, range, noBrand]);
  const weekday = useMemo(() => s.weekday.map((w) => ({ ...w, label: t(w.label) })), [s.weekday, t]);
  const brandSlug = (label) => BRAND_SLUG_BY_NAME[label] || String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const H = useChartHeight(0.14, 90, 150);
  const empty = !loading && rows.length === 0;
  return (
    <div className="adm-exec ex-trends">
      {empty && <div className="adm-nodata">{t("adm.ex.tr.empty")}</div>}
      <div className="adm-fit-row cols-3 tight">
        <Card icon="sales" title={t("adm.chart.salesByDay")} hint={t("adm.ex.tr.salesByDayHint")} name="ventas-dia" csv={{ cols: [[t("adm.col.date"), "label"], [t("adm.kpi.revenue"), "value"]], rows: s.salesSeries }}>
          <LineChart data={s.salesSeries} valuePrefix="$" height={H} />
        </Card>
        <Card icon="orders" title={t("adm.sales.ordersByDay")} hint={t("adm.ex.tr.ordersByDayHint")} name="pedidos-dia" csv={{ cols: [[t("adm.col.date"), "label"], [t("adm.kpi.orders"), "value"]], rows: s.ordersSeries }}>
          <BarChart data={s.ordersSeries} height={H} />
        </Card>
        <SellersMini rows={sellers} zero={zero} onSeller={onSeller} go={go} showCommission={showCommission} />
      </div>
      <div className={`adm-fit-row tight ${web ? "cols-3" : "cols-1"}`}>
        <Card icon="tagIcon" title={t("adm.chart.salesByBrand")} hint={t("adm.ex.tr.byBrandHint")} onGo={go ? () => go("products") : undefined} goLabel={t("adm.tab.products")} name="ventas-marca" csv={{ cols: [[t("adm.exec.brands"), "label"], [t("adm.kpi.revenue"), "value"]], rows: s.topBrands }}>
          <DonutChart data={s.topBrands} iconByLabel={BRAND_LOGO_BY_NAME} height={H} size={Math.min(120, H)} onSelect={go ? (label) => go("costs", { sub: "prices", q: label, brand: brandSlug(label) }) : undefined} />
        </Card>
        {web && (
          <Card icon="eye" title={t("adm.chart.accessVsBuy")} hint={t("adm.chart.accessVsBuy.h")} name="accesos-compras" csv={{ cols: [[t("adm.col.date"), "label"], [t("adm.kpi.access"), "access"], [t("adm.kpi.orders"), "orders"]], rows: s.accessVsBuy }}>
            <AccessVsBuyChart data={s.accessVsBuy} height={H} />
          </Card>
        )}
        {web && (
          <Card icon="calendar" title={t("adm.chart.weekday")} hint={t("adm.fit.weekdayHint")} name="dia-semana" csv={{ cols: [[t("adm.chart.weekday"), "label"], [t("adm.kpi.access"), "access"], [t("adm.kpi.orders"), "orders"]], rows: weekday }}>
            <WeekdayChart data={weekday} height={H} />
          </Card>
        )}
      </div>
      {!web && <p className="ex-tr-note muted"><Icon name="info" size={12} /> {t("adm.ex.tr.webOnly")}</p>}
    </div>
  );
}

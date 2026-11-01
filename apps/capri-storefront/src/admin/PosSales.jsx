// Dónde se usa: pestaña «Ventas de tienda» de /admin. El vendedor ve las suyas;
// encargado y supervisor, las de sus tiendas; dueño y superadmin, todas (matriz
// de permisos acordada). Al pulsar una venta se abre su ficha (SaleDetailPanel):
// desde ahí se cobra el saldo, se entrega, se anula (o se pide anular) y se
// reimprimen documentos. Los importes vienen del servidor.
//
// Regla del dueño: la lista no se recorta. Cada venta lleva TODAS sus columnas
// (nº, fecha, tienda, punto de venta, vendedor, cliente, teléfono, marca, modelo,
// color, SKU, montura propia, receta, lentes, artículos, total, descuento,
// cobrado, saldo, prometida, entrega, bandeja, estado y, para quien puede verlo,
// costo real, comisión, ganancia y margen) y quien mira elige en «Columnas»
// cuáles ver (DataTable.jsx; de serie, las esenciales). El reporte PDF/Excel/CSV
// lleva exactamente las columnas visibles.
//
// Datos: la lista sale de GET /admin/pos/sales (filtros de caja: punto de venta,
// estado, saldo, número, cliente) y se completa con GET /admin/sales-analytics/
// sales (cliente, teléfono, montura, lentes, artículos y economía), unidas por
// `sale_id` (useSaleDetails). Si el servidor añade esos campos a /admin/pos/sales
// la segunda llamada sobra: ver el informe de DataTable.
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { adminFetch } from "./adminApi.js";
import { money } from "./adminOrders.js";
import { listSales, posContext, searchCustomers } from "./posApi.js";
import Accordion from "./Accordion.jsx";
import DataTable, { tableSpecFrom } from "./DataTable.jsx";
import { useColumns } from "./useColumns.js";
import { useSalePanel } from "./SaleDetailPanel.jsx";
import StoreFilter, { useStoreFilter } from "./StoreFilter.jsx";
import { ExportMenu } from "./ui.jsx";
import "./screens.css";

const DAY = 86400000;
const MAX_PAGES = 5;
const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/**
 * Completa las ventas del POS con lo que /admin/pos/sales no trae (cliente,
 * teléfono, montura, lentes, artículos, costo, comisión, ganancia) leyendo
 * /admin/sales-analytics/sales en la ventana de fechas de la lista y uniendo
 * por `sale_id`. Devuelve { map: Map<saleId, fila>, access, status:
 * "idle" | "loading" | "ok" | "partial" | "error" }. Las filas `limited` (de
 * un compañero, solo para cobrar) no se piden: el servidor no las daría.
 */
export function useSaleDetails(sales, { store = "", enabled = true } = {}) {
  const [state, setState] = useState({ map: new Map(), access: null, status: "idle" });
  useEffect(() => {
    const ids = (sales || []).filter((s) => s?.id && !s.limited).map((s) => s.id);
    if (!enabled || !ids.length) { setState({ map: new Map(), access: null, status: "ok" }); return undefined; }
    let on = true;
    setState((st) => ({ ...st, status: "loading" }));
    (async () => {
      const stamps = sales.map((s) => Date.parse(s.created_at)).filter(Number.isFinite);
      const from = ymd(Math.min(...stamps) - DAY);
      const to = ymd(Math.max(...stamps) + DAY);
      const want = new Set(ids);
      const map = new Map();
      let access = null;
      for (let page = 0; page < MAX_PAGES && want.size; page++) {
        const q = { from, to, page, voided: 1 };
        if (store) q.stores = store;
        const r = await adminFetch("/admin/sales-analytics/sales", { query: q });
        access = r.access || access;
        for (const row of r.sales || []) if (row.sale_id && want.has(row.sale_id)) { map.set(row.sale_id, row); want.delete(row.sale_id); }
        if (!r.has_more) break;
      }
      if (on) setState({ map, access, status: want.size ? "partial" : "ok" });
    })().catch(() => { if (on) setState({ map: new Map(), access: null, status: "error" }); });
    return () => { on = false; };
  }, [sales, store, enabled]);
  return state;
}

/** La venta de la lista con lo que añade la fila de analítica (sin pisar lo que ya trae). */
export function mergeSaleDetails(s, d) {
  if (!d) return { ...s, customer: s.customer_name ?? s.customer ?? null };
  return {
    ...s,
    customer: s.customer_name || s.customer || d.customer || null,
    customer_phone: s.customer_phone || d.customer_phone || null,
    frame_brand: d.frame_brand ?? null,
    frame_model: d.frame_model ?? null,
    frame_color: d.frame_color ?? null,
    frame_sku: d.frame_sku ?? null,
    own_frame: Boolean(d.own_frame),
    has_rx: Boolean(d.has_rx),
    lens_summary: d.lens_summary ?? null,
    items: d.items ?? null,
    cost: d.cost == null ? null : (Number(d.cost) || 0) + (Number(d.fee) || 0),
    commission: d.commission ?? null,
    profit: d.profit ?? null,
    margin_pct: d.margin_pct ?? null,
  };
}

/** Props: `me` (GET /admin/team/me) para el filtro de tienda global; sin él se deduce del contexto del POS. */
export default function PosSales({ me }) {
  const { t, lang } = useLang();
  const [ctx, setCtx] = useState(null);
  const [sales, setSales] = useState([]);
  const [state, setState] = useState("loading");
  const [f, setF] = useState({ terminal: "", with_balance: false, status: "", number: "" });
  // La tienda la decide el filtro global del panel (StoreFilter); la online no tiene ventas de mostrador.
  const who = me || (ctx ? { is_admin: ctx.is_admin, role: ctx.role } : undefined);
  const { storeId, isAll, isWeb } = useStoreFilter(who);
  const store = isAll || isWeb ? "" : storeId;
  const [custQ, setCustQ] = useState("");
  const [custHits, setCustHits] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [tick, setTick] = useState(0);
  // La ficha de la venta (cajón lateral): abrirla no cambia la lista; cobrar/entregar/anular la refresca.
  const sp = useSalePanel({ me: who, ctx, onChanged: () => setTick((n) => n + 1) });

  useEffect(() => { posContext().then(setCtx).catch(() => setState("error")); }, []);
  useEffect(() => {
    if (!ctx) return undefined;
    let on = true;
    setState("loading");
    listSales({ store, terminal: f.terminal, with_balance: f.with_balance ? 1 : "", status: f.status, number: f.number.trim(), customer: customer?.id })
      .then((r) => { if (on) { setSales(r.sales || []); setState("ok"); } })
      .catch(() => on && setState("error"));
    return () => { on = false; };
  }, [ctx, f, store, customer, tick]);
  // Cambiar de tienda suelta el punto de venta: el anterior es de otra tienda.
  useEffect(() => { setF((x) => (x.terminal ? { ...x, terminal: "" } : x)); }, [store]);
  useEffect(() => {
    if (custQ.trim().length < 2) { setCustHits([]); return undefined; }
    const h = setTimeout(() => searchCustomers(custQ).then((r) => setCustHits(r.customers || [])).catch(() => setCustHits([])), 300);
    return () => clearTimeout(h);
  }, [custQ]);

  const storeById = useMemo(() => new Map((ctx?.stores || []).map((s) => [s.id, s])), [ctx]);
  const terminals = store ? storeById.get(store)?.terminals || [] : (ctx?.stores || []).flatMap((s) => s.terminals);
  const termById = useMemo(() => new Map((ctx?.stores || []).flatMap((s) => s.terminals.map((x) => [x.id, x]))), [ctx]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  // Lo que la lista del POS no trae (cliente, montura, lentes, economía) llega de la analítica y se une por venta.
  const details = useSaleDetails(sales, { store });
  const rows = useMemo(() => sales.map((s) => mergeSaleDetails(s, details.map.get(s.id))), [sales, details.map]);
  const hasEcon = rows.some((r) => r.cost != null || r.profit != null);
  const hasCommission = rows.some((r) => r.commission != null);

  // Resumen ejecutivo del acordeón: cuántas, cuánto y cuánto queda por cobrar (las anuladas aparte).
  const sums = useMemo(() => {
    const live = rows.filter((s) => s.status !== "voided");
    const sum = (k) => Math.round(live.reduce((a, s) => a + (Number(s[k]) || 0), 0) * 100) / 100;
    const total = sum("total");
    const profit = hasEcon ? sum("profit") : null;
    return {
      n: live.length, voided: rows.length - live.length,
      total, discount: sum("discount"), paid: sum("paid"), balance: sum("balance"),
      cost: hasEcon ? sum("cost") : null, profit, margin_pct: hasEcon && total > 0 ? Math.round((profit / total) * 1000) / 10 : null,
      commission: hasCommission ? sum("commission") : null,
    };
  }, [rows, hasEcon, hasCommission]);
  const summary = [
    { label: t("adm.scr.count"), value: sums.n },
    { label: t("adm.scr.total"), value: money(sums.total, "usd", lang), strong: true },
    sums.balance > 0 ? { label: t("adm.scr.balance"), value: money(sums.balance, "usd", lang), tone: "warn" } : null,
    sums.voided > 0 ? { label: t("adm.scr.voided"), value: sums.voided, tone: "muted" } : null,
  ];

  const statusText = (s) => (s.status === "voided" ? t("adm.pos.sales.st.voided") : s.delivered_at ? t("adm.pos.sales.st.delivered") : t("adm.pos.sales.st.completed"));
  const storeCode = (s) => storeById.get(s.establishment_id)?.code || "";
  // Todas las columnas de una venta; `essential` es lo de serie, el resto se enciende en «Columnas».
  const cols = useMemo(() => [
    { key: "number", header: t("adm.pos.sales.number"), essential: true, width: 12, render: (s) => <b>{s.number}</b> },
    { key: "created_at", header: t("adm.pos.sales.when"), type: "datetime", essential: true, width: 16 },
    { key: "store", header: t("adm.tbl.store"), get: storeCode, hiddenByDefault: !isAll, width: 8 },
    { key: "terminal", header: t("adm.pos.terminal"), get: (s) => termById.get(s.terminal_id)?.code || "", hiddenByDefault: true, width: 8 },
    { key: "seller_code", header: t("adm.pos.sales.seller"), essential: true, width: 8 },
    { key: "customer", header: t("adm.tbl.customer"), essential: true, width: 22 },
    { key: "customer_phone", header: t("adm.tbl.phone"), hiddenByDefault: true, width: 14 },
    { key: "frame_brand", header: t("adm.rpt.col.brand"), get: (s) => s.frame_brand || (s.own_frame ? t("adm.rpt.ownFrame") : ""), essential: true, width: 14 },
    { key: "frame_model", header: t("adm.rpt.col.model"), essential: true, width: 18 },
    { key: "frame_color", header: t("adm.rpt.col.color"), hiddenByDefault: true, width: 12 },
    { key: "frame_sku", header: t("adm.tbl.sku"), hiddenByDefault: true, width: 14, cls: () => "muted" },
    { key: "own_frame", header: t("adm.tbl.ownFrame"), type: "bool", hiddenByDefault: true, width: 8, align: "c" },
    { key: "has_rx", header: t("adm.tbl.rx"), type: "bool", hiddenByDefault: true, width: 8, align: "c" },
    { key: "lens", header: t("adm.tbl.lenses"), get: (s) => (s.lens_summary ? (lang === "en" ? s.lens_summary.en : s.lens_summary.es) || "" : ""), hiddenByDefault: true, width: 26 },
    { key: "items", header: t("adm.tbl.items"), hiddenByDefault: true, width: 36 },
    { key: "total", header: t("adm.pos.price.total"), type: "money", essential: true, width: 11 },
    { key: "discount", header: t("adm.tbl.discount"), type: "money", hiddenByDefault: true, width: 10, render: (s) => (Number(s.discount) > 0 ? `−${money(s.discount, "usd", lang)}` : null), cls: () => "muted" },
    { key: "paid", header: t("adm.tbl.paid"), type: "money", hiddenByDefault: true, width: 11 },
    { key: "balance", header: t("adm.pos.pay.balance"), type: "money", essential: true, width: 11, render: (s) => (s.balance > 0 ? <b className="pos-due">{money(s.balance, "usd", lang)}</b> : null), cls: (s) => (s.balance > 0 ? "neg" : "muted") },
    { key: "promised_on", header: t("adm.tbl.promised"), type: "date", hiddenByDefault: true, width: 11 },
    { key: "delivery", header: t("adm.tbl.delivery"), get: (s) => (s.delivery ? t(s.delivery === "ship" ? "adm.tbl.delivery.ship" : "adm.tbl.delivery.pickup") : ""), hiddenByDefault: true, width: 12 },
    { key: "tray", header: t("adm.tbl.tray"), hiddenByDefault: true, width: 9 },
    ...(hasEcon ? [
      { key: "cost", header: t("adm.tbl.cost"), type: "money", hiddenByDefault: true, width: 11 },
      { key: "profit", header: t("adm.tbl.profit"), type: "money", hiddenByDefault: true, width: 11, cls: (s) => (s.profit == null ? "" : Number(s.profit) < 0 ? "neg" : "pos") },
      { key: "margin_pct", header: t("adm.tbl.margin"), type: "pct", hiddenByDefault: true, width: 8 },
    ] : []),
    ...(hasCommission ? [{ key: "commission", header: t("adm.tbl.commission"), type: "money", hiddenByDefault: true, width: 11 }] : []),
    {
      key: "status", header: t("adm.pos.sales.status"), type: "chip", essential: true, width: 12,
      get: statusText, sortValue: (s) => (s.status === "voided" ? 2 : s.delivered_at ? 1 : 0),
      tone: (s) => (s.status === "voided" ? "bad" : s.delivered_at ? "ok" : "neutral"),
      render: (s) => (
        <>
          <span className={`adm-chip ${s.status === "voided" ? "bad" : s.delivered_at ? "ok" : "neutral"}`}>{statusText(s)}</span>
          {s.void_requested_at && s.status !== "voided" ? <small className="pos-flag"> {t("adm.pos.sales.st.voidAsked")}</small> : null}
        </>
      ),
      text: (s) => `${statusText(s)}${s.void_requested_at && s.status !== "voided" ? ` · ${t("adm.pos.sales.st.voidAsked")}` : ""}`,
    },
  ], [t, lang, isAll, termById, storeById, hasEcon, hasCommission]); // eslint-disable-line react-hooks/exhaustive-deps
  const columns = useColumns("pos-sales", cols);
  const totals = { total: sums.total, discount: sums.discount || null, paid: sums.paid, balance: sums.balance || null, cost: sums.cost, profit: sums.profit, margin_pct: sums.margin_pct, commission: sums.commission };

  // El reporte (PDF, Excel, CSV) lleva las columnas visibles, ni una más ni una menos.
  const report = () => {
    const st = store ? storeById.get(store) : null;
    const scopeName = st ? st.name || st.code : isWeb ? t("adm.rpt.web") : t("adm.rpt.allStores");
    const m = (v) => money(v, "usd", lang);
    return {
      title: t("adm.rpt.salesTitle", { store: scopeName }),
      subtitle: t("adm.tab.possales"),
      store: st ? { code: st.code, name: st.name, color: st.color, address: st.address, phone: st.phone } : null,
      scope: st ? undefined : scopeName,
      kpis: [
        { label: t("adm.pos.price.total"), value: m(sums.total), raw: sums.total, sub: t("adm.ex.so.rows", { n: sums.n }) },
        { label: t("adm.tbl.paid"), value: m(sums.paid), raw: sums.paid },
        { label: t("adm.pos.pay.balance"), value: m(sums.balance), raw: sums.balance, neg: sums.balance > 0 },
        sums.discount > 0 ? { label: t("adm.tbl.discount"), value: m(sums.discount), raw: sums.discount } : null,
        hasEcon ? { label: t("adm.tbl.cost"), value: m(sums.cost), raw: sums.cost } : null,
        hasEcon ? { label: t("adm.tbl.profit"), value: m(sums.profit), raw: sums.profit, neg: sums.profit < 0 } : null,
        hasCommission ? { label: t("adm.tbl.commission"), value: m(sums.commission), raw: sums.commission } : null,
      ],
      tables: [tableSpecFrom(cols, columns.keys, rows, totals, { title: t("adm.scr.sales"), totalsLabel: t("adm.tbl.total"), empty: t("adm.pos.sales.empty"), main: true, rowCls: (r) => (r.status === "voided" ? "voided" : ""), lang, t })],
      landscape: true, lang, t,
      filename: `ventas-tienda-${st?.code || "all"}-${new Date().toISOString().slice(0, 10)}`,
    };
  };

  if (state === "error" && !ctx) return <div className="adm-section"><div className="adm-demo-banner">{t("adm.err.pos.generic")}</div></div>;

  return (
    <div className="adm-section pos">
      <div className="adm-head-row"><h2>{t("adm.tab.possales")}</h2>{who && <StoreFilter me={who} />}</div>
      <p className="adm-sub">{ctx && !ctx.is_admin && ctx.role === "seller" ? t("adm.pos.sales.subSeller") : t("adm.pos.sales.sub")}</p>
      <div className="adm-card pos-filters">
        {/* Filtrar por punto de venta solo tiene sentido si hay más de uno (un vendedor tiene el suyo fijo). */}
        {terminals.length > 1 && (
          <select value={f.terminal} onChange={set("terminal")} aria-label={t("adm.pos.terminal")} title={t("adm.pos.terminal")}>
            <option value="">{t("adm.pos.sales.allTerminals")}</option>
            {terminals.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
          </select>
        )}
        <select value={f.status} onChange={set("status")} aria-label={t("adm.pos.sales.status")} title={t("adm.pos.sales.status")}>
          <option value="">{t("adm.pos.sales.anyStatus")}</option>
          <option value="completed">{t("adm.pos.sales.st.completed")}</option>
          <option value="voided">{t("adm.pos.sales.st.voided")}</option>
        </select>
        <label className="pos-check"><input type="checkbox" checked={f.with_balance} onChange={set("with_balance")} /> {t("adm.pos.sales.withBalance")}</label>
        <input value={f.number} onChange={set("number")} placeholder={t("adm.pos.sales.number")} aria-label={t("adm.pos.sales.number")} />
        <div className="pos-cust-filter">
          {customer ? (
            <span className="pos-picked">{[customer.first_name, customer.last_name].filter(Boolean).join(" ")} <button type="button" className="btn-xs" onClick={() => setCustomer(null)} aria-label={t("adm.ord.clear")}><Icon name="close" size={12} /></button></span>
          ) : (
            <input value={custQ} onChange={(e) => setCustQ(e.target.value)} placeholder={t("adm.pos.sales.customer")} aria-label={t("adm.pos.sales.customer")} />
          )}
          {custHits.length > 0 && !customer && (
            <ul className="pos-hits">
              {custHits.map((c) => <li key={c.id}><button type="button" onClick={() => { setCustomer(c); setCustQ(""); setCustHits([]); }}><b>{[c.first_name, c.last_name].filter(Boolean).join(" ")}</b> <small className="muted">{c.phone}</small></button></li>)}
            </ul>
          )}
        </div>
      </div>
      <Accordion id="possales" icon="receipt" title={t("adm.scr.sales")} summary={summary} defaultOpen bodyClassName="scr-acc-table">
        <DataTable
          id="pos-sales" cols={cols} columns={columns} rows={rows} rowKey="id" totals={totals} totalsLabel={t("adm.tbl.total")}
          defaultSort={{ key: "created_at", dir: "desc" }} loading={state === "loading"} emptyText={t("adm.pos.sales.empty")} emptyIcon="receipt"
          onRowClick={(s) => sp.open(s.id)} rowTitle={t("adm.sd.openHint")} activeKey={sp.saleId} rowClass={(s) => (s.status === "voided" ? "muted" : "")}
          maxHeight="62vh" dense
          right={<ExportMenu title={t("adm.tab.possales")} name="ventas-tienda" report={report} />}
        >
          {details.status === "loading" && <span className="dt-loading">{t("adm.tbl.completing")}</span>}
          {(details.status === "partial" || details.status === "error") && <span className="dt-loading" title={t("adm.tbl.partial")}>{t("adm.tbl.partial")}</span>}
        </DataTable>
      </Accordion>
      {sp.panel}
    </div>
  );
}

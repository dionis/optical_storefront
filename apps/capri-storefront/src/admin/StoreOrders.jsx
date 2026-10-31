// Dónde se usa: Ejecutivo → acordeón «Pedidos de la tienda» (embedded) y, para
// quien administra una tienda, la pestaña "storeorders" (standalone). La lista
// de todo lo vendido en el período para la tienda elegida con lo que el dueño
// quiere leer de cada venta: precio, descuento, lo que le costó a la tienda,
// comisión, ganancia, margen, cobrado y saldo. Backend:
// GET /admin/sales-analytics/sales (cost/fee/profit vienen null si el servidor
// decide que no se pueden ver — aquí no se oculta nada por cuenta propia).
import { useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { adminFetch } from "./adminApi.js";
import { isDemoLogin } from "./adminAuth.js";
import { money as fmtMoney } from "./adminOrders.js";
import { ExportMenu } from "./ui.jsx";
import StoreFilter, { useStoreFilter } from "./StoreFilter.jsx";
import { periodRange } from "./SalesBoard.jsx";
import { useSalePanel } from "./SaleDetailPanel.jsx";
import "./exec.css";

export const PERIODS = ["today", "yesterday", "week", "lastWeek", "month", "lastMonth", "year", "range"];
/** Pages of 100 sales read for one list: beyond it the panel says `truncated`. */
const MAX_PAGES = 10;

const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Local Date bounds of a "YYYY-MM-DD" range (what analytics.js / realAnalytics.js take). */
export const datesOf = ({ from, to }) => ({ from: new Date(`${from}T00:00:00`), to: new Date(`${to}T23:59:59.999`) });
export const pct = (v) => (v == null || Number.isNaN(Number(v)) ? "—" : `${Math.round(Number(v) * 10) / 10}%`);

/** Período (chips + desde/hasta) compartido por el Ejecutivo y la lista en solitario. */
export function usePeriod(initial = "month") {
  const [period, setPeriod] = useState(initial);
  const [range, setRange] = useState(() => periodRange(initial));
  const pick = (p) => { setPeriod(p); if (p !== "range") setRange(periodRange(p)); };
  const setDate = (k, v) => { if (!v) return; setPeriod("range"); setRange((r) => ({ ...r, [k]: v })); };
  return { period, range, pick, setDate };
}

export function PeriodBar({ period, range, pick, setDate }) {
  const { t } = useLang();
  return (
    <>
      <div className="ex-chips" role="group" aria-label={t("adm.ex.period")}>
        {PERIODS.map((p) => <button key={p} type="button" className={period === p ? "on" : ""} onClick={() => pick(p)}>{t(`adm.ex.period.${p}`)}</button>)}
      </div>
      <span className="ex-dates">
        <input type="date" value={range.from} max={range.to} aria-label={t("adm.ex.from")} title={t("adm.ex.from")} onChange={(e) => setDate("from", e.target.value)} />
        –
        <input type="date" value={range.to} min={range.from} aria-label={t("adm.ex.to")} title={t("adm.ex.to")} onChange={(e) => setDate("to", e.target.value)} />
      </span>
    </>
  );
}

/** Suma de la lista: la fila en negrita del final y las pastillas del acordeón. */
export function salesTotals(rows) {
  const t = { count: 0, units: 0, total: 0, discount: 0, net: 0, cost: 0, commission: 0, profit: 0, paid: 0, balance: 0, hasEcon: false, hasCommission: false, missing: 0 };
  for (const r of rows) {
    if (r.status === "voided") continue;
    t.count += 1;
    t.units += Number(r.units) || 0;
    t.total += Number(r.total) || 0;
    t.discount += Number(r.discount) || 0;
    t.paid += Number(r.paid) || 0;
    t.balance += Number(r.balance) || 0;
    if (r.profit != null) {
      t.hasEcon = true;
      t.net += Number(r.net) || 0;
      t.cost += (Number(r.cost) || 0) + (Number(r.fee) || 0);
      t.profit += Number(r.profit) || 0;
      if (r.missing_cost) t.missing += 1;
    }
    if (r.commission != null) { t.hasCommission = true; t.commission += Number(r.commission) || 0; }
  }
  t.margin_pct = t.hasEcon && t.net > 0 ? (t.profit / t.net) * 100 : null;
  return t;
}

/**
 * Las ventas del período para la(s) tienda(s): todas las páginas (hasta
 * MAX_PAGES). `storeId`: "all" | "web" | id de establecimiento.
 */
export function useStoreSales({ from, to, storeId }, enabled = true) {
  const [data, setData] = useState({ rows: [], access: null, state: "idle", truncated: false });
  const demo = isDemoLogin();
  useEffect(() => {
    if (!enabled || demo || !from || !to || from > to) { setData((d) => ({ ...d, state: demo ? "demo" : "idle" })); return undefined; }
    let on = true;
    setData((d) => ({ ...d, state: "loading" }));
    (async () => {
      const rows = [];
      let access = null;
      let truncated = false;
      for (let page = 0; page < MAX_PAGES; page++) {
        const q = { from, to, page };
        if (storeId && storeId !== "all") q.stores = storeId;
        const r = await adminFetch("/admin/sales-analytics/sales", { query: q });
        rows.push(...(r.sales || []));
        access = r.access || access;
        if (!r.has_more) break;
        if (page === MAX_PAGES - 1) truncated = true;
      }
      if (on) setData({ rows, access, state: "ok", truncated });
    })().catch(() => { if (on) setData({ rows: [], access: null, state: "error", truncated: false }); });
    return () => { on = false; };
  }, [from, to, storeId, enabled, demo]);
  const totals = useMemo(() => salesTotals(data.rows), [data.rows]);
  return { ...data, totals };
}

const costOf = (r) => (r.cost == null ? null : (Number(r.cost) || 0) + (Number(r.fee) || 0));

/** Hojas del Excel de la lista (también las usa el Ejecutivo en su libro). */
export function salesSheets(rows, totals, { t, lang, storeLabel }) {
  const m = (v) => (v == null ? "" : Number(v));
  return [{
    name: t("adm.ex.so.sheet"),
    cols: [
      { header: t("adm.ex.so.number"), get: (r) => r.number || (r.channel === "web" ? `${t("adm.ex.so.web")} ${r.order_id.slice(-6)}` : r.order_id), width: 16 },
      { header: t("adm.ex.so.date"), get: (r) => new Date(r.sold_at).toLocaleString(lang === "en" ? "en-US" : "es-US", { dateStyle: "short", timeStyle: "short" }), width: 18 },
      { header: t("adm.ex.so.store"), get: (r) => storeLabel(r), width: 16 },
      { header: t("adm.ex.so.customer"), key: "customer", width: 24 },
      { header: t("adm.ex.so.seller"), key: "seller_code", width: 10 },
      { header: t("adm.ex.so.items"), key: "items", width: 40 },
      { header: t("adm.ex.so.price"), key: "total", type: "money" },
      { header: t("adm.ex.so.discount"), key: "discount", type: "money" },
      { header: t("adm.ex.so.cost"), get: (r) => m(costOf(r)), key: "cost", type: "money" },
      { header: t("adm.ex.so.commission"), get: (r) => m(r.commission), key: "commission", type: "money" },
      { header: t("adm.ex.so.profit"), get: (r) => m(r.profit), key: "profit", type: "money" },
      { header: t("adm.ex.so.margin"), get: (r) => (r.margin_pct == null ? "" : Number(r.margin_pct)), key: "margin_pct", type: "pct" },
      { header: t("adm.ex.so.paid"), key: "paid", type: "money" },
      { header: t("adm.ex.so.balance"), key: "balance", type: "money" },
      { header: t("adm.ex.so.status"), get: (r) => t(`adm.ex.so.status.${r.status === "voided" ? "voided" : "active"}`), width: 10 },
    ],
    rows,
    totals: {
      total: totals.total, discount: totals.discount, paid: totals.paid, balance: totals.balance,
      ...(totals.hasEcon ? { cost: totals.cost, profit: totals.profit, margin_pct: totals.margin_pct == null ? "" : totals.margin_pct } : {}),
      ...(totals.hasCommission ? { commission: totals.commission } : {}),
    },
    totalsLabel: t("adm.ex.so.total"),
  }];
}

/**
 * La tabla. `data` viene de useStoreSales (el Ejecutivo la comparte con sus
 * KPI); en solitario la carga ella misma. Pulsar una venta de tienda abre su
 * ficha (SaleDetailPanel) con la economía de la fila; `onOpen`, si se pasa,
 * sustituye ese comportamiento. Un pedido de la web no tiene ficha de venta.
 */
export function StoreOrdersTable({ data, storeLabel, onOpen, compact = false, me }) {
  const { t, lang } = useLang();
  const { rows, access, state, truncated, totals } = data;
  const sp = useSalePanel({ me });
  const m = (v) => fmtMoney(v, "usd", lang);
  const when = (iso) => new Date(iso).toLocaleString(lang === "en" ? "en-US" : "es-US", { dateStyle: "short", timeStyle: "short" });
  const showEcon = access?.profit === true;
  const showCommission = access?.commission === true;
  const hidden = <span className="muted" title={t("adm.ex.so.hiddenHint")}>{t("adm.ex.so.hidden")}</span>;
  const onRow = typeof onOpen === "function" ? onOpen : (r) => (r.sale_id ? sp.open(r.sale_id, { economics: r }) : null);
  const clickable = (r) => typeof onOpen === "function" || Boolean(r.sale_id);
  if (state === "loading" && !rows.length) return <div className="adm-skel" style={{ height: 120 }} />;
  if (state === "error") return <div className="adm-demo-banner">{t("adm.ex.loadFailed")}</div>;
  if (state === "demo") return <div className="adm-demo-banner">{t("adm.ex.demo")}</div>;
  if (!rows.length) return <div className="adm-nodata">{t("adm.ex.so.empty")}</div>;
  return (
    <div className={`adm-table-wrap so-wrap ${compact ? "compact" : ""}`}>
      {truncated && <div className="adm-demo-banner">{t("adm.ex.truncated")}</div>}
      <table className="adm-table responsive so-table">
        <thead>
          <tr>
            <th>{t("adm.ex.so.number")}</th>
            <th>{t("adm.ex.so.date")}</th>
            <th>{t("adm.ex.so.customer")}</th>
            <th>{t("adm.ex.so.seller")}</th>
            <th className="so-items">{t("adm.ex.so.items")}</th>
            <th className="r">{t("adm.ex.so.price")}</th>
            <th className="r">{t("adm.ex.so.discount")}</th>
            <th className="r">{t("adm.ex.so.cost")}</th>
            <th className="r">{t("adm.ex.so.commission")}</th>
            <th className="r">{t("adm.ex.so.profit")}</th>
            <th className="r">{t("adm.ex.so.margin")}</th>
            <th className="r">{t("adm.ex.so.paid")}</th>
            <th className="r">{t("adm.ex.so.balance")}</th>
            <th>{t("adm.ex.so.status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const voided = r.status === "voided";
            const profit = r.profit == null ? null : Number(r.profit);
            return (
              <tr key={r.order_id} className={`${clickable(r) ? "ord-row sd-open-row" : ""} ${sp.saleId && sp.saleId === r.sale_id ? "sd-current" : ""} ${voided ? "so-voided" : ""}`} onClick={clickable(r) ? () => onRow(r) : undefined} title={clickable(r) ? t("adm.sd.openHint") : undefined}>
                <td data-label={t("adm.ex.so.number")}><b>{r.number || `${t("adm.ex.so.web")} ${r.order_id.slice(-6)}`}</b>{storeLabel && <small className="muted so-store"> · {storeLabel(r)}</small>}</td>
                <td data-label={t("adm.ex.so.date")}>{when(r.sold_at)}</td>
                <td data-label={t("adm.ex.so.customer")}>{r.customer || "—"}</td>
                <td data-label={t("adm.ex.so.seller")}>{r.seller_code ? <span className="adm-chip gold">{r.seller_code}</span> : <span className="muted">—</span>}</td>
                <td data-label={t("adm.ex.so.items")} className="so-items" title={r.items}>{r.items || "—"}</td>
                <td data-label={t("adm.ex.so.price")} className="r num"><b>{m(r.total)}</b></td>
                <td data-label={t("adm.ex.so.discount")} className="r num muted">{Number(r.discount) > 0 ? `−${m(r.discount)}` : "—"}</td>
                <td data-label={t("adm.ex.so.cost")} className="r num">{showEcon ? (costOf(r) == null ? "—" : m(costOf(r))) : hidden}{showEcon && r.missing_cost && <span className="adm-chip warn so-warn" title={t("adm.ex.so.missingCost")}><Icon name="alert" size={10} /></span>}</td>
                <td data-label={t("adm.ex.so.commission")} className="r num">{showCommission ? (r.commission == null ? "—" : m(r.commission)) : hidden}</td>
                <td data-label={t("adm.ex.so.profit")} className="r num">{showEcon ? (profit == null ? "—" : <b className={profit < 0 ? "neg" : "pos"}>{m(profit)}</b>) : hidden}</td>
                <td data-label={t("adm.ex.so.margin")} className="r num">{showEcon ? <span className={`margin-pct ${r.margin_pct == null ? "" : r.margin_pct >= 30 ? "good" : r.margin_pct >= 15 ? "mid" : "bad"}`}>{pct(r.margin_pct)}</span> : hidden}</td>
                <td data-label={t("adm.ex.so.paid")} className="r num">{m(r.paid)}</td>
                <td data-label={t("adm.ex.so.balance")} className="r num">{Number(r.balance) > 0 ? <b className="neg">{m(r.balance)}</b> : <span className="muted">—</span>}</td>
                <td data-label={t("adm.ex.so.status")}><span className={`adm-chip ${voided ? "bad" : "ok"}`}>{t(`adm.ex.so.status.${voided ? "voided" : "active"}`)}</span></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="so-total">
            <td data-label={t("adm.ex.so.total")} colSpan="4"><b>{t("adm.ex.so.total")}</b> <small className="muted">{t("adm.ex.so.rows", { n: totals.count })}</small></td>
            <td className="so-items muted">{totals.units}</td>
            <td data-label={t("adm.ex.so.price")} className="r num"><b>{m(totals.total)}</b></td>
            <td data-label={t("adm.ex.so.discount")} className="r num">{totals.discount > 0 ? `−${m(totals.discount)}` : "—"}</td>
            <td data-label={t("adm.ex.so.cost")} className="r num">{showEcon && totals.hasEcon ? <b>{m(totals.cost)}</b> : hidden}</td>
            <td data-label={t("adm.ex.so.commission")} className="r num">{showCommission && totals.hasCommission ? <b>{m(totals.commission)}</b> : hidden}</td>
            <td data-label={t("adm.ex.so.profit")} className="r num">{showEcon && totals.hasEcon ? <b className={totals.profit < 0 ? "neg" : "pos"}>{m(totals.profit)}</b> : hidden}</td>
            <td data-label={t("adm.ex.so.margin")} className="r num">{showEcon && totals.hasEcon ? <b>{pct(totals.margin_pct)}</b> : hidden}</td>
            <td data-label={t("adm.ex.so.paid")} className="r num"><b>{m(totals.paid)}</b></td>
            <td data-label={t("adm.ex.so.balance")} className="r num"><b className={totals.balance > 0 ? "neg" : ""}>{m(totals.balance)}</b></td>
            <td />
          </tr>
        </tfoot>
      </table>
      {sp.panel}
    </div>
  );
}

/** Etiqueta de tienda de una venta a partir de las tiendas de useStoreFilter. */
export function storeLabelFor(stores, t) {
  const byId = new Map((stores || []).map((s) => [s.id, s]));
  return (r) => {
    if (r.channel === "web") return t("adm.ex.so.web");
    const s = byId.get(r.establishment_id);
    return s ? s.code || s.name : r.establishment_id || "—";
  };
}

/**
 * Standalone (pestaña "storeorders"): tienda, período y exportación propios.
 * `embedded` lo monta el Ejecutivo con `data` ya cargada y sin cabecera.
 */
export default function StoreOrders({ me, go, embedded = false, data: given, storeLabel: givenLabel, openSale }) {
  const { t, lang } = useLang();
  const sf = useStoreFilter(me);
  const per = usePeriod("month");
  const own = useStoreSales({ from: per.range.from, to: per.range.to, storeId: sf.storeId }, !embedded);
  const data = embedded && given ? given : own;
  const storeLabel = givenLabel || storeLabelFor(sf.stores, t);
  const ref = useRef(null);
  // `openSale(row, go)` abre una venta cuando la pestaña de Ventas acepte una búsqueda por número.
  const onOpen = typeof openSale === "function" ? (r) => openSale(r, go) : undefined;
  if (embedded) return <StoreOrdersTable data={data} storeLabel={sf.isAll ? storeLabel : null} onOpen={onOpen} compact me={me} />;
  const scope = sf.isAll ? t("adm.ex.scope.all") : sf.isWeb ? t("adm.ex.scope.web") : `${sf.store?.code || ""} ${sf.store?.name || ""}`.trim();
  const meta = `${scope} · ${per.range.from} → ${per.range.to}`;
  return (
    <div className="adm-section ex-root so-root">
      <div className="ex-head">
        <h2>{t("adm.ex.so.title")}</h2>
        <p>{t("adm.ex.so.sub")}</p>
      </div>
      <div className="ex-bar adm-noprint">
        <StoreFilter me={me} compact />
        <PeriodBar {...per} />
        <span className="ex-export">
          <ExportMenu targetRef={ref} title={t("adm.ex.so.title")} name={t("adm.ex.so.exportName")} compact={false} meta={meta}
            xlsx={() => ({ filename: `${t("adm.ex.so.exportName")}-${per.range.from}-${per.range.to}.xlsx`, sheets: salesSheets(data.rows, data.totals, { t, lang, storeLabel }) })}
            csv={{ cols: [[t("adm.ex.so.number"), "number"], [t("adm.ex.so.date"), "sold_at"], [t("adm.ex.so.customer"), "customer"], [t("adm.ex.so.seller"), "seller_code"], [t("adm.ex.so.items"), "items"], [t("adm.ex.so.price"), "total"], [t("adm.ex.so.discount"), "discount"], [t("adm.ex.so.cost"), "cost"], [t("adm.ex.so.commission"), "commission"], [t("adm.ex.so.profit"), "profit"], [t("adm.ex.so.margin"), "margin_pct"], [t("adm.ex.so.paid"), "paid"], [t("adm.ex.so.balance"), "balance"], [t("adm.ex.so.status"), "status"]], rows: data.rows }} />
        </span>
      </div>
      <div ref={ref}>
        <StoreOrdersTable data={data} storeLabel={sf.isAll ? storeLabel : null} onOpen={onOpen} me={me} />
      </div>
    </div>
  );
}

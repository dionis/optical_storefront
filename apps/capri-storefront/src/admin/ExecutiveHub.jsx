// Dónde se usa: sección Ejecutivo de /admin (pestaña "exec"). La cabina del
// dueño en UNA pantalla: barra fija (tienda · período · desde–hasta · PDF/Excel),
// tira de diez KPI (ventas, nº, unidades, ticket, cobrado, por cobrar, costo
// real, ganancia, margen, efectivo en caja) y acordeones con resumen ejecutivo
// en la cabecera, de modo que todo se lee sin abrir nada: Pedidos de la tienda
// (StoreOrders), Cobros y caja (cash-report), Vendedores (insights por
// vendedor), Costos y margen (ExecutiveCosts), Pedidos web (Executive: el
// tablero online), Catálogo, Resumen y Ventas en detalle (las vistas que
// AdminDashboard pasa en `views`). Nada se pierde del Ejecutivo anterior: se
// reorganiza. Costo y ganancia solo se pintan cuando el servidor los manda
// (`access.profit`); la tienda elegida es la global del panel (useStoreFilter).
//
//   <ExecutiveHub me={me} go={go} sub={nav.params.sub} onSub={onSub} views={{ overview, sales }} />
import { useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { adminFetch } from "./adminApi.js";
import { isDemoLogin } from "./adminAuth.js";
import { money as fmtMoney } from "./adminOrders.js";
import { fetchBoardWindow } from "./realAnalytics.js";
import { useCatalog } from "../data/catalogStore.js";
import { ExportMenu } from "./ui.jsx";
import HelpTip from "./HelpTip.jsx";
import Accordion, { AccordionGroup } from "./Accordion.jsx";
import StoreFilter, { useStoreFilter } from "./StoreFilter.jsx";
import Executive, { CatalogMini } from "./Executive.jsx";
import ExecutiveCosts from "./ExecutiveCosts.jsx";
import { PeriodBar, StoreOrdersTable, datesOf, pct, salesSheets, storeLabelFor, usePeriod, useStoreSales } from "./StoreOrders.jsx";
import "./exec.css";

/** Las pestañas antiguas siguen siendo destinos válidos de go("exec", { sub }): abren su acordeón. */
export const EXEC_TABS = ["sales", "costs", "overview", "detail"];
const SUB_ACC = { sales: "ex-web", costs: "ex-costs", overview: "ex-overview", detail: "ex-detail" };
const CARD_KINDS = new Set(["card", "debit", "credit"]);

const int = (n, lang) => (Number(n) || 0).toLocaleString(lang === "en" ? "en-US" : "es-US");
const cents = (c) => (Number(c) || 0) / 100;

// `help` es el tema de HelpTip: va en la esquina, fuera del botón de "ir a",
// porque un botón no puede contener otro.
function Kpi({ label, value, sub, tone, hint, help, onClick, neg = false, loading = false }) {
  const click = typeof onClick === "function";
  const body = (
    <>
      <small>{label}</small>
      <b className={neg ? "neg" : ""}>{loading ? "0" : value}</b>
      {sub && <i className={tone || ""}>{sub}</i>}
    </>
  );
  return (
    <div className={`ex-kpi ${click ? "click" : ""} ${loading ? "skel" : ""} ${help ? "has-help" : ""}`} title={hint || undefined}>
      {click ? <button type="button" className="ex-kpi-go" onClick={onClick}>{body}</button> : body}
      {help && <HelpTip topic={help} size={12} className="ex-kpi-help" />}
    </div>
  );
}

/** Variación contra el período anterior, como texto corto ("+12%"). */
function delta(cur, prev) {
  if (!prev || !Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  return { text: `${d >= 0 ? "+" : ""}${Math.round(d)}%`, tone: d >= 0 ? "good" : "bad" };
}

export default function ExecutiveHub({ me, go, sub, onSub, views }) {
  const { t, lang } = useLang();
  const demo = isDemoLogin();
  const sf = useStoreFilter(me);
  const isAdmin = !me || me.is_admin !== false;
  const per = usePeriod("month");
  const { from, to } = per.range;
  const dates = useMemo(() => datesOf(per.range), [per.range]);
  const storeId = sf.storeId;
  const physical = !sf.isAll && !sf.isWeb;
  const m = (v) => fmtMoney(v, "usd", lang);
  const storeLabel = useMemo(() => storeLabelFor(sf.stores, t), [sf.stores, t]);

  const [ins, setIns] = useState(null);
  const [cash, setCash] = useState(null);
  const [web, setWeb] = useState(null);
  const [state, setState] = useState(demo ? "demo" : "loading");
  const sales = useStoreSales({ from, to, storeId });
  const { products, cases } = useCatalog();
  const bodyRef = useRef(null);
  const barRef = useRef(null);

  // La barra se pega justo debajo de la cabecera del panel, mida lo que mida.
  useEffect(() => {
    const top = document.querySelector(".adm-top");
    if (!top || !barRef.current) return undefined;
    const apply = () => barRef.current?.style.setProperty("--ex-top", `${top.offsetHeight}px`);
    apply();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    ro?.observe(top);
    return () => ro?.disconnect();
  }, []);

  // Cifras del período: insights (ventas, costo, ganancia, por vendedor) y caja (cobros por método, movimientos).
  useEffect(() => {
    if (demo) return undefined;
    let on = true;
    setState("loading");
    const q = { from, to };
    if (!sf.isAll) q.stores = storeId;
    const cq = { from, to };
    if (physical) cq.establishment_id = storeId;
    Promise.all([
      adminFetch("/admin/sales-analytics/insights", { query: { ...q, by: "seller" } }),
      sf.isWeb ? Promise.resolve(null) : adminFetch("/admin/pos/cash-report", { query: cq }).catch(() => null),
    ])
      .then(([a, c]) => { if (on) { setIns(a); setCash(c); setState("ok"); } })
      .catch(() => { if (on) setState("error"); });
    return () => { on = false; };
  }, [from, to, storeId, sf.isAll, sf.isWeb, physical, demo]);

  // La tienda online: el mismo tablero que pinta Executive (cacheado), para las pastillas de su acordeón.
  const showWeb = isAdmin && (sf.isAll || sf.isWeb);
  useEffect(() => {
    if (demo || !showWeb) { setWeb(null); return undefined; }
    let on = true;
    fetchBoardWindow({ from: dates.from, to: dates.to, store: "web" }).then((w) => { if (on) setWeb(w); }).catch(() => { if (on) setWeb(null); });
    return () => { on = false; };
  }, [dates, showWeb, demo]);

  const tot = ins?.totals || {};
  const prev = ins?.previous || {};
  const access = ins?.access || sales.access || {};
  const showProfit = access.profit === true;
  const showCommission = access.commission === true;
  const loading = state === "loading" && !ins;
  const cashTot = cash?.totals;
  const realCost = showProfit ? (Number(tot.cost) || 0) + (Number(tot.fee) || 0) : null;

  // Vendedores (insights por vendedor): nombre, ventas, nº, ganancia, comisión.
  const sellerRows = useMemo(() => (ins?.rows || []).map((r) => ({ ...r, name: r.key ? r.label || r.key : t("adm.ex.sellers.none") })), [ins, t]);
  const topSeller = sellerRows.find((r) => r.key);

  // Pedidos web: etapas del tablero online.
  const webOps = useMemo(() => {
    const out = { n: 0, toPrepare: 0, inDelivery: 0, total: 0 };
    for (const o of web?.orders || []) {
      if (o.terminal) continue;
      out.n += 1;
      out.total += Number(o.total) || 0;
      if (o.stage === "confirmed" || o.stage === "in_lab") out.toPrepare += 1;
      if (o.stage === "shipped" || o.stage === "in_transit") out.inDelivery += 1;
    }
    return out;
  }, [web]);

  // Caja: por método, agrupado como el informe (efectivo · tarjetas · Zelle · otros).
  const byMethod = useMemo(() => {
    const g = { cash: 0, cards: 0, zelle: 0, other: 0 };
    for (const r of cash?.by_method || []) {
      if (r.counts_as_cash) g.cash += r.net_cents;
      else if (CARD_KINDS.has(r.kind)) g.cards += r.net_cents;
      else if (r.code === "zelle") g.zelle += r.net_cents;
      else g.other += r.net_cents;
    }
    return g;
  }, [cash]);
  const methodLabel = (row) => (row.builtin ? t(`adm.pos.method.${row.code}`) : (lang === "en" && row.label?.en) || row.label?.es || row.label?.en || row.code);
  const when = (iso) => (iso ? new Date(iso).toLocaleString(lang === "en" ? "en-US" : "es-US", { dateStyle: "short", timeStyle: "short" }) : "—");

  const scopeText = sf.isAll ? t("adm.ex.scope.all") : sf.isWeb ? t("adm.ex.scope.web") : `${sf.store?.code || ""} · ${sf.store?.name || ""}`;
  const meta = `${scopeText} · ${from} → ${to}`;
  const title = t("adm.ex.title");

  // Sub-pestaña antigua → su acordeón abierto; al abrirlo a mano, la URL lo recuerda.
  const forced = SUB_ACC[sub];
  const openOf = (id) => (forced === id ? true : undefined);
  const toggled = (key) => (open) => { if (open) onSub?.(key); };

  const beforePrint = () => {
    // El PDF lleva todas las secciones: se abren para el clon y se devuelven.
    const details = [...(bodyRef.current?.querySelectorAll("details") || [])];
    const was = details.map((d) => d.open);
    details.forEach((d) => { d.open = true; });
    return () => details.forEach((d, i) => { d.open = was[i]; });
  };
  const xlsx = () => {
    const kpis = [
      [t("adm.ex.kpi.sales"), tot.sales], [t("adm.ex.kpi.count"), tot.count], [t("adm.ex.kpi.units"), tot.units], [t("adm.ex.kpi.ticket"), tot.avg_ticket],
      [t("adm.ex.kpi.paid"), sales.totals.paid], [t("adm.ex.kpi.balance"), sales.totals.balance],
      ...(showProfit ? [[t("adm.ex.kpi.cost"), realCost], [t("adm.ex.kpi.profit"), tot.profit], [t("adm.ex.kpi.margin"), tot.margin_pct]] : []),
      ...(cashTot ? [[t("adm.ex.kpi.cashNet"), cents(cashTot.cash_net_cents)]] : []),
    ];
    const sheets = [
      { name: t("adm.ex.export.kpis"), cols: [{ header: t("adm.ex.export.kpi"), key: "label", width: 30 }, { header: t("adm.ex.export.value"), key: "value", type: "money", width: 16 }], rows: [{ label: t("adm.ex.period"), value: meta }, ...kpis.map(([label, value]) => ({ label, value: value ?? "" }))] },
      ...salesSheets(sales.rows, sales.totals, { t, lang, storeLabel }),
      {
        name: t("adm.ex.export.sellers"),
        cols: [
          { header: t("adm.ex.sellers.name"), key: "name", width: 24 }, { header: t("adm.ex.sellers.sales"), key: "sales", type: "money" }, { header: t("adm.ex.sellers.count"), key: "count", type: "int" },
          { header: t("adm.ex.sellers.units"), key: "units", type: "int" },
          ...(showProfit ? [{ header: t("adm.ex.sellers.profit"), key: "profit", type: "money" }] : []),
          ...(showCommission ? [{ header: t("adm.ex.sellers.commission"), key: "commission", type: "money" }] : []),
          { header: t("adm.ex.sellers.share"), key: "share", type: "pct" },
        ],
        rows: sellerRows,
      },
      ...(cash ? [{
        name: t("adm.ex.export.cash"),
        cols: [{ header: t("adm.ex.cash.method"), get: methodLabel, width: 22 }, { header: t("adm.ex.cash.count"), key: "in_count", type: "int" }, { header: t("adm.ex.cash.collected"), get: (r) => cents(r.in_cents), type: "money" }, { header: t("adm.ex.cash.refunds"), get: (r) => cents(r.refund_cents), type: "money" }, { header: t("adm.ex.cash.fee"), get: (r) => cents(r.fee_cents), type: "money" }, { header: t("adm.ex.cash.net"), get: (r) => cents(r.net_cents), type: "money" }],
        rows: cash.by_method,
      }] : []),
    ];
    return { filename: `${t("adm.ex.export.name")}-${from}-${to}.xlsx`, sheets };
  };

  const dSales = delta(tot.sales, prev.sales);
  const dProfit = delta(tot.profit, prev.profit);
  const missing = sales.totals.missing;

  return (
    <div className="adm-section ex-root adm-exec-hub">
      <div className="ex-head">
        <h2>{title}<HelpTip topic="exec.overview" size={16} /></h2>
        <p>{t("adm.ex.sub")}</p>
      </div>

      <div className={`ex-bar adm-noprint ${state === "loading" ? "busy" : ""}`} ref={barRef}>
        <StoreFilter me={me} compact />
        <HelpTip topic="exec.storeFilter" />
        <PeriodBar {...per} />
        <HelpTip topic="exec.period" />
        <span className="ex-export">
          <ExportMenu targetRef={bodyRef} title={title} name={t("adm.ex.export.name")} compact={false} meta={meta} xlsx={xlsx} beforePrint={beforePrint} />
        </span>
        {state === "error" && <span className="ex-note err">{t("adm.ex.loadFailed")}</span>}
      </div>

      <div ref={bodyRef}>
        {demo && <div className="adm-demo-banner">{t("adm.ex.demo")}</div>}

        <div className="ex-kpis">
          <Kpi label={t("adm.ex.kpi.sales")} value={m(tot.sales)} sub={dSales ? `${dSales.text} ${t("adm.ex.kpi.vsPrev")}` : undefined} tone={dSales?.tone} hint={t("adm.ex.kpi.h.sales")} help="exec.kpi.sales" loading={loading} onClick={() => go("salesboard")} />
          <Kpi label={t("adm.ex.kpi.count")} value={int(tot.count, lang)} hint={t("adm.ex.kpi.h.count")} loading={loading} onClick={() => go("possales")} />
          <Kpi label={t("adm.ex.kpi.units")} value={int(tot.units, lang)} hint={t("adm.ex.kpi.h.units")} loading={loading} />
          <Kpi label={t("adm.ex.kpi.ticket")} value={m(tot.avg_ticket)} hint={t("adm.ex.kpi.h.ticket")} loading={loading} />
          <Kpi label={t("adm.ex.kpi.paid")} value={m(sales.totals.paid)} hint={t("adm.ex.kpi.h.paid")} help="exec.kpi.collected" loading={sales.state === "loading" && !sales.rows.length} onClick={isAdmin || physical ? () => go("cash") : undefined} />
          <Kpi label={t("adm.ex.kpi.balance")} value={m(sales.totals.balance)} neg={sales.totals.balance > 0} hint={t("adm.ex.kpi.h.balance")} help="exec.kpi.balance" loading={sales.state === "loading" && !sales.rows.length} onClick={() => go("possales")} />
          {showProfit && <Kpi label={t("adm.ex.kpi.cost")} value={m(realCost)} sub={missing ? t("adm.ex.kpi.missing", { n: missing }) : undefined} tone="warn" hint={t("adm.ex.kpi.h.cost")} help="exec.kpi.cost" loading={loading} onClick={isAdmin ? () => go("costs", { sub: "rules" }) : undefined} />}
          {showProfit && <Kpi label={t("adm.ex.kpi.profit")} value={m(tot.profit)} neg={Number(tot.profit) < 0} sub={dProfit ? `${dProfit.text} ${t("adm.ex.kpi.vsPrev")}` : undefined} tone={dProfit?.tone} hint={t("adm.ex.kpi.h.profit")} help="exec.kpi.profit" loading={loading} onClick={isAdmin ? () => go("costs", { sub: "profit" }) : undefined} />}
          {showProfit && <Kpi label={t("adm.ex.kpi.margin")} value={pct(tot.margin_pct)} hint={t("adm.ex.kpi.h.margin")} help="exec.kpi.margin" loading={loading} />}
          {!sf.isWeb && <Kpi label={t("adm.ex.kpi.cashNet")} value={cashTot ? m(cents(cashTot.cash_net_cents)) : "—"} neg={cashTot ? cashTot.cash_net_cents < 0 : false} hint={t("adm.ex.kpi.h.cashNet")} help="exec.cash" loading={loading} onClick={() => go("cash")} />}
        </div>

        <AccordionGroup>
          <Accordion id="ex-orders" icon="receipt" title={t("adm.ex.acc.orders")} subtitle={t("adm.ex.acc.ordersSub")} badge={sales.totals.count || null} right={<HelpTip topic="exec.orders" />}
            summary={[
              { label: t("adm.ex.pill.sales"), value: m(sales.totals.total), strong: true },
              { label: t("adm.ex.pill.paid"), value: m(sales.totals.paid) },
              sales.totals.balance > 0 ? { label: t("adm.ex.pill.balance"), value: m(sales.totals.balance), tone: "bad" } : null,
              showProfit && sales.totals.hasEcon ? { label: t("adm.ex.pill.profit"), value: m(sales.totals.profit), tone: sales.totals.profit < 0 ? "bad" : "good" } : null,
              showProfit && sales.totals.hasEcon ? { label: t("adm.ex.pill.margin"), value: pct(sales.totals.margin_pct) } : null,
            ]}>
            <StoreOrdersTable data={sales} storeLabel={sf.isAll ? storeLabel : null} compact />
          </Accordion>

          {!sf.isWeb && (
            <Accordion id="ex-cash" icon="wallet" title={t("adm.ex.acc.cash")} subtitle={t("adm.ex.acc.cashSub")} right={<HelpTip topic="exec.cash" />}
              summary={cashTot ? [
                { label: t("adm.ex.pill.cash"), value: m(cents(byMethod.cash)), strong: true },
                { label: t("adm.ex.pill.cards"), value: m(cents(byMethod.cards)) },
                { label: t("adm.ex.pill.zelle"), value: m(cents(byMethod.zelle)) },
                byMethod.other ? { label: t("adm.ex.pill.other"), value: m(cents(byMethod.other)) } : null,
                { label: t("adm.ex.pill.in"), value: m(cents(cashTot.movements_in_cents)), tone: "good" },
                { label: t("adm.ex.pill.out"), value: m(cents(cashTot.movements_out_cents)), tone: cashTot.movements_out_cents > 0 ? "bad" : "muted" },
                { label: t("adm.ex.pill.net"), value: m(cents(cashTot.cash_net_cents)), strong: true, tone: cashTot.cash_net_cents < 0 ? "bad" : undefined },
              ] : [{ label: "", value: t("adm.ex.pill.noCash"), tone: "muted" }]}>
              {!cash ? <div className="adm-nodata">{t("adm.ex.cash.noPayments")}</div> : (
                <div className="ex-two">
                  <div>
                    <h4>{t("adm.ex.cash.method")}</h4>
                    {!cash.by_method?.length ? <div className="adm-nodata">{t("adm.ex.cash.noPayments")}</div> : (
                      <div className="adm-table-wrap">
                        <table className="adm-table dense responsive">
                          <thead><tr><th>{t("adm.ex.cash.method")}</th><th className="r">{t("adm.ex.cash.count")}</th><th className="r">{t("adm.ex.cash.collected")}</th><th className="r">{t("adm.ex.cash.refunds")}</th><th className="r">{t("adm.ex.cash.fee")}</th><th className="r">{t("adm.ex.cash.net")}</th></tr></thead>
                          <tbody>
                            {cash.by_method.map((r) => (
                              <tr key={r.code}>
                                <td data-label={t("adm.ex.cash.method")}><b>{methodLabel(r)}</b></td>
                                <td data-label={t("adm.ex.cash.count")} className="r num">{int(r.in_count, lang)}</td>
                                <td data-label={t("adm.ex.cash.collected")} className="r num">{m(cents(r.in_cents))}</td>
                                <td data-label={t("adm.ex.cash.refunds")} className="r num muted">{r.refund_cents ? `−${m(cents(r.refund_cents))}` : "—"}</td>
                                <td data-label={t("adm.ex.cash.fee")} className="r num muted">{r.fee_cents ? `−${m(cents(r.fee_cents))}` : "—"}</td>
                                <td data-label={t("adm.ex.cash.net")} className="r num"><b>{m(cents(r.net_cents))}</b></td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot><tr><td colSpan="5">{t("adm.ex.so.total")}</td><td className="r num">{m(cents(cashTot.payments_cents))}</td></tr></tfoot>
                        </table>
                      </div>
                    )}
                  </div>
                  <div>
                    <h4>{t("adm.ex.cash.movements")}</h4>
                    {!cash.movements?.length ? <div className="adm-nodata">{t("adm.ex.cash.noMovements")}</div> : (
                      <div className="adm-table-wrap">
                        <table className="adm-table dense responsive">
                          <thead><tr><th>{t("adm.ex.cash.when")}</th><th>{t("adm.ex.cash.kind")}</th><th>{t("adm.ex.cash.reason")}</th><th>{t("adm.ex.cash.who")}</th><th className="r">{t("adm.ex.cash.amount")}</th></tr></thead>
                          <tbody>
                            {cash.movements.slice(0, 8).map((x) => (
                              <tr key={x.id}>
                                <td data-label={t("adm.ex.cash.when")}>{when(x.at)}</td>
                                <td data-label={t("adm.ex.cash.kind")}><span className={`adm-chip ${x.kind === "out" ? "bad" : "ok"}`}>{t(`adm.cash.mv.${x.kind}`)}</span></td>
                                <td data-label={t("adm.ex.cash.reason")}>{t(x.category ? `adm.cash.cat.${x.category}` : "adm.cash.cat.none")}{x.note && <small className="muted"> · {x.note}</small>}</td>
                                <td data-label={t("adm.ex.cash.who")}>{x.by?.name || "—"}</td>
                                <td data-label={t("adm.ex.cash.amount")} className={`r num ${x.kind === "out" ? "neg" : "pos"}`}>{x.kind === "out" ? "−" : "+"}{m(cents(x.amount_cents))}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {cash.movements.length > 8 && <small className="muted">{t("adm.ex.cash.more", { n: cash.movements.length - 8 })}</small>}
                      </div>
                    )}
                    <button type="button" className="ex-link" onClick={() => go("cash")}>{t("adm.ex.cash.openCash")} <Icon name="arrowRight" size={13} /></button>
                  </div>
                </div>
              )}
            </Accordion>
          )}

          <Accordion id="ex-sellers" icon="sellers" title={t("adm.ex.acc.sellers")} subtitle={t("adm.ex.acc.sellersSub")} badge={sellerRows.filter((r) => r.key).length || null}
            summary={[
              topSeller ? { label: t("adm.ex.pill.top"), value: `${topSeller.name} · ${m(topSeller.sales)}`, strong: true } : null,
              showCommission && tot.commission ? { label: t("adm.ex.pill.commission"), value: m(tot.commission) } : null,
              showProfit ? { label: t("adm.ex.pill.profit"), value: m(tot.profit), tone: Number(tot.profit) < 0 ? "bad" : "good" } : null,
            ]}>
            {!sellerRows.length ? <div className="adm-nodata">{t("adm.ex.sellers.empty")}</div> : (
              <div className="adm-table-wrap">
                <table className="adm-table dense responsive">
                  <thead><tr><th>{t("adm.ex.sellers.name")}</th><th className="r">{t("adm.ex.sellers.sales")}</th><th className="r">{t("adm.ex.sellers.count")}</th><th className="r">{t("adm.ex.sellers.units")}</th>{showProfit && <th className="r">{t("adm.ex.sellers.profit")}</th>}{showCommission && <th className="r">{t("adm.ex.sellers.commission")}</th>}<th className="r">{t("adm.ex.sellers.share")}</th></tr></thead>
                  <tbody>
                    {sellerRows.map((r) => (
                      <tr key={r.key ?? "none"} className={isAdmin && r.key ? "ord-row" : ""} onClick={isAdmin && r.key ? () => go("salesboard") : undefined}>
                        <td data-label={t("adm.ex.sellers.name")}><b>{r.name}</b>{r.key && r.label && <small className="muted"> · {r.key}</small>}</td>
                        <td data-label={t("adm.ex.sellers.sales")} className="r num"><b>{m(r.sales)}</b></td>
                        <td data-label={t("adm.ex.sellers.count")} className="r num">{int(r.count, lang)}</td>
                        <td data-label={t("adm.ex.sellers.units")} className="r num">{int(r.units, lang)}</td>
                        {showProfit && <td data-label={t("adm.ex.sellers.profit")} className={`r num ${Number(r.profit) < 0 ? "neg" : ""}`}>{m(r.profit)} <small className="muted">{pct(r.margin_pct)}</small></td>}
                        {showCommission && <td data-label={t("adm.ex.sellers.commission")} className="r num">{m(r.commission)}</td>}
                        <td data-label={t("adm.ex.sellers.share")} className="r num muted">{pct(r.share)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{t("adm.ex.sellers.total")}</td>
                      <td className="r num">{m(tot.sales)}</td>
                      <td className="r num">{int(tot.count, lang)}</td>
                      <td className="r num">{int(tot.units, lang)}</td>
                      {showProfit && <td className="r num">{m(tot.profit)} <small className="muted">{pct(tot.margin_pct)}</small></td>}
                      {showCommission && <td className="r num">{m(tot.commission)}</td>}
                      <td className="r num">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Accordion>

          {isAdmin && showProfit && (
            <Accordion id="ex-costs" icon="costs" title={t("adm.ex.acc.costs")} subtitle={t("adm.ex.acc.costsSub")} open={openOf("ex-costs")} onToggle={toggled("costs")}
              summary={[
                { label: t("adm.ex.pill.cost"), value: m(realCost), strong: true },
                { label: t("adm.ex.pill.profit"), value: m(tot.profit), tone: Number(tot.profit) < 0 ? "bad" : "good" },
                { label: t("adm.ex.pill.margin"), value: pct(tot.margin_pct) },
              ]}>
              <ExecutiveCosts range={dates} store={sf.isAll ? "" : storeId} go={go} />
            </Accordion>
          )}

          {showWeb && (
            <Accordion id="ex-web" icon="globe" title={t("adm.ex.acc.web")} subtitle={t("adm.ex.acc.webSub")} open={openOf("ex-web")} onToggle={toggled("sales")} badge={webOps.n || null}
              summary={web ? [
                { label: t("adm.ex.pill.sales"), value: m(webOps.total), strong: true },
                { label: t("adm.ex.pill.webOrders"), value: int(webOps.n, lang) },
                { label: t("adm.ex.pill.toPrepare"), value: int(webOps.toPrepare, lang), tone: webOps.toPrepare ? "warn" : "muted" },
                { label: t("adm.ex.pill.inDelivery"), value: int(webOps.inDelivery, lang) },
              ] : []}>
              <Executive range={dates} store="web" go={go} compact />
            </Accordion>
          )}

          {isAdmin && (
            <Accordion id="ex-catalog" icon="glasses" title={t("adm.ex.acc.catalog")} subtitle={t("adm.ex.acc.catalogSub")}
              summary={[
                { label: t("adm.ex.pill.frames"), value: int(products.length, lang), strong: true },
                { label: t("adm.ex.pill.cases"), value: int(cases.length, lang) },
                { label: t("adm.ex.pill.brands"), value: int(new Set(products.map((p) => p.brand)).size, lang) },
              ]}>
              <div className="ex-catalog"><CatalogMini go={go} bare /></div>
            </Accordion>
          )}

          {isAdmin && views?.overview && (
            <Accordion id="ex-overview" icon="overview" title={t("adm.ex.acc.overview")} subtitle={t("adm.ex.acc.overviewSub")} open={openOf("ex-overview")} onToggle={toggled("overview")}>
              {views.overview}
            </Accordion>
          )}
          {isAdmin && views?.sales && (
            <Accordion id="ex-detail" icon="sales" title={t("adm.ex.acc.detail")} subtitle={t("adm.ex.acc.detailSub")} open={openOf("ex-detail")} onToggle={toggled("detail")}>
              {views.sales}
            </Accordion>
          )}
        </AccordionGroup>
      </div>
    </div>
  );
}

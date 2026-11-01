// Dónde se usa: pestaña «Mi panel» de /admin — el panel del vendedor (E8) y la
// pantalla con la que arranca un usuario vendedor: su tienda y punto de venta
// (con la caja abierta o no), accesos a vender y a la caja, sus cifras de hoy,
// semana y mes, comisión y meta, sus últimas ventas y los pedidos que volvieron
// del laboratorio (HU-50, HU-52, HU-53); debajo, la lista de sus ventas del
// período (HU-51, GET /admin/sales-analytics/sales) y los cobros pendientes de
// su tienda (PendingBalances). Regla del dueño: el vendedor no ve el estado de
// la tienda — `store_today` solo llega para los demás roles. La tienda y el
// período de la lista son los globales de la barra de filtros del panel (las
// tres tarjetas hoy/semana/mes también lo cambian); la lista se exporta desde
// esa barra.
import { useEffect, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { money, shortDate } from "./adminOrders.js";
import { adminFetch } from "./adminApi.js";
import Accordion from "./Accordion.jsx";
import PendingBalances from "./PendingBalances.jsx";
import { useStoreFilter } from "./StoreFilter.jsx";
import { usePeriodFilter } from "./periodStore.js";
import { menuHandlers, useRegisterExport } from "./GlobalFilterBar.jsx";
import "./screens.css";
import "./roles.css";

const PERIODS = ["today", "week", "month"];
const ZERO = { total: 0, count: 0, avg_ticket: 0 };

/** Las ventas propias del período: número, fecha, cliente, artículos, total, cobrado, saldo y comisión. */
function MySalesList({ me, range, storeParam, openSale }) {
  const { t, lang } = useLang();
  const [rows, setRows] = useState(null);
  const [state, setState] = useState("loading");
  const bodyRef = useRef(null);
  const m = (v) => money(v, "usd", lang);
  useEffect(() => {
    setState("loading");
    const p = new URLSearchParams({ from: range.from, to: range.to });
    // El servidor ya fuerza «solo las mías» a un vendedor; para los demás roles se pide explícitamente.
    if (me?.id) p.set("sellers", me.id);
    if (storeParam) p.set("stores", storeParam);
    adminFetch(`/admin/sales-analytics/sales?${p.toString()}`)
      .then((r) => { setRows((r.sales || []).filter((s) => s.sale_id)); setState("ok"); })
      .catch(() => setState("error"));
  }, [range.from, range.to, storeParam, me?.id]);
  const list = rows || [];
  const sum = (k) => Math.round(list.reduce((a, r) => a + (Number(r[k]) || 0), 0) * 100) / 100;
  const hasCommission = list.some((r) => r.commission != null);
  const cols = [
    { header: t("adm.pb.number"), key: "number" },
    { header: t("adm.pb.date"), get: (r) => r.sold_at.slice(0, 10), type: "date" },
    { header: t("adm.pb.customer"), key: "customer" },
    { header: t("adm.my.items"), key: "items" },
    { header: t("adm.pb.total"), key: "total", type: "money" },
    { header: t("adm.pb.paid"), key: "paid", type: "money" },
    { header: t("adm.pb.balance"), key: "balance", type: "money" },
    ...(hasCommission ? [{ header: t("adm.my.commissionCol"), key: "commission", type: "money" }] : []),
  ];
  const xlsx = () => ({
    filename: `${t("adm.my.list")}-${range.from}-${range.to}.xlsx`,
    sheets: [{ name: t("adm.my.list"), cols, rows: list, totals: { total: sum("total"), paid: sum("paid"), balance: sum("balance"), ...(hasCommission ? { commission: sum("commission") } : {}) }, totalsLabel: t("adm.my.totalRow") }],
  });
  const csv = { cols: cols.map((c) => [c.header, c.get || c.key]), rows: list };
  // PDF · Excel · CSV desde la barra global del panel.
  useRegisterExport(rows ? menuHandlers({ targetRef: bodyRef, title: `${t("adm.my.list")} · ${range.from} – ${range.to}`, name: "mis-ventas", csv, xlsx }) : null);
  const summary = [
    { label: t("adm.my.sales"), value: list.length },
    { label: t("adm.pb.total"), value: m(sum("total")), strong: true },
    { label: t("adm.pb.balance"), value: m(sum("balance")), tone: sum("balance") > 0 ? "warn" : "good" },
    ...(hasCommission ? [{ label: t("adm.my.commissionCol"), value: m(sum("commission")) }] : []),
  ];
  return (
    <Accordion id="my-sales-list" icon="receipt" title={t("adm.my.list")} subtitle={`${t("adm.my.listSub")} · ${range.from} – ${range.to}`} summary={summary} defaultOpen>
      <div ref={bodyRef}>
        {state === "loading" && !rows ? <div className="adm-src-note loading">{t("adm.my.listLoading")}</div>
          : state === "error" ? <div className="adm-demo-banner">{t("adm.err.pos.generic")}</div>
          : !list.length ? <div className="adm-nodata">{t("adm.my.listEmpty")}</div> : (
          <table className="adm-table responsive pb-table">
            <thead>
              <tr>
                <th>{t("adm.pb.number")}</th><th>{t("adm.pb.date")}</th><th>{t("adm.pb.customer")}</th><th>{t("adm.my.items")}</th>
                <th className="r">{t("adm.pb.total")}</th><th className="r">{t("adm.pb.paid")}</th><th className="r">{t("adm.pb.balance")}</th>
                {hasCommission && <th className="r">{t("adm.my.commissionCol")}</th>}
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.order_id}>
                  <td data-label={t("adm.pb.number")} className="pb-num">
                    {openSale && r.sale_id ? <button type="button" onClick={() => openSale(r.sale_id)} title={t("adm.pb.open", { n: r.number })}>{r.number}</button> : r.number}
                    {r.status === "voided" && <span className="adm-chip bad"> {t("adm.my.voided")}</span>}
                  </td>
                  <td data-label={t("adm.pb.date")}>{shortDate(r.sold_at, lang)}</td>
                  <td data-label={t("adm.pb.customer")}>{r.customer || "—"}</td>
                  <td data-label={t("adm.my.items")}><small>{r.items}</small></td>
                  <td data-label={t("adm.pb.total")} className="r num">{m(r.total)}</td>
                  <td data-label={t("adm.pb.paid")} className="r num">{m(r.paid)}</td>
                  <td data-label={t("adm.pb.balance")} className="r num">{r.balance > 0 ? <b>{m(r.balance)}</b> : m(r.balance)}</td>
                  {hasCommission && <td data-label={t("adm.my.commissionCol")} className="r num">{r.commission == null ? "—" : m(r.commission)}</td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>{t("adm.my.totalRow")} · {list.length} {t("adm.my.sales")}</td>
                <td className="r num">{m(sum("total"))}</td>
                <td className="r num">{m(sum("paid"))}</td>
                <td className="r num"><b>{m(sum("balance"))}</b></td>
                {hasCommission && <td className="r num"><b>{m(sum("commission"))}</b></td>}
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </Accordion>
  );
}

/** Props: `go` (navegación), `me` (GET /admin/team/me; el filtro de tienda solo sale si vende en varias) y `openSale(id)` (ficha de una venta). */
export default function MySales({ go, me, openSale }) {
  const { t, lang } = useLang();
  const [d, setD] = useState(null);
  const [state, setState] = useState("loading");
  const { period, range, setPeriod } = usePeriodFilter();
  const { storeId, stores, isAll, isWeb } = useStoreFilter(me);
  // Solo con varias tiendas tiene sentido elegir; la online no tiene mostrador.
  const multi = Boolean(me) && stores.length > 1;
  const storeParam = multi && !isAll && !isWeb ? storeId : "";
  const seller = me?.role === "seller";
  const load = () => {
    setState("loading");
    adminFetch(`/admin/sales-analytics/me${storeParam ? `?store=${encodeURIComponent(storeParam)}` : ""}`).then((r) => { setD(r); setState("ok"); }).catch(() => setState("error"));
  };
  useEffect(load, [storeParam]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = (v) => money(v, "usd", lang);
  if (state === "loading" && !d) return <div className="adm-section"><div className="adm-src-note loading">{t("adm.ord.loading")}</div></div>;
  if (state === "error" || !d) return <div className="adm-section"><div className="adm-demo-banner">{t("adm.err.pos.generic")}</div></div>;

  const pct = d.goal ? Math.min(100, Math.round((d.goal.done / (d.goal.amount || 1)) * 100)) : 0;
  const wp = d.workplace;
  // Solo para quien no es vendedor: el vendedor nunca recibe el estado de la tienda.
  const st = seller ? null : d.store_today;
  const share = st && st.total > 0 ? Math.round((st.mine / st.total) * 100) : 0;
  const tillName = wp?.terminal ? (wp.terminal.name ? `${wp.terminal.code} · ${wp.terminal.name}` : wp.terminal.code) : null;
  // Donde se ven las ventas: el vendedor, en su propia lista; los demás, en «Ventas de tienda».
  const seeSales = () => (seller ? document.querySelector('[data-acc="my-sales-list"]')?.scrollIntoView({ behavior: "smooth", block: "start" }) : go?.("possales"));

  return (
    <div className="adm-section pos my-dash">
      <div className="adm-head-row">
        <div>
          <h2>{t("adm.tab.mysales")}</h2>
          {wp && (
            <p className="adm-sub my-where">
              <Icon name="store" size={14} /> {wp.store.code} · {wp.store.name}
              {tillName && <> · <Icon name="receipt" size={14} /> {tillName}</>}
            </p>
          )}
        </div>
        <div className="my-head-tags">
          {wp && (
            <button type="button" className={`adm-chip ${wp.cash_open ? "ok" : "neutral"}`} onClick={() => go?.("cash")} title={t("adm.my.cashHint")}>
              <Icon name="wallet" size={12} /> {t(wp.cash_open ? "adm.my.cashOpen" : "adm.my.cashClosed")}
            </button>
          )}
          {d.seller_code && <span className="adm-team-tag code">{d.seller_code}</span>}
          <button type="button" className="btn-xs" onClick={load} disabled={state === "loading"} aria-label={t("adm.my.refresh")} title={t("adm.my.refresh")}><Icon name="refresh" size={13} /></button>
        </div>
      </div>

      {go && (
        <div className="my-actions">
          <button type="button" className="btn-sm primary big" onClick={() => go("pos")}><Icon name="plus" size={15} /> {t("adm.tab.pos")}</button>
          <button type="button" className="btn-sm" onClick={() => go("cash")}><Icon name="wallet" size={14} /> {t("adm.tab.cash")}</button>
          {seller
            ? <button type="button" className="btn-sm" onClick={() => go("pendingbalances")}><Icon name="hand" size={14} /> {t("adm.tab.pendingbalances")}</button>
            : <>
              <button type="button" className="btn-sm" onClick={() => go("possales")}><Icon name="receipt" size={14} /> {t("adm.tab.possales")}</button>
              <button type="button" className="btn-sm" onClick={() => go("salesboard")}><Icon name="sales" size={14} /> {t("adm.tab.salesboard")}</button>
            </>}
        </div>
      )}

      <div className="my-periods">
        {PERIODS.map((k) => {
          const s = d[k] || ZERO;
          return (
            <button type="button" key={k} className={`my-period ${k === "today" ? "hero" : ""} ${seller && k === period ? "active" : ""}`} onClick={() => { setPeriod(k); seeSales(); }} aria-pressed={seller ? k === period : undefined}>
              <small>{t(`adm.my.${k}`)}</small>
              <b>{m(s.total)}</b>
              <span className="muted">{t("adm.my.periodSub", { n: s.count, avg: m(s.avg_ticket) })}</span>
            </button>
          );
        })}
      </div>

      <div className="my-grid">
        {st && (
          <div className="adm-card">
            <h3><Icon name="store" size={16} /> {t("adm.my.storeToday", { code: wp.store.code })}</h3>
            <div className="my-store">
              <div><small className="muted">{t("adm.my.storeTotal")}</small><b>{m(st.total)}</b><span className="muted">{t("adm.my.storeCount", { n: st.count })}</span></div>
              <div><small className="muted">{t("adm.my.mine")}</small><b>{m(st.mine)}</b><span className="muted">{t("adm.my.share", { pct: share })}</span></div>
            </div>
            <div className="my-goal" aria-label={t("adm.my.share", { pct: share })}><i style={{ width: `${share}%` }} /></div>
          </div>
        )}

        <div className="adm-card">
          <h3><Icon name="percent" size={16} /> {t("adm.my.goalTitle")}</h3>
          {d.commission ? <p>{t("adm.my.commission", { pct: d.commission.pct, v: m(d.commission.amount) })}</p> : <p className="muted">{t("adm.my.noCommission")}</p>}
          {d.goal ? (
            <>
              <div className="my-goal"><i style={{ width: `${pct}%` }} /></div>
              <p>{t("adm.my.goal", { done: m(d.goal.done), goal: m(d.goal.amount), left: m(d.goal.left) })}</p>
            </>
          ) : <p className="muted">{t("adm.my.noGoal")}</p>}
          <p className="muted">{t("adm.my.balance", { v: m(d.balance_due ?? 0) })}</p>
        </div>
      </div>

      <div className="my-grid">
        <div className="adm-card">
          <h3><Icon name="receipt" size={16} /> {t("adm.my.recent")}</h3>
          {!(d.recent || []).length ? <div className="adm-nodata">{t("adm.my.noRecent")}</div> : (
            <ul className="my-recent">
              {d.recent.map((r) => (
                <li key={r.id}>
                  <span className="my-recent-main">
                    {openSale ? <button type="button" className="pb-link" onClick={() => openSale(r.id)}><b>{r.number}</b></button> : <b>{r.number}</b>}
                    <small className="muted">{shortDate(r.created_at, lang)}</small>
                  </span>
                  <span className="my-recent-tags">
                    {r.status === "voided" && <span className="adm-chip bad">{t("adm.my.voided")}</span>}
                    {r.status !== "voided" && r.balance > 0 && <span className="adm-chip neutral">{t("adm.my.toCollect", { v: m(r.balance) })}</span>}
                    {r.status !== "voided" && r.delivered && <span className="adm-chip ok">{t("adm.my.delivered")}</span>}
                  </span>
                  <b className="my-recent-total">{m(r.total)}</b>
                </li>
              ))}
            </ul>
          )}
          {(d.recent || []).length > 0 && <button type="button" className="btn-xs" onClick={seeSales}>{t("adm.my.seeAll")} <Icon name="arrowRight" size={12} /></button>}
        </div>

        <div className="adm-card">
          <h3><Icon name="hand" size={16} /> {t("adm.my.ready", { n: (d.ready || []).length })}</h3>
          {!(d.ready || []).length ? <div className="adm-nodata">{t("adm.my.noneReady")}</div> : (
            <ul className="pos-lines">
              {d.ready.map((r) => (
                <li key={r.id}>
                  <Icon name="hand" size={16} />
                  <span><b>{r.number}</b> · {t(`adm.my.stage.${r.stage}`)}{r.balance > 0 ? ` · ${t("adm.my.toCollect", { v: m(r.balance) })}` : ""}</span>
                  {openSale ? <button type="button" className="btn-xs" onClick={() => openSale(r.id)}>{t("adm.my.open")}</button>
                    : go && !seller && <button type="button" className="btn-xs" onClick={() => go("possales")}>{t("adm.my.open")}</button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {seller && (
        <>
          {/* El período de la lista es el global (barra de filtros del panel); las tarjetas de arriba lo cambian. */}
          <MySalesList me={me} range={range} storeParam={storeParam} openSale={openSale} />
          <PendingBalances me={me} openSale={openSale} embedded />
        </>
      )}
    </div>
  );
}

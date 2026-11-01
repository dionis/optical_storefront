// Dónde se usa: pestaña «Ventas de tienda» de /admin. El vendedor ve las suyas;
// encargado y supervisor, las de sus tiendas; dueño y superadmin, todas (matriz
// de permisos acordada). Al pulsar una venta se abre su ficha (SaleDetailPanel):
// desde ahí se cobra el saldo, se entrega, se anula (o se pide anular) y se
// reimprimen documentos. Los importes vienen del servidor.
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { money } from "./adminOrders.js";
import { listSales, posContext, searchCustomers } from "./posApi.js";
import Accordion from "./Accordion.jsx";
import { useSalePanel } from "./SaleDetailPanel.jsx";
import StoreFilter, { useStoreFilter } from "./StoreFilter.jsx";
import { useSortable } from "./useSortable.js";
import SortTh from "./SortTh.jsx";
import "./screens.css";

const fmt = (v, lang) => new Date(v).toLocaleString(lang === "en" ? "en-US" : "es-US", { dateStyle: "short", timeStyle: "short" });

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

  // Resumen ejecutivo del acordeón: cuántas, cuánto y cuánto queda por cobrar (las anuladas aparte).
  const sums = useMemo(() => {
    const live = sales.filter((s) => s.status !== "voided");
    return { n: live.length, total: live.reduce((a, s) => a + (Number(s.total) || 0), 0), balance: live.reduce((a, s) => a + (Number(s.balance) || 0), 0), voided: sales.length - live.length };
  }, [sales]);
  const summary = [
    { label: t("adm.scr.count"), value: sums.n },
    { label: t("adm.scr.total"), value: money(sums.total, "usd", lang), strong: true },
    sums.balance > 0 ? { label: t("adm.scr.balance"), value: money(sums.balance, "usd", lang), tone: "warn" } : null,
    sums.voided > 0 ? { label: t("adm.scr.voided"), value: sums.voided, tone: "muted" } : null,
  ];

  // Las cabeceras ordenan (useSortable.js); por defecto la más reciente arriba, como llegan del servidor.
  const sorted = useSortable(sales, {
    id: "pos-sales", defaultKey: "created_at", defaultDir: "desc", deps: [ctx],
    getters: { terminal: (x) => termById.get(x.terminal_id)?.code || "", status: (x) => (x.status === "voided" ? 2 : x.delivered_at ? 1 : 0) },
  });
  const th = (col, label, align = "") => <SortTh col={col} sort={sorted.sort} onSort={sorted.toggle} align={align}>{label}</SortTh>;

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
        {state === "loading" && <div className="adm-src-note loading">{t("adm.ord.loading")}</div>}
        <table className="adm-table responsive">
          <thead><tr>{th("number", t("adm.pos.sales.number"))}{th("created_at", t("adm.pos.sales.when"))}{th("terminal", t("adm.pos.terminal"))}{th("seller_code", t("adm.pos.sales.seller"))}{th("total", t("adm.pos.price.total"))}{th("balance", t("adm.pos.pay.balance"))}{th("status", t("adm.pos.sales.status"))}</tr></thead>
          <tbody>
            {sorted.rows.map((s) => (
              <tr key={s.id} className={`ord-row ${sp.saleId === s.id ? "open" : ""} ${s.status === "voided" ? "muted" : ""}`} onClick={() => sp.open(s.id)} title={t("adm.sd.openHint")}>
                <td data-label={t("adm.pos.sales.number")}><b>{s.number}</b></td>
                <td data-label={t("adm.pos.sales.when")}>{fmt(s.created_at, lang)}</td>
                <td data-label={t("adm.pos.terminal")}>{termById.get(s.terminal_id)?.code || "—"}</td>
                <td data-label={t("adm.pos.sales.seller")}>{s.seller_code || "—"}</td>
                <td data-label={t("adm.pos.price.total")}>{money(s.total, "usd", lang)}</td>
                <td data-label={t("adm.pos.pay.balance")}>{s.balance > 0 ? <b className="pos-due">{money(s.balance, "usd", lang)}</b> : "—"}</td>
                <td data-label={t("adm.pos.sales.status")}>
                  {s.status === "voided" ? t("adm.pos.sales.st.voided") : s.delivered_at ? t("adm.pos.sales.st.delivered") : t("adm.pos.sales.st.completed")}
                  {s.void_requested_at && s.status !== "voided" ? <small className="pos-flag"> {t("adm.pos.sales.st.voidAsked")}</small> : null}
                </td>
              </tr>
            ))}
            {state === "ok" && sales.length === 0 && (
              <tr><td colSpan="7" className="full"><div className="adm-empty"><Icon name="receipt" size={32} /><b>{t("adm.pos.sales.empty")}</b></div></td></tr>
            )}
          </tbody>
        </table>
      </Accordion>
      {sp.panel}
    </div>
  );
}

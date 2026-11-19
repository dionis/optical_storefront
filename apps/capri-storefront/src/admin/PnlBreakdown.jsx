// Dónde se usa: «Resultado por tienda» (StoreCosts.jsx) — clic en una de las
// cinco tarjetas (Ventas netas, Costos del mes, Resultado, Margen %, Punto de
// equilibrio) abre este panel con el DESGLOSE EXACTO de esa cifra: de qué está
// hecha y de dónde sale cada parte (dueño, 17-nov-2026: «en cada card debe
// aparecer cuando se dé clic el desglose económico financiero exacto de esos
// datos, de dónde sale eso»).
//
// Los números vienen de GET /admin/store-costs/breakdown (backend
// lib/pnl-breakdown.ts): el MISMO libro que las tarjetas, abierto en sus
// partes, así que el desglose siempre suma la tarjeta al centavo. Aquí no se
// calcula nada contable; solo se presentan las partes y sus fórmulas.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import { adminFetch } from "./adminApi.js";
import { money } from "./adminOrders.js";
import { methodName } from "./posApi.js";
import Icon from "./icons.jsx";
import "./pnl-breakdown.css";

export const BREAKDOWN_TABS = ["sales", "costs", "result", "margin", "breakeven"];
const FREQ_FACTOR = { daily: "365 ÷ 12", weekly: "52 ÷ 12", biweekly: "26 ÷ 12", monthly: null, quarterly: "1 ÷ 3", annual: "1 ÷ 12" };

/** Una fila de la cuenta: concepto, de dónde sale, importe y signo. */
function Line({ label, source, value, sign = "", strong = false, neg = false, sub = false, m }) {
  return (
    <tr className={`${strong ? "strong" : ""} ${sub ? "sub" : ""}`}>
      <th scope="row"><span>{label}</span>{source && <small>{source}</small>}</th>
      <td className={`num ${neg ? "neg" : ""}`}>{value === null || value === undefined ? "—" : `${sign}${m(value)}`}</td>
    </tr>
  );
}

export default function PnlBreakdown({ month, storeId, scopeLabel, tab: initialTab = "sales", paymentMethods = [], onClose, onGoSales }) {
  const { t, lang } = useLang();
  const [tab, setTab] = useState(initialTab);
  const [state, setState] = useState({ s: "loading" });
  const m = (v) => money(Number(v) || 0, "usd", lang);
  // Igual que las tarjetas: «19.8 %».
  const pct = (v) => (v === null || v === undefined ? "—" : `${Math.round(Number(v) * 10) / 10} %`);

  useEffect(() => {
    let on = true;
    setState({ s: "loading" });
    adminFetch(`/admin/store-costs/breakdown?month=${encodeURIComponent(month)}${storeId ? `&store=${encodeURIComponent(storeId)}` : ""}`)
      .then((b) => on && setState({ s: "ok", b }))
      .catch(() => on && setState({ s: "error" }));
    return () => { on = false; };
  }, [month, storeId]);
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);

  const b = state.b;
  const T = b?.totals;
  const income = T ? Math.round((T.net_sales + T.shipping_income) * 100) / 100 : 0;
  const methodLabel = (code) => methodName(paymentMethods.find((x) => x.code === code) || { code, builtin: true }, t, lang);

  /** Cómo cargó este mes una partida: «$1,200 al mes», «$50 × 52 ÷ 12», «$3 × 41 ventas», «38 % de $600 (por ventas)». */
  const howOf = (it) => {
    const parts = [];
    if (it.per_sale) parts.push(t("adm.brk.how.perSale", { amount: m(it.amount), n: it.sales_count ?? 0 }));
    else if (it.frequency === "one_time") parts.push(it.amortize_months > 1 ? t("adm.brk.how.amortized", { amount: m(it.amount), n: it.amortize_months }) : t("adm.brk.how.once", { amount: m(it.amount) }));
    else if (FREQ_FACTOR[it.frequency]) parts.push(t("adm.brk.how.freq", { amount: m(it.amount), freq: t(`adm.costs2.freq.${it.frequency}`), factor: FREQ_FACTOR[it.frequency], monthly: m(it.month_total) }));
    else parts.push(t("adm.brk.how.monthly", { amount: m(it.amount) }));
    if (it.share_pct !== null && it.share_pct < 100) parts.push(t(it.allocation_method === "percent" ? "adm.brk.how.sharePct" : "adm.brk.how.shareSales", { pct: pct(it.share_pct), total: m(it.month_total) }));
    return parts.join(" · ");
  };
  const itemName = (it) => it.description || (it.category ? t(`adm.costs2.cat.${it.category}`) : t("adm.brk.unnamed"));
  const itemsOf = (bucket) => (b?.items || []).filter((i) => i.bucket === bucket);

  const ItemRows = ({ bucket }) => itemsOf(bucket).map((it) => (
    <Line key={it.id} sub m={m} label={`${itemName(it)}${it.owner_store ? ` · ${it.owner_store}` : ""}`} source={howOf(it)} value={it.charged} />
  ));

  const content = () => {
    if (state.s === "loading") return <div className="adm-src-note loading">{t("adm.brk.loading")}</div>;
    if (state.s === "error") return <div className="adm-demo-banner">{t("adm.brk.loadFailed")}</div>;
    const s = b.sales;
    if (tab === "sales") return (
      <>
        <p className="brk-lead">{t("adm.brk.sales.lead")}</p>
        <table className="brk-table">
          <tbody>
            <Line m={m} label={t("adm.brk.sales.gross")} source={t("adm.brk.sales.grossSrc", { n: s.count })} value={s.gross} />
            <Line m={m} label={t("adm.brk.sales.tax")} source={t("adm.brk.sales.taxSrc")} value={s.sales_tax} sign="− " />
            <Line m={m} strong label={t("adm.costs2.row.net_sales")} value={s.net} />
            {s.web_net > 0 && <Line m={m} sub label={t("adm.brk.sales.pos")} value={s.pos_net} />}
            {s.web_net > 0 && <Line m={m} sub label={t("adm.brk.sales.web")} value={s.web_net} />}
            <Line m={m} sub label={t("adm.brk.sales.taxable")} source={t("adm.brk.sales.taxableSrc")} value={s.taxable_net} />
            <Line m={m} sub label={t("adm.brk.sales.exempt")} source={t("adm.brk.sales.exemptSrc")} value={s.exempt_net} />
            {s.shipping_income > 0 && <Line m={m} label={t("adm.brk.sales.shipping")} source={t("adm.brk.sales.shippingSrc")} value={s.shipping_income} sign="+ " />}
          </tbody>
        </table>
        <div className="brk-facts">
          <span><b>{s.count}</b> {t("adm.brk.sales.count")}</span>
          <span><b>{s.avg_ticket === null ? "—" : m(s.avg_ticket)}</b> {t("adm.brk.sales.avg")}</span>
        </div>
        {!storeId && b.stores.length > 1 && (
          <table className="brk-table brk-stores">
            <thead><tr><th>{t("adm.pos.store")}</th><th className="num">{t("adm.costs2.row.net_sales")}</th><th className="num">{t("adm.brk.sales.countShort")}</th></tr></thead>
            <tbody>{b.stores.map((x) => <tr key={x.id}><th scope="row">{x.code} · {x.name}</th><td className="num">{m(x.net_sales)}</td><td className="num">{x.sales_count}</td></tr>)}</tbody>
          </table>
        )}
        <p className="brk-src"><Icon name="info" size={12} /> {t("adm.brk.sales.where")}</p>
        {onGoSales && <button type="button" className="btn-sm" onClick={onGoSales}><Icon name="receipt" size={13} /> {t("adm.brk.sales.see")}</button>}
      </>
    );
    if (tab === "costs") {
      const costs = T.cogs + T.payment_fees + T.commissions + T.variable_manual + T.fixed + T.shared;
      return (
        <>
          <p className="brk-lead">{t("adm.brk.costs.lead")}</p>
          <table className="brk-table">
            <tbody>
              <Line m={m} strong label={t("adm.brk.costs.cogs")} source={t("adm.brk.costs.cogsSrc")} value={b.cogs.total} />
              <Line m={m} sub label={t("adm.brk.costs.frames")} value={b.cogs.frames} />
              <Line m={m} sub label={t("adm.brk.costs.lenses")} value={b.cogs.lenses} />
              <Line m={m} sub label={t("adm.brk.costs.treatments")} value={b.cogs.treatments} />
              <Line m={m} sub label={t("adm.brk.costs.perOrder")} source={t("adm.brk.costs.perOrderSrc")} value={b.cogs.per_order} />

              <Line m={m} strong label={t("adm.costs2.row.payment_fees")} source={t("adm.brk.costs.feesSrc")} value={b.fees.total} />
              {b.fees.by_method.map((f) => <Line key={f.method_code} m={m} sub label={methodLabel(f.method_code)} source={t("adm.brk.costs.feeCount", { n: f.count })} value={f.amount} />)}
              {b.fees.web > 0 && <Line m={m} sub label={t("adm.brk.costs.webFee")} value={b.fees.web} />}

              <Line m={m} strong label={t("adm.costs2.row.commissions")} source={t("adm.brk.costs.commSrc")} value={b.commissions.total} />
              {b.commissions.sellers.map((x, i) => <Line key={i} m={m} sub label={x.seller_code || t("adm.brk.noSeller")} source={t("adm.brk.costs.commHow", { net: m(x.net_sales), pct: x.pct ?? 0 })} value={x.commission} />)}

              <Line m={m} strong label={t("adm.costs2.row.variable_manual")} source={t("adm.brk.costs.varSrc")} value={T.variable_manual} />
              <ItemRows bucket="variable" />
              <Line m={m} strong label={t("adm.costs2.row.fixed")} source={t("adm.brk.costs.fixedSrc")} value={T.fixed} />
              <ItemRows bucket="fixed" />
              <Line m={m} strong label={t("adm.costs2.row.shared")} source={t("adm.brk.costs.sharedSrc")} value={T.shared} />
              <ItemRows bucket="shared" />
            </tbody>
            <tfoot><tr><th scope="row">{t("adm.scr.sc.costs")}</th><td className="num">{m(costs)}</td></tr></tfoot>
          </table>
          <p className="brk-src"><Icon name="info" size={12} /> {t("adm.brk.costs.where")}</p>
        </>
      );
    }
    if (tab === "result") return (
      <>
        <p className="brk-lead">{t("adm.brk.result.lead")}</p>
        <table className="brk-table cascade">
          <tbody>
            <Line m={m} label={t("adm.costs2.row.net_sales")} value={T.net_sales} />
            {T.shipping_income > 0 && <Line m={m} label={t("adm.brk.sales.shipping")} value={T.shipping_income} sign="+ " />}
            <Line m={m} label={t("adm.costs2.row.cogs")} source={t("adm.brk.costs.cogsSrc")} value={T.cogs} sign="− " />
            <Line m={m} label={t("adm.costs2.row.payment_fees")} value={T.payment_fees} sign="− " />
            <Line m={m} label={t("adm.costs2.row.commissions")} value={T.commissions} sign="− " />
            <Line m={m} label={t("adm.costs2.row.variable_manual")} value={T.variable_manual} sign="− " />
            <Line m={m} strong label={t("adm.costs2.row.contribution")} source={t("adm.brk.result.contribSrc")} value={T.contribution} neg={T.contribution < 0} sign="= " />
            <Line m={m} label={t("adm.costs2.row.fixed")} value={T.fixed} sign="− " />
            <Line m={m} label={t("adm.costs2.row.shared")} value={T.shared} sign="− " />
            <Line m={m} strong label={t("adm.costs2.row.result")} value={T.result} neg={T.result < 0} sign="= " />
          </tbody>
        </table>
        <p className={`brk-verdict ${T.result < 0 ? "bad" : "good"}`}>{T.result < 0 ? t("adm.brk.result.loss", { v: m(-T.result) }) : t("adm.brk.result.profit", { v: m(T.result) })}</p>
        {!storeId && b.stores.length > 1 && (
          <table className="brk-table brk-stores">
            <thead><tr><th>{t("adm.pos.store")}</th><th className="num">{t("adm.costs2.row.result")}</th></tr></thead>
            <tbody>{b.stores.map((x) => <tr key={x.id}><th scope="row">{x.code} · {x.name}</th><td className={`num ${x.result < 0 ? "neg" : ""}`}>{m(x.result)}</td></tr>)}</tbody>
          </table>
        )}
      </>
    );
    if (tab === "margin") return (
      <>
        <p className="brk-lead">{t("adm.brk.margin.lead")}</p>
        <div className="brk-formula">
          <span><small>{t("adm.costs2.row.contribution")}</small><b>{m(T.contribution)}</b></span>
          <i aria-hidden="true">÷</i>
          <span><small>{T.shipping_income > 0 ? t("adm.brk.margin.income") : t("adm.costs2.row.net_sales")}</small><b>{m(income)}</b></span>
          <i aria-hidden="true">=</i>
          <span className="res"><small>{t("adm.costs2.row.margin")}</small><b>{pct(T.contribution_pct)}</b></span>
        </div>
        <table className="brk-table">
          <tbody>
            <Line m={m} label={t("adm.brk.margin.income")} value={income} />
            <Line m={m} label={t("adm.brk.margin.variable")} source={t("adm.brk.margin.variableSrc")} value={T.cogs + T.variable_total} sign="− " />
            <Line m={m} strong label={t("adm.costs2.row.contribution")} value={T.contribution} sign="= " neg={T.contribution < 0} />
          </tbody>
        </table>
        {T.contribution_pct !== null && <p className="brk-verdict">{t("adm.brk.margin.per100", { v: m(T.contribution_pct) })}</p>}
        <p className="brk-src"><Icon name="info" size={12} /> {t("adm.brk.margin.where")}</p>
      </>
    );
    // Punto de equilibrio
    const be = T.break_even;
    const gap = be === null ? null : Math.round((be - income) * 100) / 100;
    return (
      <>
        <p className="brk-lead">{t("adm.brk.be.lead")}</p>
        <div className="brk-formula">
          <span><small>{t("adm.brk.be.fixed")}</small><b>{m(T.fixed_total)}</b></span>
          <i aria-hidden="true">÷</i>
          <span><small>{t("adm.costs2.row.margin")}</small><b>{pct(T.contribution_pct)}</b></span>
          <i aria-hidden="true">=</i>
          <span className="res"><small>{t("adm.costs2.row.breakEven")}</small><b>{be === null ? "—" : m(be)}</b></span>
        </div>
        <table className="brk-table">
          <tbody>
            <Line m={m} label={t("adm.costs2.row.fixed")} value={T.fixed} />
            <Line m={m} label={t("adm.costs2.row.shared")} value={T.shared} sign="+ " />
            <Line m={m} strong label={t("adm.brk.be.fixed")} value={T.fixed_total} sign="= " />
            <Line m={m} label={t("adm.brk.be.sold")} value={income} />
            {gap !== null && <Line m={m} strong label={gap > 0 ? t("adm.brk.be.missing") : t("adm.brk.be.over")} value={Math.abs(gap)} neg={gap > 0} />}
          </tbody>
        </table>
        {be === null && <p className="brk-verdict bad">{t("adm.brk.be.none")}</p>}
        {gap !== null && gap > 0 && b.calendar.is_current && b.calendar.left > 0 && <p className="brk-verdict">{t("adm.brk.be.perDay", { v: m(Math.ceil((gap / b.calendar.left) * 100) / 100), n: b.calendar.left })}</p>}
        {gap !== null && gap <= 0 && <p className="brk-verdict good">{t("adm.brk.be.reached")}</p>}
        <p className="brk-src"><Icon name="info" size={12} /> {t("adm.brk.be.where")}</p>
      </>
    );
  };

  return createPortal(
    <div className="brk-wrap">
      <div className="brk-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="brk-panel" role="dialog" aria-modal="true" aria-label={t("adm.brk.title")}>
        <header className="brk-head">
          <div>
            <small>{t("adm.brk.title")} · {month} · {scopeLabel}</small>
            <h3>{t(`adm.brk.tab.${tab}`)}</h3>
          </div>
          <button type="button" className="brk-x" onClick={onClose} aria-label={t("adm.brk.close")} title={t("adm.brk.close")}><Icon name="close" size={16} /></button>
        </header>
        <nav className="brk-tabs" role="tablist">
          {BREAKDOWN_TABS.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t(`adm.brk.tab.${k}`)}</button>
          ))}
        </nav>
        <div className="brk-body">{content()}</div>
      </aside>
    </div>,
    document.body
  );
}

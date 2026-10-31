// Dónde se usa: pestaña «Cobros pendientes» de /admin (todos los roles) y,
// embebida, en «Mi panel» del vendedor. Las ventas con saldo por cobrar de las
// tiendas de quien mira (GET /admin/pos/sales?pending=1): dueño y superadmin
// con el filtro global de tienda; supervisor y encargado, sus tiendas; el
// vendedor, su tienda — las suyas y las de sus compañeros, que para él llegan
// reducidas a lo necesario para cobrar (`limited`, regla del dueño). Cada fila
// cobra en línea (POST /admin/pos/sales/:id/payments); el servidor calcula.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { money, shortDate } from "./adminOrders.js";
import { collectPayment, listSales, methodName, posContext } from "./posApi.js";
import Accordion from "./Accordion.jsx";
import StoreFilter, { useStoreFilter } from "./StoreFilter.jsx";
import { ExportMenu } from "./ui.jsx";
import "./screens.css";
import "./roles.css";

const DAY = 86400000;
/** Días transcurridos desde la fecha prometida (o, sin ella, desde la venta); nunca negativo. */
export const daysOverdue = (sale, now = Date.now()) => {
  const since = sale.promised_on ? Date.parse(`${sale.promised_on}T00:00:00`) : Date.parse(sale.created_at);
  return Number.isFinite(since) ? Math.max(0, Math.floor((now - since) / DAY)) : 0;
};
const OVERDUE_DAYS = 7;

/** Formulario de cobro de una fila: forma de pago de la tienda, importe (el saldo por defecto) y referencia. */
function CollectRow({ sale, ctx, colSpan, onDone, onCancel }) {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const store = ctx.stores.find((x) => x.id === sale.establishment_id);
  const methods = ctx.payment_methods.filter((m) => (!store || store.payment_methods.includes(m.code)) && !(m.kind === "insurance" || m.receivable));
  const [pay, setPay] = useState({ method_code: methods.length === 1 ? methods[0].code : "", amount: String(sale.balance), details: {} });
  const [busy, setBusy] = useState(false);
  const meth = methods.find((m) => m.code === pay.method_code);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await collectPayment(sale.id, [{ method_code: pay.method_code, amount: pay.amount, details: pay.details }]);
      toast({ tone: "success", title: t("adm.pb.collected", { n: sale.number }) });
      onDone(r.sale);
    } catch (e) {
      toast({ tone: "error", title: t(e.message) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <tr className="pb-form adm-noprint">
      <td colSpan={colSpan}>
        <div className="pos-pay">
          <select value={pay.method_code} onChange={(e) => setPay({ method_code: e.target.value, amount: pay.amount, details: {} })} aria-label={t("adm.pos.pay.method")} title={t("adm.pos.pay.method")}>
            <option value="">{t("adm.pos.pay.method")}</option>
            {methods.map((x) => <option key={x.code} value={x.code}>{methodName(x, t, lang)}</option>)}
          </select>
          <input inputMode="decimal" value={pay.amount} onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value.replace(/[^\d.]/g, "") }))} placeholder={t("adm.pos.pay.amount")} aria-label={t("adm.pos.pay.amount")} />
          <button type="button" className="btn-xs" onClick={() => setPay((p) => ({ ...p, amount: String(sale.balance) }))}>{t("adm.pos.pay.rest")}</button>
          {meth?.reference_fields?.map((f) => (
            <input key={f.key} value={pay.details[f.key] || ""} onChange={(e) => setPay((p) => ({ ...p, details: { ...p.details, [f.key]: e.target.value } }))}
              placeholder={`${meth.builtin ? t(`adm.pos.ref.${f.key}`) : (lang === "en" && f.label_en) || f.label || f.key}${f.required ? " *" : ""}`}
              aria-label={meth.builtin ? t(`adm.pos.ref.${f.key}`) : f.label || f.key} />
          ))}
          <button type="button" className="btn-sm primary" disabled={busy || !pay.method_code || !Number(pay.amount)} onClick={submit}><Icon name="hand" size={14} /> {t("adm.pb.confirm")}</button>
          <button type="button" className="btn-xs" disabled={busy} onClick={onCancel}>{t("adm.pb.cancel")}</button>
        </div>
      </td>
    </tr>
  );
}

/**
 * Props: `me` (GET /admin/team/me) para el filtro de tienda; `openSale(id)`
 * abre la ficha de la venta (el número es un botón cuando se da); `embedded`
 * quita la cabecera de sección (dentro de «Mi panel»).
 */
export default function PendingBalances({ me, openSale, embedded = false }) {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const [ctx, setCtx] = useState(null);
  const [sales, setSales] = useState([]);
  const [state, setState] = useState("loading");
  const [openId, setOpenId] = useState(null);
  const bodyRef = useRef(null);
  const isAdmin = !me || me.is_admin !== false;
  const seller = me?.role === "seller";
  const { storeId, isAll, isWeb } = useStoreFilter(me);
  const store = isAll || isWeb ? "" : storeId;
  const m = (v) => money(v, "usd", lang);

  useEffect(() => { posContext().then(setCtx).catch((e) => toast({ tone: "error", title: t(e.message) })); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const load = () => {
    setState("loading");
    listSales({ pending: 1, store, limit: 200 })
      .then((r) => { setSales(r.sales || []); setState("ok"); })
      .catch((e) => { setState("error"); toast({ tone: "error", title: t(e.message) }); });
  };
  useEffect(load, [store]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => sales.filter((s) => s.balance > 0).map((s) => ({ ...s, days: daysOverdue(s) })), [sales]);
  const totals = useMemo(() => ({
    count: rows.length,
    balance: Math.round(rows.reduce((a, r) => a + r.balance, 0) * 100) / 100,
    late: rows.filter((r) => r.days > OVERDUE_DAYS).length,
  }), [rows]);
  const summary = [
    { label: t("adm.pb.count"), value: totals.count },
    { label: t("adm.pb.balanceTotal"), value: m(totals.balance), strong: true },
    { label: t("adm.pb.overdue7"), value: totals.late, tone: totals.late ? "bad" : "good" },
  ];
  const storeCode = (id) => ctx?.stores.find((x) => x.id === id)?.code || "";
  const onCollected = (updated) => {
    setOpenId(null);
    // El servidor devuelve la venta con el saldo nuevo: la fila se actualiza y desaparece si quedó en cero.
    setSales((list) => list.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)).filter((s) => s.balance > 0));
  };
  const cols = [
    { header: t("adm.pb.number"), key: "number" },
    { header: t("adm.pb.date"), get: (r) => r.created_at.slice(0, 10), type: "date" },
    { header: t("adm.pb.customer"), key: "customer_name" },
    { header: t("adm.pb.phone"), key: "customer_phone" },
    { header: t("adm.pb.seller"), key: "seller_code" },
    { header: t("adm.pb.total"), key: "total", type: "money" },
    { header: t("adm.pb.paid"), key: "paid", type: "money" },
    { header: t("adm.pb.balance"), key: "balance", type: "money" },
    { header: t("adm.pb.overdue"), key: "days", type: "int" },
  ];
  const xlsx = () => ({ filename: `${t("adm.pb.title")}-${new Date().toISOString().slice(0, 10)}.xlsx`, sheets: [{ name: t("adm.pb.title"), cols, rows, totals: { balance: totals.balance }, totalsLabel: t("adm.pb.totalRow") }] });
  const csv = { cols: cols.map((c) => [c.header, c.get || c.key]), rows };
  const colSpan = 9;
  const dayTone = (d) => (d > OVERDUE_DAYS * 2 ? "late" : d > OVERDUE_DAYS ? "warn" : "");

  const table = (
    <div ref={bodyRef}>
      {state === "loading" && !sales.length ? <div className="adm-src-note loading">{t("adm.pb.loading")}</div> : !rows.length ? <div className="adm-nodata">{t("adm.pb.empty")}</div> : (
        <table className="adm-table responsive pb-table">
          <thead>
            <tr>
              <th>{t("adm.pb.number")}</th><th>{t("adm.pb.date")}</th><th>{t("adm.pb.customer")}</th><th>{t("adm.pb.seller")}</th>
              <th className="r">{t("adm.pb.total")}</th><th className="r">{t("adm.pb.paid")}</th><th className="r">{t("adm.pb.balance")}</th><th className="r">{t("adm.pb.overdue")}</th><th className="adm-noprint" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr>
                  <td data-label={t("adm.pb.number")} className="pb-num">
                    {openSale ? <button type="button" onClick={() => openSale(r.id)} title={t("adm.pb.open", { n: r.number })}>{r.number}</button> : r.number}
                    {isAll && isAdmin && storeCode(r.establishment_id) ? <small className="muted"> · {storeCode(r.establishment_id)}</small> : null}
                  </td>
                  <td data-label={t("adm.pb.date")}>{shortDate(r.created_at, lang)}{r.promised_on && <small className="muted" title={t("adm.pb.promised", { date: r.promised_on })}> · {r.promised_on}</small>}</td>
                  <td data-label={t("adm.pb.customer")} className="pb-cust">{r.customer_name || "—"}{r.customer_phone && <small>{r.customer_phone}</small>}</td>
                  <td data-label={t("adm.pb.seller")}>{r.seller_code || "—"}{seller && !r.limited && <span className="adm-chip ok"> {t("adm.pb.mine")}</span>}</td>
                  <td data-label={t("adm.pb.total")} className="r num">{m(r.total)}</td>
                  <td data-label={t("adm.pb.paid")} className="r num">{m(r.paid)}</td>
                  <td data-label={t("adm.pb.balance")} className="r num"><b>{m(r.balance)}</b></td>
                  <td data-label={t("adm.pb.overdue")} className="r"><span className={`pb-days ${dayTone(r.days)}`}>{t("adm.pb.days", { n: r.days })}</span></td>
                  <td className="adm-noprint r">
                    {ctx && r.status !== "voided" && (
                      <button type="button" className={`btn-xs ${openId === r.id ? "" : "primary"}`} onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                        <Icon name="hand" size={12} /> {t("adm.pb.collect")}
                      </button>
                    )}
                  </td>
                </tr>
                {ctx && openId === r.id && <CollectRow key={`${r.id}-form`} sale={r} ctx={ctx} colSpan={colSpan} onDone={onCollected} onCancel={() => setOpenId(null)} />}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>{t("adm.pb.totalRow")} · {totals.count} {t("adm.pb.count")}</td>
              <td className="r num">{m(rows.reduce((a, r) => a + r.total, 0))}</td>
              <td className="r num">{m(rows.reduce((a, r) => a + r.paid, 0))}</td>
              <td className="r num"><b>{m(totals.balance)}</b></td>
              <td className="r">{totals.late ? <span className="pb-days late">{totals.late}</span> : null}</td>
              <td className="adm-noprint" />
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );

  const tools = (
    <span className="pb-sum">
      <button type="button" className="btn-xs" onClick={load} disabled={state === "loading"} aria-label={t("adm.pb.refresh")} title={t("adm.pb.refresh")}><Icon name="refresh" size={13} /></button>
      <ExportMenu targetRef={bodyRef} title={t("adm.pb.title")} name="cobros-pendientes" csv={csv} xlsx={xlsx} />
    </span>
  );

  return (
    <div className={embedded ? "" : "adm-section pos"}>
      {!embedded && (
        <div className="adm-head-row">
          <div>
            <h2>{t("adm.pb.title")}</h2>
            <p className="adm-sub">{t(seller ? "adm.pb.subSeller" : "adm.pb.sub")}</p>
          </div>
          <div className="pos-filters">
            <StoreFilter me={me} />
          </div>
        </div>
      )}
      <Accordion id={embedded ? "my-pending" : "pending-balances"} icon="hand" title={embedded ? t("adm.my.pendingStore") : t("adm.pb.title")} summary={summary} defaultOpen right={tools}>
        {table}
      </Accordion>
    </div>
  );
}

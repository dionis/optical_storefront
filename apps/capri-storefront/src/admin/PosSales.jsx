// Dónde se usa: pestaña «Ventas de tienda» de /admin. El vendedor ve las suyas;
// encargado y supervisor, las de sus tiendas; dueño y superadmin, todas (matriz
// de permisos acordada). Desde aquí se cobra el saldo, se entrega, se anula (o
// se pide anular) y se reimprimen documentos. Los importes vienen del servidor.
import { Fragment, useEffect, useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { money } from "./adminOrders.js";
import { collectPayment, deliverSale, fetchSale, listSales, methodName, posContext, searchCustomers, voidSale } from "./posApi.js";
import SaleDocuments from "./SaleDocuments.jsx";

const fmt = (v, lang) => new Date(v).toLocaleString(lang === "en" ? "en-US" : "es-US", { dateStyle: "short", timeStyle: "short" });

function SaleDetail({ id, ctx, onChanged }) {
  const { t, lang } = useLang();
  const { toast, confirm } = useFeedback();
  const [data, setData] = useState(null);
  const [pay, setPay] = useState({ method_code: "", amount: "", details: {} });
  const [voiding, setVoiding] = useState({ open: false, reason: "", note: "" });
  const [busy, setBusy] = useState(false);
  const load = () => fetchSale(id).then(setData).catch((e) => toast({ tone: "error", title: t(e.message) }));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);
  if (!data) return <div className="adm-src-note loading">{t("adm.ord.loading")}</div>;
  const s = data.sale;
  const store = ctx.stores.find((x) => x.id === s.establishment_id);
  const methods = ctx.payment_methods.filter((m) => (!store || store.payment_methods.includes(m.code)) && !(m.kind === "insurance" || m.receivable));
  const meth = methods.find((m) => m.code === pay.method_code);
  const m = (v) => money(v, "usd", lang);

  const run = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); if (r?.sale) setData((d) => ({ ...d, sale: r.sale })); toast({ tone: "success", title: ok(r) }); onChanged?.(); }
    catch (e) { toast({ tone: "error", title: t(e.message) }); }
    finally { setBusy(false); }
  };
  const collect = () => run(() => collectPayment(s.id, [{ method_code: pay.method_code, amount: pay.amount, details: pay.details }]), () => { setPay({ method_code: "", amount: "", details: {} }); return t("adm.pos.sales.collected"); });
  const deliver = async () => {
    if (!(await confirm({ title: t("adm.pos.sales.deliverConfirm", { n: s.number }), message: t("adm.pos.sales.deliverBody") }))) return;
    run(() => deliverSale(s.id), () => t("adm.pos.sales.delivered"));
  };
  const doVoid = () => run(() => voidSale(s.id, voiding.reason, voiding.note), (r) => { setVoiding({ open: false, reason: "", note: "" }); return r.requested ? t("adm.pos.sales.voidRequested") : t("adm.pos.sales.voided"); });

  return (
    <div className="pos-detail">
      <dl className="pos-totals">
        {s.discount > 0 && <><dt>{t("adm.pos.price.discountAmt", { n: s.discount_pct })}</dt><dd>−{m(s.discount)}</dd></>}
        <dt>{t("adm.pos.price.total")}</dt><dd>{m(s.total)}</dd>
        <dt>{t("adm.pos.pay.paid")}</dt><dd>{m(s.paid)}</dd>
        {s.insurance > 0 && <><dt>{t("adm.pos.pay.insurance")}</dt><dd>{m(s.insurance)}</dd></>}
        <dt className="big">{t("adm.pos.pay.balance")}</dt><dd className="big">{m(s.balance)}</dd>
        {s.tray && <><dt>{t("adm.pos.done.tray")}</dt><dd>{s.tray}</dd></>}
        {s.promised_on && <><dt>{t("adm.pos.done.promised")}</dt><dd>{s.promised_on}</dd></>}
      </dl>
      <table className="adm-table responsive">
        <thead><tr><th>{t("adm.pos.sales.when")}</th><th>{t("adm.pos.pay.method")}</th><th>{t("adm.pos.sales.kind")}</th><th>{t("adm.pos.pay.amount")}</th></tr></thead>
        <tbody>
          {s.payments.map((p, i) => (
            <tr key={i}>
              <td data-label={t("adm.pos.sales.when")}>{fmt(p.created_at, lang)}</td>
              <td data-label={t("adm.pos.pay.method")}>{methodName(ctx.payment_methods.find((x) => x.code === p.method_code), t, lang) || p.method_code}{p.reference ? <small className="muted"> · {p.reference}</small> : null}</td>
              <td data-label={t("adm.pos.sales.kind")}>{t(`adm.pos.sales.pay.${p.kind}`)}</td>
              <td data-label={t("adm.pos.pay.amount")}>{m(p.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.insurance_claims?.length > 0 && (
        <p className="muted">{data.insurance_claims.map((c) => `${c.payer_name}: ${m(c.covered)} · ${t(`adm.pos.claims.status.${c.status}`)}`).join(" — ")}</p>
      )}

      {s.status !== "voided" && s.balance > 0 && (
        <div className="pos-pay">
          <select value={pay.method_code} onChange={(e) => setPay({ method_code: e.target.value, amount: pay.amount, details: {} })} aria-label={t("adm.pos.pay.method")} title={t("adm.pos.pay.method")}>
            <option value="">{t("adm.pos.pay.method")}</option>
            {methods.map((x) => <option key={x.code} value={x.code}>{methodName(x, t, lang)}</option>)}
          </select>
          <input inputMode="decimal" value={pay.amount} onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value.replace(/[^\d.]/g, "") }))} placeholder={t("adm.pos.pay.amount")} aria-label={t("adm.pos.pay.amount")} />
          <button type="button" className="btn-xs" onClick={() => setPay((p) => ({ ...p, amount: String(s.balance) }))}>{t("adm.pos.pay.rest")}</button>
          {meth?.reference_fields?.map((f) => (
            <input key={f.key} value={pay.details[f.key] || ""} onChange={(e) => setPay((p) => ({ ...p, details: { ...p.details, [f.key]: e.target.value } }))}
              placeholder={`${meth.builtin ? t(`adm.pos.ref.${f.key}`) : (lang === "en" && f.label_en) || f.label || f.key}${f.required ? " *" : ""}`}
              aria-label={meth.builtin ? t(`adm.pos.ref.${f.key}`) : f.label || f.key} />
          ))}
          <button type="button" className="btn-sm primary" disabled={busy || !pay.method_code || !Number(pay.amount)} onClick={collect}>{t("adm.pos.sales.collect")}</button>
        </div>
      )}

      <div className="pos-actions">
        {s.status !== "voided" && !s.delivered_at && (
          <button type="button" className="btn-sm" disabled={busy || s.balance > 0} title={s.balance > 0 ? t("adm.err.pos.balance_due") : undefined} onClick={deliver}><Icon name="hand" size={14} /> {t("adm.pos.sales.deliver")}</button>
        )}
        {s.status !== "voided" && (
          <button type="button" className="btn-sm warn" disabled={busy} onClick={() => setVoiding((v) => ({ ...v, open: !v.open, reason: s.void_reason || v.reason }))}>
            <Icon name="undo" size={14} /> {ctx.can_void ? (s.void_requested_at ? t("adm.pos.sales.confirmVoid") : t("adm.pos.sales.void")) : t("adm.pos.sales.requestVoid")}
          </button>
        )}
        <SaleDocuments saleId={s.id} compact />
      </div>
      {s.void_requested_at && s.status !== "voided" && <div className="adm-demo-banner">{t("adm.pos.sales.voidPending", { reason: t(`adm.pos.void.${s.void_reason}`) })}</div>}
      {s.status === "voided" && <div className="adm-demo-banner">{t("adm.pos.sales.voidedAt", { date: fmt(s.voided_at, lang), reason: t(`adm.pos.void.${s.void_reason}`) })}</div>}
      {voiding.open && (
        <div className="pos-void">
          <select value={voiding.reason} onChange={(e) => setVoiding((v) => ({ ...v, reason: e.target.value }))} aria-label={t("adm.pos.sales.voidReason")} title={t("adm.pos.sales.voidReason")}>
            <option value="">{t("adm.pos.sales.voidReason")}</option>
            {ctx.void_reasons.map((r) => <option key={r} value={r}>{t(`adm.pos.void.${r}`)}</option>)}
          </select>
          <input value={voiding.note} onChange={(e) => setVoiding((v) => ({ ...v, note: e.target.value }))} placeholder={t("adm.pos.sales.voidNote")} aria-label={t("adm.pos.sales.voidNote")} />
          <button type="button" className="btn-sm warn" disabled={busy || !voiding.reason} onClick={doVoid}>{ctx.can_void ? t("adm.pos.sales.void") : t("adm.pos.sales.requestVoid")}</button>
          <small className="muted">{t("adm.pos.sales.voidHint")}</small>
        </div>
      )}
    </div>
  );
}

export default function PosSales() {
  const { t, lang } = useLang();
  const [ctx, setCtx] = useState(null);
  const [sales, setSales] = useState([]);
  const [state, setState] = useState("loading");
  const [f, setF] = useState({ store: "", terminal: "", with_balance: false, status: "", number: "" });
  const [custQ, setCustQ] = useState("");
  const [custHits, setCustHits] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [open, setOpen] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => { posContext().then(setCtx).catch(() => setState("error")); }, []);
  useEffect(() => {
    if (!ctx) return undefined;
    let on = true;
    setState("loading");
    listSales({ store: f.store, terminal: f.terminal, with_balance: f.with_balance ? 1 : "", status: f.status, number: f.number.trim(), customer: customer?.id })
      .then((r) => { if (on) { setSales(r.sales || []); setState("ok"); } })
      .catch(() => on && setState("error"));
    return () => { on = false; };
  }, [ctx, f, customer, tick]);
  useEffect(() => {
    if (custQ.trim().length < 2) { setCustHits([]); return undefined; }
    const h = setTimeout(() => searchCustomers(custQ).then((r) => setCustHits(r.customers || [])).catch(() => setCustHits([])), 300);
    return () => clearTimeout(h);
  }, [custQ]);

  const storeById = useMemo(() => new Map((ctx?.stores || []).map((s) => [s.id, s])), [ctx]);
  const terminals = f.store ? storeById.get(f.store)?.terminals || [] : (ctx?.stores || []).flatMap((s) => s.terminals);
  const termById = useMemo(() => new Map((ctx?.stores || []).flatMap((s) => s.terminals.map((x) => [x.id, x]))), [ctx]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  if (state === "error" && !ctx) return <div className="adm-section"><div className="adm-demo-banner">{t("adm.err.pos.generic")}</div></div>;

  return (
    <div className="adm-section pos">
      <div className="adm-head-row"><h2>{t("adm.tab.possales")}</h2></div>
      <p className="adm-sub">{ctx && !ctx.is_admin && ctx.role === "seller" ? t("adm.pos.sales.subSeller") : t("adm.pos.sales.sub")}</p>
      <div className="adm-card pos-filters">
        <select value={f.store} onChange={(e) => setF((x) => ({ ...x, store: e.target.value, terminal: "" }))} aria-label={t("adm.pos.store")} title={t("adm.pos.store")}>
          <option value="">{t("adm.pos.sales.allStores")}</option>
          {(ctx?.stores || []).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
        </select>
        <select value={f.terminal} onChange={set("terminal")} aria-label={t("adm.pos.terminal")} title={t("adm.pos.terminal")}>
          <option value="">{t("adm.pos.sales.allTerminals")}</option>
          {terminals.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
        </select>
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
      <div className="adm-card">
        {state === "loading" && <div className="adm-src-note loading">{t("adm.ord.loading")}</div>}
        <table className="adm-table responsive">
          <thead><tr><th>{t("adm.pos.sales.number")}</th><th>{t("adm.pos.sales.when")}</th><th>{t("adm.pos.terminal")}</th><th>{t("adm.pos.sales.seller")}</th><th>{t("adm.pos.price.total")}</th><th>{t("adm.pos.pay.balance")}</th><th>{t("adm.pos.sales.status")}</th></tr></thead>
          <tbody>
            {sales.map((s) => (
              <Fragment key={s.id}>
                <tr className={`ord-row ${s.status === "voided" ? "muted" : ""}`} onClick={() => setOpen((o) => (o === s.id ? null : s.id))}>
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
                {open === s.id && ctx && (
                  <tr><td colSpan="7" className="full"><SaleDetail id={s.id} ctx={ctx} onChanged={() => setTick((n) => n + 1)} /></td></tr>
                )}
              </Fragment>
            ))}
            {state === "ok" && sales.length === 0 && (
              <tr><td colSpan="7" className="full"><div className="adm-empty"><Icon name="receipt" size={32} /><b>{t("adm.pos.sales.empty")}</b></div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Dónde se usa: pestaña «Estado de cuenta» de /admin. Estado de cuenta de una
// tienda por período (GET /admin/pos/statement): todas las ventas del mes con
// sus cobros y saldos, totales por método, vendedor y día, y la liquidación de
// una tienda familiar/asociada/en consignación. Documento imprimible (carta)
// y exportable a Excel (Ventas / Cobros / Vendedores / Días). Todo importe lo
// calcula el servidor; aquí solo se pinta y se formatea.
import { useEffect, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useLensCatalog } from "../data/lensCatalog.js";
import { TENANT } from "../config/tenant.js";
import Icon from "./icons.jsx";
import { money } from "./adminOrders.js";
import { downloadXlsx } from "./exportXlsx.js";
import { printElement } from "./exportUtils.js";
import { fetchStatement, posContext } from "./posApi.js";
import "./store-statement.css";

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthRange = (offset) => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { from: ymd(first), to: ymd(last) };
};
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Un YYYY-MM-DD como fecha local (new Date("2026-10-01") sería la medianoche UTC: un día antes en América). */
const dayLabel = (day, lang) => {
  if (!day || !DAY_RE.test(day)) return "—";
  const d = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  return d.toLocaleDateString(lang === "en" ? "en-US" : "es", { year: "numeric", month: "short", day: "numeric" });
};
const whenLabel = (iso, lang) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(lang === "en" ? "en-US" : "es", { dateStyle: "medium", timeStyle: "short" });
};
const errKey = (e) => (e?.reason ? `adm.err.pos.${e.reason}` : e?.message?.startsWith("adm.") ? e.message : "adm.err.pos.generic");

/** Acordeón con totales en la cabecera; abierto a la fuerza mientras se imprime. */
function Acc({ open, onToggle, title, sum, children }) {
  return (
    <details className="cost-accordion stmt-acc" open={open} onToggle={(e) => onToggle(e.target.open)}>
      <summary className="cost-acc-head">
        <span className="cost-acc-title">{title}</span>
        <span className="stmt-acc-sum">{sum}</span>
        <Icon name="chevronDown" size={14} className="cost-acc-arrow" />
      </summary>
      <div className="cost-acc-body">{children}</div>
    </details>
  );
}

/** Props: `me` (alcance del usuario; `go` del panel se acepta y no se usa). */
export default function StoreStatement({ me }) {
  const { t, lang } = useLang();
  const catalog = useLensCatalog();
  const [ctx, setCtx] = useState(null);
  const [storeId, setStoreId] = useState("");
  const [mode, setMode] = useState("this");
  const [range, setRange] = useState(monthRange(0));
  const [draft, setDraft] = useState(monthRange(0));
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [error, setError] = useState("");
  const [open, setOpen] = useState({ sales: true, methods: true, sellers: false, days: false });
  const [printing, setPrinting] = useState(false);
  const ref = useRef(null);
  const isAdmin = Boolean(ctx?.is_admin ?? me?.is_admin);

  useEffect(() => {
    posContext()
      .then((c) => { setCtx(c); setStoreId(c.stores[0]?.id || (c.is_admin ? "all" : "")); })
      .catch(() => setCtx({ stores: [] }));
  }, []);

  useEffect(() => {
    if (!storeId) { setState("idle"); return undefined; }
    let cancelled = false;
    setState("loading");
    setError("");
    fetchStatement({ establishment_id: storeId, from: range.from, to: range.to })
      .then((d) => { if (!cancelled) { setData(d); setState("ready"); } })
      .catch((e) => { if (!cancelled) { setError(errKey(e)); setState("error"); } });
    return () => { cancelled = true; };
  }, [storeId, range.from, range.to]);

  // Para imprimir se abren todos los acordeones (un <details> cerrado no se clona con contenido).
  useEffect(() => {
    if (!printing) return undefined;
    const id = setTimeout(() => {
      printElement(ref.current, `${t("adm.stmt.title")} ${data?.number || ""}`, data ? `${data.store.code} · ${data.store.name}` : "");
      setPrinting(false);
    }, 50);
    return () => clearTimeout(id);
  }, [printing, data, t]);

  const m = (c) => money((Number(c) || 0) / 100, "usd", lang);
  const L = (o) => (o ? o[lang] ?? o.es : "");
  const methodLabel = (code, label) => (label ? L(label) : t(`adm.pos.method.${code}`));
  const sellerLabel = (code) => code || t("adm.stmt.noSeller");
  const lensSummary = (lens) => {
    if (!lens) return "";
    const ars = [...(catalog.AR?.sv || []), ...(catalog.AR?.bifprog || [])];
    return [
      L(catalog.DESIGNS.find((d) => d.id === lens.design)?.label) || lens.design,
      lens.material ? L(catalog.MATERIALS.find((d) => d.id === lens.material)?.label) || lens.material : null,
      lens.photo ? L(catalog.PHOTO.find((d) => d.id === lens.photo)?.label) || lens.photo : null,
      lens.ar ? L(ars.find((d) => d.id === lens.ar)?.label) || lens.ar : null,
    ].filter(Boolean).join(" · ");
  };
  const itemName = (it) => {
    if (it.kind === "own_frame") return t("adm.pos.own.tag");
    if (it.kind === "case") return [t("adm.stmt.case"), it.title].filter(Boolean).join(" · ");
    return [[it.brand, it.title].filter(Boolean).join(" "), it.variant].filter(Boolean).join(" · ");
  };
  const itemLine = (it) => {
    const lens = lensSummary(it.lens);
    return `${itemName(it)}${it.qty > 1 ? ` ×${it.qty}` : ""}${lens ? ` · ${lens}` : it.kind === "frame" ? ` · ${t("adm.pos.sum.frameOnly")}` : ""}`;
  };
  const itemsText = (s) => s.items.map(itemLine).join(" | ");

  const pick = (next) => {
    setMode(next);
    if (next === "this") { setRange(monthRange(0)); setDraft(monthRange(0)); }
    if (next === "last") { setRange(monthRange(-1)); setDraft(monthRange(-1)); }
  };
  const applyDraft = () => {
    if (!DAY_RE.test(draft.from) || !DAY_RE.test(draft.to) || draft.from > draft.to) return;
    setRange({ from: draft.from, to: draft.to });
  };

  const totals = data?.totals;
  const pct = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—");

  const onExcel = () => {
    if (!data) return;
    const tt = data.totals;
    const all = data.store.kind === "all";
    const cents = (v) => (Number(v) || 0) / 100;
    const sales = {
      name: t("adm.stmt.sheet.sales"),
      cols: [
        { header: t("adm.stmt.col.number"), key: "number", width: 14 },
        { header: t("adm.stmt.col.date"), get: (s) => s.day, type: "date", width: 12 },
        ...(all ? [{ header: t("adm.stmt.col.store"), key: "store_code", width: 8 }] : []),
        { header: t("adm.stmt.col.customer"), get: (s) => s.customer_name || "", width: 24 },
        { header: t("adm.stmt.col.seller"), get: (s) => s.seller_code || "", width: 10 },
        { header: t("adm.stmt.col.items"), get: itemsText, width: 60 },
        { header: t("adm.stmt.col.delivery"), get: (s) => t(`adm.stmt.delivery.${s.delivery}`), width: 10 },
        { header: t("adm.stmt.col.status"), get: (s) => t(`adm.stmt.status.${s.status}`), width: 11 },
        { header: t("adm.stmt.col.list"), key: "list", get: (s) => cents(s.list_cents), type: "money", width: 11 },
        { header: t("adm.stmt.col.discount"), key: "discount", get: (s) => cents(s.discount_cents), type: "money", width: 11 },
        { header: t("adm.stmt.col.tax"), key: "tax", get: (s) => cents(s.tax_cents), type: "money", width: 10 },
        { header: t("adm.stmt.col.total"), key: "total", get: (s) => cents(s.total_cents), type: "money", width: 11 },
        { header: t("adm.stmt.col.paid"), key: "paid", get: (s) => cents(s.paid_cents), type: "money", width: 11 },
        { header: t("adm.stmt.col.insurance"), key: "insurance", get: (s) => cents(s.insurance_cents), type: "money", width: 11 },
        { header: t("adm.stmt.col.balance"), key: "balance", get: (s) => cents(s.balance_cents), type: "money", width: 11 },
      ],
      rows: data.sales,
      totals: { list: cents(tt.list_cents), discount: cents(tt.discount_cents), tax: cents(tt.tax_cents), total: cents(tt.total_cents), paid: cents(tt.paid_cents), insurance: cents(tt.insurance_cents), balance: cents(tt.balance_cents) },
      totalsLabel: t("adm.stmt.total"),
    };
    const paymentRows = data.sales.filter((s) => s.status !== "voided").flatMap((s) => s.payments.map((p) => ({ ...p, sale: s.number, day: p.at.slice(0, 10) })));
    const payments = {
      name: t("adm.stmt.sheet.payments"),
      cols: [
        { header: t("adm.stmt.col.date"), key: "day", type: "date", width: 12 },
        { header: t("adm.stmt.col.sale"), key: "sale", width: 14 },
        { header: t("adm.stmt.col.method"), get: (p) => methodLabel(p.method_code, p.method), width: 18 },
        { header: t("adm.stmt.col.kind"), get: (p) => t(`adm.stmt.pay.${p.kind}`), width: 12 },
        { header: t("adm.stmt.col.reference"), get: (p) => p.reference || "", width: 18 },
        { header: t("adm.stmt.col.amount"), key: "amount", get: (p) => (p.kind === "refund" ? -1 : 1) * cents(p.amount_cents), type: "money", width: 12 },
      ],
      rows: paymentRows,
      totals: { amount: cents(tt.by_method.reduce((a, r) => a + r.cents, 0)) },
      totalsLabel: t("adm.stmt.total"),
    };
    const sellers = {
      name: t("adm.stmt.sheet.sellers"),
      cols: [
        { header: t("adm.stmt.col.seller"), get: (r) => sellerLabel(r.seller_code), width: 16 },
        { header: t("adm.stmt.col.count"), key: "count", type: "int", width: 10 },
        { header: t("adm.stmt.col.total"), key: "total", get: (r) => cents(r.total_cents), type: "money", width: 12 },
      ],
      rows: tt.by_seller,
      totals: { count: tt.count, total: cents(tt.total_cents) },
      totalsLabel: t("adm.stmt.total"),
    };
    const days = {
      name: t("adm.stmt.sheet.days"),
      cols: [
        { header: t("adm.stmt.col.day"), key: "date", type: "date", width: 12 },
        { header: t("adm.stmt.col.count"), key: "count", type: "int", width: 10 },
        { header: t("adm.stmt.col.total"), key: "total", get: (r) => cents(r.total_cents), type: "money", width: 12 },
      ],
      rows: tt.by_day,
      totals: { count: tt.count, total: cents(tt.total_cents) },
      totalsLabel: t("adm.stmt.total"),
    };
    downloadXlsx(`estado_${data.store.code}_${data.period.from}_${data.period.to}.xlsx`, [sales, payments, sellers, days]);
  };

  const acc = (k) => ({ open: printing || open[k], onToggle: (v) => { if (!printing) setOpen((o) => (o[k] === v ? o : { ...o, [k]: v })); } });

  if (!ctx) return <div className="adm-section"><div className="adm-src-note loading">{t("adm.ord.loading")}</div></div>;
  if (!ctx.stores.length && !isAdmin) return <div className="adm-section"><div className="adm-empty"><Icon name="store" size={36} /><b>{t("adm.stmt.noStores")}</b></div></div>;

  const all = data?.store.kind === "all";
  const settlement = data?.settlement;
  return (
    <div className="adm-section stmt">
      <div className="adm-head-row">
        <h2><Icon name="clipboard" size={20} /> {t("adm.stmt.title")}</h2>
      </div>
      <p className="adm-sub">{t("adm.stmt.sub")}</p>

      <div className="stmt-bar adm-noprint">
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label={t("adm.pos.store")} title={t("adm.pos.store")}>
          {isAdmin && <option value="all">{t("adm.stmt.allStores")}</option>}
          {ctx.stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
        </select>
        <span className="stmt-chips" role="tablist">
          <button type="button" className={mode === "this" ? "on" : ""} onClick={() => pick("this")}>{t("adm.stmt.thisMonth")}</button>
          <button type="button" className={mode === "last" ? "on" : ""} onClick={() => pick("last")}>{t("adm.stmt.lastMonth")}</button>
          <button type="button" className={mode === "range" ? "on" : ""} onClick={() => pick("range")}>{t("adm.stmt.range")}</button>
        </span>
        {mode === "range" && (
          <span className="stmt-range">
            <label>{t("adm.stmt.from")} <input type="date" value={draft.from} max={draft.to} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} /></label>
            <label>{t("adm.stmt.to")} <input type="date" value={draft.to} min={draft.from} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} /></label>
            <button type="button" className="btn-xs" disabled={!DAY_RE.test(draft.from) || !DAY_RE.test(draft.to) || draft.from > draft.to} onClick={applyDraft}>{t("adm.stmt.apply")}</button>
          </span>
        )}
        <span className="stmt-bar-actions">
          <button type="button" className="btn-xs" disabled={!data || printing} onClick={() => setPrinting(true)} title={t("adm.ui.pdf")}><Icon name="printer" size={14} /> {t("adm.stmt.pdf")}</button>
          <button type="button" className="btn-xs" disabled={!data} onClick={onExcel}><Icon name="excel" size={14} /> {t("adm.stmt.excel")}</button>
        </span>
      </div>

      {state === "loading" && !data && <div className="adm-src-note loading">{t("adm.stmt.loading")}</div>}
      {state === "error" && <div className="adm-login-err">{t(error)}</div>}

      {data && (
        <div className="stmt-doc" ref={ref} style={state === "loading" ? { opacity: 0.6 } : undefined}>
          <header className="stmt-head">
            <div className="stmt-biz">
              {TENANT.logo && <img src={TENANT.logo} alt="" />}
              <div>
                <b>{data.business.legal_name || data.business.name}</b>
                {data.business.legal_name && data.business.legal_name !== data.business.name && <small>{data.business.name}</small>}
                {data.business.address && <small>{data.business.address}</small>}
                <small>{data.business.url}</small>
              </div>
            </div>
            <div className="stmt-meta">
              <h3 className="stmt-title">{t("adm.stmt.title")}</h3>
              <div className="stmt-no">{t("adm.stmt.number")} {data.number}</div>
              <small>{t("adm.stmt.period")}: {dayLabel(data.period.from, lang)} – {dayLabel(data.period.to, lang)}</small>
              <small>{t("adm.stmt.generated")}: {whenLabel(data.generated_at, lang)}</small>
            </div>
            <div className="stmt-store">
              <span><small>{t("adm.stmt.store")}</small><b>{all ? t("adm.stmt.allStores") : `${data.store.code} · ${data.store.name}`}</b></span>
              {data.store.address && <span><small>{t("adm.stmt.business")}</small>{data.store.address}</span>}
              {data.store.phone && <span><small>{t("adm.stmt.phone")}</small>{data.store.phone}</span>}
              <span className="stmt-kind">{t(`adm.stmt.kind.${data.store.kind}`)}</span>
            </div>
          </header>

          {data.truncated && <div className="adm-login-err">{t("adm.stmt.truncated", { n: data.sales.length })}</div>}

          <div className="stmt-kpis">
            <div className="stmt-kpi"><small>{t("adm.stmt.k.sales")}</small><b>{m(totals.total_cents)}</b></div>
            <div className="stmt-kpi"><small>{t("adm.stmt.k.count")}</small><b>{totals.count}</b>{totals.voided_count > 0 && <i>{t("adm.stmt.k.voided", { n: totals.voided_count })}</i>}</div>
            <div className="stmt-kpi"><small>{t("adm.stmt.k.discount")}</small><b>{m(totals.discount_cents)}</b></div>
            <div className="stmt-kpi"><small>{t("adm.stmt.k.paid")}</small><b className="good">{m(totals.paid_cents)}</b></div>
            {totals.insurance_cents > 0 && <div className="stmt-kpi"><small>{t("adm.stmt.k.insurance")}</small><b>{m(totals.insurance_cents)}</b></div>}
            <div className="stmt-kpi"><small>{t("adm.stmt.k.balance")}</small><b className={totals.balance_cents > 0 ? "warn" : ""}>{m(totals.balance_cents)}</b></div>
            {settlement && <div className="stmt-kpi"><small>{t("adm.stmt.k.settlement", { pct: settlement.pct })}</small><b>{m(settlement.amount_cents)}</b></div>}
          </div>

          <Acc {...acc("sales")} title={t("adm.stmt.sec.sales")} sum={<><span>{totals.count}{totals.voided_count ? ` (+${totals.voided_count})` : ""}</span><b>{m(totals.total_cents)}</b></>}>
            {data.sales.length === 0 ? <div className="stmt-empty">{t("adm.stmt.empty")}</div> : (
              <div className="stmt-tbl-wrap">
                <table className="stmt-tbl">
                  <thead>
                    <tr>
                      <th>{t("adm.stmt.col.number")}</th>
                      <th>{t("adm.stmt.col.date")}</th>
                      {all && <th>{t("adm.stmt.col.store")}</th>}
                      <th>{t("adm.stmt.col.customer")}</th>
                      <th>{t("adm.stmt.col.seller")}</th>
                      <th>{t("adm.stmt.col.items")}</th>
                      <th className="num">{t("adm.stmt.col.list")}</th>
                      <th className="num">{t("adm.stmt.col.discount")}</th>
                      <th className="num">{t("adm.stmt.col.total")}</th>
                      <th className="num">{t("adm.stmt.col.paid")}</th>
                      <th className="num">{t("adm.stmt.col.balance")}</th>
                      <th>{t("adm.stmt.col.status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sales.map((s) => (
                      <tr key={s.id} className={s.status === "voided" ? "voided" : ""}>
                        <td className="mono">{s.number}</td>
                        <td className="mono">{dayLabel(s.day, lang)}</td>
                        {all && <td className="mono">{s.store_code}</td>}
                        <td>{s.customer_name || <span className="muted">{t("adm.stmt.noCustomer")}</span>}</td>
                        <td className="mono">{sellerLabel(s.seller_code)}</td>
                        <td className="items">
                          {s.items.length === 0 ? <small>—</small> : s.items.map((it, i) => (
                            <div key={i}>{itemName(it)}{it.qty > 1 ? ` ×${it.qty}` : ""}{it.lens ? <small> · {lensSummary(it.lens)}</small> : it.kind === "frame" ? <small> · {t("adm.pos.sum.frameOnly")}</small> : null}</div>
                          ))}
                          {s.delivery === "ship" && <small>{t("adm.stmt.delivery.ship")}</small>}
                        </td>
                        <td className="num">{m(s.list_cents)}</td>
                        <td className="num">{s.discount_cents ? `−${m(s.discount_cents)}` : "—"}</td>
                        <td className="num"><b>{m(s.total_cents)}</b></td>
                        <td className="num">{m(s.paid_cents)}{s.insurance_cents > 0 && <small className="muted"> +{m(s.insurance_cents)}</small>}</td>
                        <td className="num">{s.balance_cents > 0 ? m(s.balance_cents) : "—"}</td>
                        <td className="status"><span className={`stmt-tag ${s.status === "voided" ? "void" : "ok"}`}>{t(`adm.stmt.status.${s.status}`)}</span></td>
                      </tr>
                    ))}
                    <tr className="total">
                      <td colSpan={all ? 6 : 5}>{t("adm.stmt.total")} · {totals.count}</td>
                      <td className="num">{m(totals.list_cents)}</td>
                      <td className="num">{totals.discount_cents ? `−${m(totals.discount_cents)}` : "—"}</td>
                      <td className="num">{m(totals.total_cents)}</td>
                      <td className="num">{m(totals.paid_cents)}{totals.insurance_cents > 0 && <small> +{m(totals.insurance_cents)}</small>}</td>
                      <td className="num">{m(totals.balance_cents)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Acc>

          <Acc {...acc("methods")} title={t("adm.stmt.sec.methods")} sum={<b>{m(totals.by_method.reduce((a, r) => a + r.cents, 0))}</b>}>
            {totals.by_method.length === 0 ? <div className="stmt-empty">{t("adm.stmt.empty")}</div> : (
              <table className="stmt-tbl">
                <thead><tr><th>{t("adm.stmt.col.method")}</th><th className="num">{t("adm.stmt.col.amount")}</th><th className="num">{t("adm.stmt.col.share")}</th></tr></thead>
                <tbody>
                  {totals.by_method.map((r) => {
                    const whole = totals.by_method.reduce((a, x) => a + x.cents, 0);
                    return <tr key={r.code}><td>{methodLabel(r.code, r.label)}</td><td className="num">{m(r.cents)}</td><td className="num">{pct(r.cents, whole)}</td></tr>;
                  })}
                  <tr className="total"><td>{t("adm.stmt.total")}</td><td className="num">{m(totals.by_method.reduce((a, r) => a + r.cents, 0))}</td><td className="num">100%</td></tr>
                </tbody>
              </table>
            )}
          </Acc>

          <Acc {...acc("sellers")} title={t("adm.stmt.sec.sellers")} sum={<><span>{totals.by_seller.length}</span><b>{m(totals.total_cents)}</b></>}>
            {totals.by_seller.length === 0 ? <div className="stmt-empty">{t("adm.stmt.empty")}</div> : (
              <table className="stmt-tbl">
                <thead><tr><th>{t("adm.stmt.col.seller")}</th><th className="num">{t("adm.stmt.col.count")}</th><th className="num">{t("adm.stmt.col.total")}</th><th className="num">{t("adm.stmt.col.share")}</th></tr></thead>
                <tbody>
                  {totals.by_seller.map((r) => (
                    <tr key={r.seller_code || "-"}><td className="mono">{sellerLabel(r.seller_code)}</td><td className="num">{r.count}</td><td className="num">{m(r.total_cents)}</td><td className="num">{pct(r.total_cents, totals.total_cents)}</td></tr>
                  ))}
                  <tr className="total"><td>{t("adm.stmt.total")}</td><td className="num">{totals.count}</td><td className="num">{m(totals.total_cents)}</td><td className="num">100%</td></tr>
                </tbody>
              </table>
            )}
          </Acc>

          <Acc {...acc("days")} title={t("adm.stmt.sec.days")} sum={<><span>{totals.by_day.length}</span><b>{m(totals.total_cents)}</b></>}>
            {totals.by_day.length === 0 ? <div className="stmt-empty">{t("adm.stmt.empty")}</div> : (
              <table className="stmt-tbl">
                <thead><tr><th>{t("adm.stmt.col.day")}</th><th className="num">{t("adm.stmt.col.count")}</th><th className="num">{t("adm.stmt.col.total")}</th></tr></thead>
                <tbody>
                  {totals.by_day.map((r) => <tr key={r.date}><td className="mono">{dayLabel(r.date, lang)}</td><td className="num">{r.count}</td><td className="num">{m(r.total_cents)}</td></tr>)}
                  <tr className="total"><td>{t("adm.stmt.total")}</td><td className="num">{totals.count}</td><td className="num">{m(totals.total_cents)}</td></tr>
                </tbody>
              </table>
            )}
          </Acc>

          <footer className="stmt-foot">
            <div className="stmt-note">
              <p>{t("adm.stmt.footer.note")}</p>
              {data.store.receipt_note && <p>{data.store.receipt_note}</p>}
            </div>
            {settlement && (
              <div className="stmt-settle">
                <h4>{t("adm.stmt.settlement.title")}</h4>
                <dl>
                  <dt>{t("adm.stmt.settlement.base")}</dt><dd>{m(settlement.base_cents)}</dd>
                  <dt>{t("adm.stmt.settlement.pct")}</dt><dd>{settlement.pct}%</dd>
                  <div className="line" />
                  <dt>{t("adm.stmt.settlement.amount")}</dt><dd className="big">{m(settlement.amount_cents)}</dd>
                  <dt>{t("adm.stmt.settlement.owner")}</dt><dd>{m(settlement.base_cents - settlement.amount_cents)}</dd>
                </dl>
              </div>
            )}
          </footer>
        </div>
      )}
    </div>
  );
}

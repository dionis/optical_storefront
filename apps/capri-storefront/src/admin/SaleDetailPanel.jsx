// Dónde se usa: en toda pantalla que liste ventas de tienda — Ventas de tienda
// (PosSales), Pedidos de la tienda (StoreOrders, también dentro del Ejecutivo)
// y Estado de cuenta (StoreStatement). Al pulsar una venta se abre esta ficha
// como cajón lateral con TODO lo de la venta: cliente, montura y lentes (con la
// receta para quien puede verla), importes, cobros (y registrar uno), documentos
// (imprimir / enviar recibo) e historial. Desde aquí también se entrega y se
// anula (o se pide anular), como antes desde la fila de Ventas de tienda.
//
//   const sp = useSalePanel({ me, onChanged: reload });
//   <tr onClick={() => sp.open(sale.id, { economics: row })}>…</tr>
//   {sp.panel}
//
// Datos: GET /admin/pos/sales/:id (venta, cobros, seguros), GET …/documents?kind=receipt
// (líneas con foto, cliente, impuesto, impresiones — sin registrar impresión),
// GET /admin/pos/customers/:id (correo) y, solo para administradores, supervisores
// y encargados, GET …/documents?kind=job (valores de la receta). Costo, comisión y
// ganancia nunca se piden aquí: llegan en `economics` desde la lista que ya los
// tenía (y solo si el servidor los dio).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { money } from "./adminOrders.js";
import { collectPayment, deliverSale, fetchCustomer, fetchSale, fetchSaleDocument, methodName, posContext, voidSale } from "./posApi.js";
import SaleDocuments from "./SaleDocuments.jsx";
import PosFramePhoto from "./PosFramePhoto.jsx";
import "./sale-detail.css";

const fmt = (v, lang) => (v ? new Date(v).toLocaleString(lang === "en" ? "en-US" : "es-US", { dateStyle: "medium", timeStyle: "short" }) : "—");
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Un YYYY-MM-DD como fecha local (new Date("2026-10-01") sería medianoche UTC: un día antes en América). */
const dayLabel = (day, lang) => {
  if (!day) return "—";
  if (!DAY_RE.test(day)) return fmt(day, lang);
  const d = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  return d.toLocaleDateString(lang === "en" ? "en-US" : "es", { year: "numeric", month: "short", day: "numeric" });
};
const bi = (o, lang) => (o ? o[lang] || o.es || "" : "");
const fmtRx = (v, digits = 2, sign = true) => (v === null || v === undefined ? null : `${sign && Number(v) > 0 ? "+" : ""}${Number(v).toFixed(digits)}`);
const errKey = (e) => (e?.reason ? `adm.err.pos.${e.reason}` : e?.message?.startsWith("adm.") ? e.message : "adm.err.pos.generic");

/** Receta = dato de salud: valores solo para administradores, supervisores y encargados; el resto ve «con/sin receta». */
export const canSeeRx = (who) => Boolean(who) && (who.is_admin !== false || ["supervisor", "manager"].includes(who.role));

// El contexto del POS (tiendas, formas de pago, permisos) se pide una vez por sesión del panel.
let ctxPromise = null;
const loadCtx = () => {
  if (!ctxPromise) ctxPromise = posContext().catch((e) => { ctxPromise = null; throw e; });
  return ctxPromise;
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Receta de solo lectura: misma cuadrícula que la ficha de laboratorio, sin controles. */
function RxGrid({ rx }) {
  const { t } = useLang();
  const cell = (v) => (v == null ? <td className="empty">—</td> : <td>{v}</td>);
  const prism = (e) => (e?.prism == null ? null : `${fmtRx(e.prism, 2, false)}${e.base ? ` ${e.base}` : ""}`);
  return (
    <div className="sd-rx-scroll">
      <table className="sd-rx-grid">
        <thead>
          <tr><th /><th>{t("adm.sd.rx.sph")}</th><th>{t("adm.sd.rx.cyl")}</th><th>{t("adm.sd.rx.axis")}</th><th>{t("adm.sd.rx.add")}</th><th>{t("adm.sd.rx.prism")}</th><th>{t("adm.sd.rx.pd")}</th></tr>
        </thead>
        <tbody>
          {["od", "os"].map((eye) => {
            const e = rx?.[eye] || {};
            return (
              <tr key={eye}>
                <th>{t(`adm.sd.rx.${eye}`)}</th>
                {cell(fmtRx(e.sph))}{cell(fmtRx(e.cyl))}{cell(e.axis == null ? null : String(e.axis))}{cell(fmtRx(e.add))}{cell(prism(e))}{cell(fmtRx(rx?.[`pd_${eye}`], 2, false))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Section({ icon, title, right, children }) {
  return (
    <section className="sd-card">
      <h3 className="sd-card-head"><Icon name={icon} size={14} /> {title}{right && <span className="sd-right">{right}</span>}</h3>
      {children}
    </section>
  );
}

/**
 * Props: `saleId`, `open`, `onClose`, `onChanged` (tras cobrar/entregar/anular,
 * para que la lista se refresque), `me` (GET /admin/team/me; sin él se usa el
 * contexto del POS), `economics` (fila de /admin/sales-analytics/sales con
 * cost/fee/commission/profit/margin_pct, opcional), `ctx` (contexto del POS si
 * la pantalla ya lo tiene; opcional).
 */
export default function SaleDetailPanel({ saleId, open, onClose, onChanged, me, economics = null, ctx: givenCtx = null }) {
  const { t, lang } = useLang();
  const { toast, confirm } = useFeedback();
  const [ctx, setCtx] = useState(givenCtx);
  const [data, setData] = useState(null);
  const [doc, setDoc] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [rxDoc, setRxDoc] = useState(null);
  const [state, setState] = useState("idle");
  const [busy, setBusy] = useState(false);
  const [pay, setPay] = useState({ method_code: "", amount: "", details: {} });
  const [voiding, setVoiding] = useState({ open: false, reason: "", note: "" });
  const [tick, setTick] = useState(0);
  const panelRef = useRef(null);
  const m = (v) => money(v, "usd", lang);

  useEffect(() => { if (givenCtx) setCtx(givenCtx); else loadCtx().then(setCtx).catch(() => setCtx({ stores: [], payment_methods: [], void_reasons: [], can_void: false })); }, [givenCtx]);

  const who = me || (ctx && ctx.role !== undefined ? { is_admin: ctx.is_admin, role: ctx.role } : null);
  const rxAllowed = canSeeRx(who);

  // Carga: venta + documento (líneas, cliente, impuesto, impresiones) y, aparte, correo del cliente y receta.
  useEffect(() => {
    // Se espera al contexto (una vez por sesión): decide qué rol tiene quien mira y, con él, si se pide la receta.
    if (!open || !saleId || !ctx) return undefined;
    let on = true;
    setState("loading");
    setData(null); setDoc(null); setCustomer(null); setRxDoc(null);
    setPay({ method_code: "", amount: "", details: {} });
    setVoiding({ open: false, reason: "", note: "" });
    Promise.all([fetchSale(saleId), fetchSaleDocument(saleId, "receipt").then((r) => r.document).catch(() => null)])
      .then(([d, dc]) => {
        if (!on) return;
        setData(d); setDoc(dc); setState("ok");
        if (d.sale.customer_id) fetchCustomer(d.sale.customer_id).then((r) => on && setCustomer(r.customer || null)).catch(() => null);
        if (rxAllowed && dc?.lines?.some((l) => l.prescription_id)) fetchSaleDocument(saleId, "job").then((r) => on && setRxDoc(r.document)).catch(() => on && setRxDoc({ tickets: [] }));
      })
      .catch((e) => { if (on) { setState("error"); toast({ tone: "error", title: t(errKey(e)) }); } });
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, saleId, tick, rxAllowed, Boolean(ctx)]);

  // Cajón abierto: sin scroll detrás, foco dentro, Escape cierra, y al cerrar vuelve el foco a la fila.
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.classList.add("sd-open");
    document.body.style.overflow = "hidden";
    const id = setTimeout(() => panelRef.current?.focus(), 30);
    return () => {
      clearTimeout(id);
      document.body.classList.remove("sd-open");
      document.body.style.overflow = prevOverflow;
      if (prev && typeof prev.focus === "function") prev.focus();
    };
  }, [open]);

  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose?.(); return; }
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const s = data?.sale;
  const store = useMemo(() => (s && ctx ? (ctx.stores || []).find((x) => x.id === s.establishment_id) : null), [s, ctx]);
  const terminal = store?.terminals?.find((x) => x.id === s?.terminal_id) || null;
  const methods = useMemo(() => (ctx?.payment_methods || []).filter((x) => (!store || store.payment_methods.includes(x.code)) && !(x.kind === "insurance" || x.receivable)), [ctx, store]);
  const meth = methods.find((x) => x.code === pay.method_code);
  // El monto propuesto es el saldo; cambia cuando la venta cambia (tras un cobro parcial).
  useEffect(() => { if (s) setPay((p) => ({ ...p, amount: s.balance > 0 ? String(s.balance) : "" })); }, [s?.balance]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn, ok) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r?.sale) setData((d) => ({ ...d, sale: r.sale }));
      toast({ tone: "success", title: ok(r) });
      onChanged?.();
    } catch (e) { toast({ tone: "error", title: t(errKey(e)) }); }
    finally { setBusy(false); }
  };
  const collect = () => run(
    () => collectPayment(s.id, [{ method_code: pay.method_code, amount: pay.amount, details: pay.details }]),
    () => { setPay({ method_code: "", amount: "", details: {} }); return t("adm.pos.sales.collected"); },
  );
  const deliver = async () => {
    if (!(await confirm({ title: t("adm.pos.sales.deliverConfirm", { n: s.number }), message: t("adm.pos.sales.deliverBody") }))) return;
    run(() => deliverSale(s.id), () => t("adm.pos.sales.delivered"));
  };
  const doVoid = () => run(
    () => voidSale(s.id, voiding.reason, voiding.note),
    (r) => { setVoiding({ open: false, reason: "", note: "" }); return r.requested ? t("adm.pos.sales.voidRequested") : t("adm.pos.sales.voided"); },
  );

  if (!open || typeof document === "undefined") return null;

  const status = !s ? null : s.status === "voided" ? ["voided", "bad"] : s.delivered_at ? ["delivered", "ok"] : s.balance > 0 ? ["balance", "warn"] : ["completed", ""];
  const lines = doc?.lines || [];
  const custName = doc?.customer?.name || [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") || "";
  const custPhone = customer?.phone || doc?.customer?.phone || "";
  const rxFor = (line) => (rxDoc?.tickets || []).find((tk) => tk.line?.prescription_id && tk.line.prescription_id === line.prescription_id)?.rx || null;
  const methodLabel = (p) => methodName((ctx?.payment_methods || []).find((x) => x.code === p.method_code), t, lang) || bi(p.method, lang) || p.method_code;
  const econ = economics && (economics.profit != null || economics.cost != null || economics.commission != null) ? economics : null;
  const costOf = (r) => (r.cost == null ? null : (Number(r.cost) || 0) + (Number(r.fee) || 0));
  const pct = (v) => (v == null || Number.isNaN(Number(v)) ? "—" : `${Math.round(Number(v) * 10) / 10}%`);

  // Historial: lo que pasó, en orden, desde las marcas de tiempo y los cobros; lo prometido al final si falta.
  const history = !s ? [] : [
    { at: s.created_at, key: "created", tone: "accent", icon: "receipt", what: t("adm.sd.h.created"), sub: [s.seller_code, terminal?.code].filter(Boolean).join(" · ") },
    ...s.payments.map((p, i) => ({
      at: p.created_at, key: `p${i}`, tone: p.kind === "refund" ? "bad" : "ok", icon: "dollar",
      what: `${t(`adm.sd.h.${p.kind}`)} · ${m(p.amount)}`, sub: [methodLabel(p), p.reference].filter(Boolean).join(" · "),
    })),
    s.void_requested_at ? { at: s.void_requested_at, key: "voidAsked", tone: "warn", icon: "alert", what: t("adm.sd.h.voidAsked"), sub: s.void_reason ? t(`adm.pos.void.${s.void_reason}`) : "" } : null,
    s.delivered_at ? { at: s.delivered_at, key: "delivered", tone: "ok", icon: "hand", what: t("adm.sd.h.delivered"), sub: "" } : null,
    s.voided_at ? { at: s.voided_at, key: "voided", tone: "bad", icon: "undo", what: t("adm.sd.h.voided"), sub: s.void_reason ? t(`adm.pos.void.${s.void_reason}`) : "" } : null,
  ].filter(Boolean).sort((a, b) => new Date(a.at) - new Date(b.at));
  if (s && s.promised_on && !s.delivered_at && s.status !== "voided") history.push({ at: null, key: "promised", tone: "", icon: "clock", future: true, what: t("adm.sd.h.promised"), sub: `${dayLabel(s.promised_on, lang)} · ${t("adm.sd.h.pending")}` });

  const canCollect = s && s.status !== "voided" && s.balance > 0;
  const canDeliver = s && s.status !== "voided" && !s.delivered_at;
  const canVoidBtn = s && s.status !== "voided";

  return createPortal(
    <div className="sd-root" role="presentation" onKeyDown={onKey}>
      <div className="sd-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="sd-panel" role="dialog" aria-modal="true" aria-label={s ? `${t("adm.sd.title")} ${s.number}` : t("adm.sd.title")} tabIndex={-1} ref={panelRef}>
        <header className="sd-head">
          <div className="sd-head-row">
            <div style={{ minWidth: 0 }}>
              <p className="sd-kicker">{t("adm.sd.title")}</p>
              <h2 className="sd-number">
                {s ? s.number : "…"}
                {status && <span className={`adm-chip ${status[1]}`}>{t(`adm.sd.st.${status[0]}`)}</span>}
                {s?.void_requested_at && s.status !== "voided" && <span className="adm-chip warn">{t("adm.sd.st.voidAsked")}</span>}
              </h2>
            </div>
            <div className="sd-head-actions adm-noprint">
              <button type="button" className="sd-icobtn" onClick={() => window.print()} title={t("adm.sd.print")} aria-label={t("adm.sd.print")} disabled={!s}><Icon name="printer" size={15} /></button>
              <button type="button" className="sd-icobtn" onClick={onClose} title={t("adm.sd.close")} aria-label={t("adm.sd.close")}><Icon name="close" size={16} /></button>
            </div>
          </div>
          {s && (
            <ul className="sd-meta">
              <li><Icon name="calendar" size={13} /> <b>{fmt(s.created_at, lang)}</b></li>
              {(store || doc?.store) && <li><span className="sd-dot" style={{ background: store?.color || "var(--adm-line)" }} /> {t("adm.sd.store")}: <b>{store ? `${store.code} · ${store.name}` : `${doc.store.code} · ${doc.store.name}`}</b></li>}
              {s.seller_code && <li><Icon name="user" size={13} /> {t("adm.sd.seller")}: <b>{s.seller_code}</b></li>}
              {(terminal?.code || doc?.terminal?.code) && <li><Icon name="store" size={13} /> {t("adm.sd.terminal")}: <b>{terminal?.code || doc.terminal.code}</b></li>}
            </ul>
          )}
        </header>

        <div className="sd-body">
          {state === "loading" && <div className="sd-loading" aria-busy="true"><div className="sd-skel" /><div className="sd-skel" /><div className="sd-skel" /><p className="sd-empty">{t("adm.sd.loading")}</p></div>}
          {state === "error" && (
            <div className="sd-card"><p className="sd-empty">{t("adm.sd.notFound")}</p><div><button type="button" className="btn-sm" onClick={() => setTick((n) => n + 1)}><Icon name="refresh" size={14} /> {t("adm.sd.retry")}</button></div></div>
          )}
          {s && (
            <>
              {s.void_requested_at && s.status !== "voided" && <div className="sd-banner warn">{t("adm.pos.sales.voidPending", { reason: t(`adm.pos.void.${s.void_reason}`) })}</div>}
              {s.status === "voided" && <div className="sd-banner bad">{t("adm.pos.sales.voidedAt", { date: fmt(s.voided_at, lang), reason: t(`adm.pos.void.${s.void_reason}`) })}</div>}

              <Section icon="user" title={t("adm.sd.sec.customer")}>
                {custName ? <div className="sd-name">{custName}</div> : <p className="sd-empty">{t("adm.sd.noCustomer")}</p>}
                <dl className="sd-kv">
                  {custPhone && <><dt>{t("adm.sd.phone")}</dt><dd><a href={`tel:${custPhone}`}>{custPhone}</a></dd></>}
                  {customer?.email && <><dt>{t("adm.sd.email")}</dt><dd><a href={`mailto:${customer.email}`}>{customer.email}</a></dd></>}
                  <dt>{t("adm.sd.delivery")}</dt><dd>{s.delivery === "ship" ? <><Icon name="truck" size={13} /> {t("adm.sd.delivery.ship")}</> : <><Icon name="store" size={13} /> {t("adm.sd.delivery.pickup")}</>}</dd>
                  {s.promised_on && <><dt>{t("adm.sd.promised")}</dt><dd><b>{dayLabel(s.promised_on, lang)}</b></dd></>}
                  {s.tray && <><dt>{t("adm.sd.tray")}</dt><dd><b>{s.tray}</b></dd></>}
                </dl>
              </Section>

              <Section icon="glasses" title={t("adm.sd.sec.frame")}>
                {lines.length === 0 && <p className="sd-empty">{t("adm.sd.noLines")}</p>}
                {lines.map((l, i) => {
                  const own = l.kind === "own_frame";
                  const lens = l.lens ? [bi(l.lens.design, lang), bi(l.lens.material, lang), bi(l.lens.photo, lang), bi(l.lens.ar, lang)].filter(Boolean) : [];
                  const rx = l.prescription_id ? rxFor(l) : null;
                  return (
                    <div key={i} className="sd-line">
                      <PosFramePhoto line={{ kind: l.kind, image: own ? null : l.image_url, photo: own ? l.image_url : null, title: l.title }} size="md" />
                      <div className="sd-line-info">
                        <div className="sd-line-title">{own ? t("adm.sd.ownFrame") : [l.frame?.brand && !String(l.title || "").toLowerCase().startsWith(String(l.frame.brand).toLowerCase()) ? l.frame.brand : null, l.title].filter(Boolean).join(" ")}</div>
                        <div className="sd-line-sub">
                          {own ? <span>{l.own_frame?.description || l.title || t("adm.sd.ownNoDesc")}</span> : (
                            <>
                              {l.frame?.brand && <span>{t("adm.sd.brand")}: <b>{l.frame.brand}</b></span>}
                              {l.variant_title && <span>{t("adm.sd.color")}: <b>{l.variant_title}</b></span>}
                              {l.sku && <span>{t("adm.sd.sku")}: <b>{l.sku}</b></span>}
                            </>
                          )}
                          {l.quantity > 1 && <span>×{l.quantity}</span>}
                        </div>
                        <div className="sd-chips">
                          {lens.length ? lens.map((x) => <span key={x} className="adm-chip neutral">{x}</span>) : <span className="adm-chip neutral">{t("adm.sd.frameOnly")}</span>}
                          <span className={`adm-chip ${l.prescription_id ? "ok" : "neutral"}`}>{l.prescription_id ? t("adm.sd.rxYes") : t("adm.sd.rxNo")}</span>
                        </div>
                        <div className="sd-line-price">{l.frame_price > 0 || l.lens_price > 0 ? <>{t("adm.pos.sum.frame")} {m(l.frame_price)} · {t("adm.sd.lenses")} {m(l.lens_price)}</> : m(l.unit_price)}</div>
                        {l.prescription_id && rxAllowed && (
                          <div className="sd-rx">
                            {!rxDoc && <p className="sd-hint">{t("adm.sd.rxLoading")}</p>}
                            {rxDoc && !rx && <p className="sd-hint">{t("adm.pos.sum.noRx")}</p>}
                            {rx && (
                              <>
                                <div className="sd-rx-head">{rx.rx_number && <span>{t("adm.sd.rxNumber")} <b>{rx.rx_number}</b></span>}{rx.seg_height != null && <span className="sd-muted">{t("adm.sd.rx.seg")}: {fmtRx(rx.seg_height, 2, false)}</span>}</div>
                                <RxGrid rx={rx} />
                              </>
                            )}
                          </div>
                        )}
                        {l.prescription_id && !rxAllowed && <p className="sd-hint">{t("adm.sd.rxHidden")}</p>}
                      </div>
                    </div>
                  );
                })}
              </Section>

              <Section icon="dollar" title={t("adm.sd.sec.amounts")}>
                <dl className="sd-totals">
                  <div><dt>{t("adm.sd.list")}</dt><dd>{m(s.list)}</dd></div>
                  {s.discount > 0 && <div><dt>{t("adm.sd.discount", { n: s.discount_pct })}</dt><dd>−{m(s.discount)}</dd></div>}
                  {doc?.totals?.tax > 0 && <div><dt>{t("adm.sd.tax")}</dt><dd>{m(doc.totals.tax)}</dd></div>}
                  <div className="sd-total"><dt>{t("adm.sd.total")}</dt><dd>{m(s.total)}</dd></div>
                  <div><dt>{t("adm.sd.paid")}</dt><dd>{m(s.paid)}</dd></div>
                  {s.insurance > 0 && <div><dt>{t("adm.sd.insurance")}</dt><dd>{m(s.insurance)}</dd></div>}
                  <div className="sd-due"><dt>{t("adm.sd.balance")}</dt><dd className={s.balance > 0 ? "pos" : "ok"}>{m(s.balance)}</dd></div>
                </dl>
                {econ && (
                  <div className="sd-econ">
                    <p className="sd-hint"><Icon name="lock" size={12} /> {t("adm.sd.econ.title")}</p>
                    <div className="sd-econ-grid">
                      {costOf(econ) != null && <div className="sd-econ-kpi"><small>{t("adm.sd.econ.cost")}</small><b>{m(costOf(econ))}</b></div>}
                      {econ.commission != null && <div className="sd-econ-kpi"><small>{t("adm.sd.econ.commission")}</small><b>{m(econ.commission)}</b></div>}
                      {econ.profit != null && <div className="sd-econ-kpi"><small>{t("adm.sd.econ.profit")}</small><b className={Number(econ.profit) < 0 ? "neg" : "pos"}>{m(econ.profit)}</b></div>}
                      {econ.profit != null && <div className="sd-econ-kpi"><small>{t("adm.sd.econ.margin")}</small><b>{pct(econ.margin_pct)}</b></div>}
                    </div>
                    {econ.missing_cost && <p className="sd-hint">{t("adm.sd.econ.missing")}</p>}
                  </div>
                )}
              </Section>

              <Section icon="wallet" title={t("adm.sd.sec.payments")} right={s.balance > 0 ? <span className="adm-chip warn">{t("adm.sd.balance")} {m(s.balance)}</span> : null}>
                {s.payments.length === 0 ? <p className="sd-empty">{t("adm.sd.pay.empty")}</p> : (
                  <table className="sd-table">
                    <thead><tr><th>{t("adm.sd.pay.when")}</th><th>{t("adm.sd.pay.method")}</th><th>{t("adm.sd.pay.kind")}</th><th className="r">{t("adm.sd.pay.amount")}</th></tr></thead>
                    <tbody>
                      {s.payments.map((p, i) => (
                        <tr key={i}>
                          <td>{fmt(p.created_at, lang)}</td>
                          <td>{methodLabel(p)}{p.reference && <><br /><small className="sd-muted">{t("adm.sd.pay.reference")}: {p.reference}</small></>}</td>
                          <td>{t(`adm.pos.sales.pay.${p.kind}`)}</td>
                          <td className={`r ${p.kind === "refund" || p.amount < 0 ? "neg" : ""}`}><b>{m(p.amount)}</b></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {data.insurance_claims?.length > 0 && (
                  <p className="sd-hint">{t("adm.sd.claims")}: {data.insurance_claims.map((c) => `${c.payer_name}: ${m(c.covered)} · ${t(`adm.pos.claims.status.${c.status}`)}`).join(" — ")}</p>
                )}
                {canCollect && (
                  <div className="sd-collect adm-noprint">
                    <h4 className="sd-card-head"><Icon name="plus" size={13} /> {t("adm.sd.collect.title")}</h4>
                    <div className="sd-collect-row">
                      <select value={pay.method_code} onChange={(e) => setPay((p) => ({ ...p, method_code: e.target.value, details: {} }))} aria-label={t("adm.pos.pay.method")} title={t("adm.pos.pay.method")}>
                        <option value="">{t("adm.pos.pay.method")}</option>
                        {methods.map((x) => <option key={x.code} value={x.code}>{methodName(x, t, lang)}</option>)}
                      </select>
                      <input inputMode="decimal" value={pay.amount} onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value.replace(/[^\d.]/g, "") }))} placeholder={t("adm.pos.pay.amount")} aria-label={t("adm.pos.pay.amount")} />
                      <button type="button" className="btn-xs" onClick={() => setPay((p) => ({ ...p, amount: String(s.balance) }))}>{t("adm.pos.pay.rest")}</button>
                    </div>
                    {meth?.reference_fields?.length > 0 && (
                      <div className="sd-collect-row">
                        {meth.reference_fields.map((f) => (
                          <input key={f.key} value={pay.details[f.key] || ""} onChange={(e) => setPay((p) => ({ ...p, details: { ...p.details, [f.key]: e.target.value } }))}
                            placeholder={`${meth.builtin ? t(`adm.pos.ref.${f.key}`) : (lang === "en" && f.label_en) || f.label || f.key}${f.required ? " *" : ""}`}
                            aria-label={meth.builtin ? t(`adm.pos.ref.${f.key}`) : f.label || f.key} />
                        ))}
                      </div>
                    )}
                    <div className="sd-collect-row">
                      <button type="button" className="btn-sm primary" disabled={busy || !pay.method_code || !Number(pay.amount)} onClick={collect}><Icon name="check" size={14} /> {t("adm.sd.collect.btn")}</button>
                      <p className="sd-hint">{t("adm.sd.collect.hint")}</p>
                    </div>
                  </div>
                )}
              </Section>

              <Section icon="printer" title={t("adm.sd.sec.documents")} right={doc ? (doc.print.count > 0 ? t("adm.sd.reprints", { n: doc.print.count }) : t("adm.sd.noReprints")) : null}>
                <SaleDocuments saleId={s.id} compact printer={terminal?.printer ?? doc?.terminal?.printer ?? null} />
              </Section>

              <Section icon="history" title={t("adm.sd.sec.history")}>
                <ol className="sd-timeline">
                  {history.map((h) => (
                    <li key={h.key} className={`sd-tl ${h.tone} ${h.future ? "future" : ""}`}>
                      <span className="sd-tl-dot"><Icon name={h.icon} size={10} /></span>
                      <span className="sd-tl-what">{h.what}{h.sub && <small>{h.sub}</small>}</span>
                      <span className="sd-tl-when">{h.at ? fmt(h.at, lang) : ""}</span>
                    </li>
                  ))}
                </ol>
              </Section>
            </>
          )}
        </div>

        <footer className="sd-foot adm-noprint">
          {canDeliver && (
            <button type="button" className="btn-sm primary" disabled={busy || s.balance > 0} title={s.balance > 0 ? t("adm.err.pos.balance_due") : undefined} onClick={deliver}><Icon name="hand" size={14} /> {t("adm.sd.act.deliver")}</button>
          )}
          {canVoidBtn && (
            <button type="button" className="btn-sm danger" disabled={busy} onClick={() => setVoiding((v) => ({ ...v, open: !v.open, reason: v.reason || s.void_reason || "" }))}>
              <Icon name="undo" size={14} /> {ctx?.can_void ? (s.void_requested_at ? t("adm.sd.act.confirmVoid") : t("adm.sd.act.void")) : t("adm.sd.act.requestVoid")}
            </button>
          )}
          <span className="sd-spacer" />
          <button type="button" className="btn-sm" onClick={onClose}><Icon name="close" size={14} /> {t("adm.sd.close")}</button>
          {voiding.open && s && (
            <div className="sd-void">
              <p className="sd-void-title">{t("adm.sd.void.title")}</p>
              <div className="sd-void-row">
                <select value={voiding.reason} onChange={(e) => setVoiding((v) => ({ ...v, reason: e.target.value }))} aria-label={t("adm.pos.sales.voidReason")} title={t("adm.pos.sales.voidReason")}>
                  <option value="">{t("adm.pos.sales.voidReason")}</option>
                  {(ctx?.void_reasons || []).map((r) => <option key={r} value={r}>{t(`adm.pos.void.${r}`)}</option>)}
                </select>
                <input value={voiding.note} onChange={(e) => setVoiding((v) => ({ ...v, note: e.target.value }))} placeholder={t("adm.pos.sales.voidNote")} aria-label={t("adm.pos.sales.voidNote")} />
              </div>
              <div className="sd-void-row">
                <button type="button" className="btn-sm warn" disabled={busy || !voiding.reason} onClick={doVoid}>{ctx?.can_void ? t("adm.sd.act.void") : t("adm.sd.act.requestVoid")}</button>
                <button type="button" className="btn-sm" disabled={busy} onClick={() => setVoiding({ open: false, reason: "", note: "" })}>{t("adm.sd.void.cancel")}</button>
                <small className="sd-hint">{t("adm.pos.sales.voidHint")}</small>
              </div>
            </div>
          )}
        </footer>
      </aside>
    </div>,
    document.body,
  );
}

/**
 * Dos líneas para que cualquier pantalla abra la ficha:
 *   const sp = useSalePanel({ me, ctx?, onChanged? });
 *   …onClick={() => sp.open(sale.id, { economics: row })}… {sp.panel}
 * `sp.saleId` es la venta abierta (para resaltar su fila); `sp.close()` la cierra.
 */
export function useSalePanel({ me, ctx = null, onChanged } = {}) {
  const [cur, setCur] = useState({ id: null, extra: {} });
  const open = useCallback((saleId, extra = {}) => { if (saleId) setCur({ id: saleId, extra: extra || {} }); }, []);
  const close = useCallback(() => setCur((c) => (c.id ? { ...c, id: null } : c)), []);
  const panel = <SaleDetailPanel saleId={cur.id} open={Boolean(cur.id)} onClose={close} onChanged={onChanged} me={me} ctx={ctx} economics={cur.extra.economics || null} />;
  return { open, close, panel, saleId: cur.id };
}

// Dónde se usa: en toda pantalla que liste ventas o pedidos — Ventas de tienda
// (PosSales), Pedidos y etapas (StoreOrders, también dentro del Ejecutivo),
// Estado de cuenta (StoreStatement), Mi panel y Cobros pendientes. Al pulsar
// una venta o un pedido se abre esta ficha delante de la pantalla (fondo
// atenuado) con TODO: cliente, montura y lentes con foto (y la receta para
// quien puede verla), la ETAPA del pedido con su línea de tiempo y los botones
// para avanzarla, importes, cobros (y registrar uno), documentos e historial.
// Desde aquí también se entrega y se anula (o se pide anular).
//
//   const sp = useSalePanel({ me, onChanged: reload });
//   <tr onClick={() => sp.open(sale.id, { economics: row })}>…</tr>      // venta de caja
//   <tr onClick={() => sp.open({ orderId: order.id })}>…</tr>            // pedido web (sin venta de caja)
//   {sp.panel}
//
// Datos: GET /admin/pos/sales/:id (venta, cobros, seguros), GET …/documents?kind=receipt
// (líneas con foto, cliente, impuesto, impresiones — sin registrar impresión),
// GET /admin/pos/customers/:id (correo) y, solo para administradores, supervisores
// y encargados, GET …/documents?kind=job (valores de la receta). La etapa y, para
// un pedido web, los artículos, la dirección y los cobros de Medusa: GET
// /admin/order-board/:id (la venta de caja lleva `order_id`; un pedido de caja
// abierto por `orderId` lleva `pos_sale_id` y pasa a la ficha de venta). Avanzar
// = POST /admin/order-board/:id/stage con una de `next_stages`. Costo, comisión y
// ganancia nunca se piden aquí: llegan en `economics` desde la lista que ya los
// tenía (y solo si el servidor los dio).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { STAGES, STAGE_BY_KEY, money, orderLabel, setOrderStage, stageErrorText } from "./adminOrders.js";
import { adminFetch } from "./adminApi.js";
import { collectPayment, deliverSale, fetchCustomer, fetchSale, fetchSaleDocument, methodName, posContext, voidSale } from "./posApi.js";
import SaleDocuments from "./SaleDocuments.jsx";
import PosFramePhoto from "./PosFramePhoto.jsx";
import { StageChip, STAGE_ICON, STAGE_INDEX, nextForward, stageLabel } from "./StageBar.jsx";
import { DESIGNS, MATERIALS, PHOTO, AR_OPTIONS, L } from "../data/lensPricing.js";
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

/** Etiqueta de un código de lente de un pedido web (lensPricing.js), o el código tal cual. */
const lensCodeLabel = (list, code, lang) => { if (!code) return ""; const x = (Array.isArray(list) ? list : []).find((i) => i.id === code); return x ? L(x.label, lang) : String(code); };
const lensChipsOf = (lens, lang) => (lens ? [lensCodeLabel(DESIGNS, lens.design_code, lang), lensCodeLabel(MATERIALS, lens.material_code, lang), lensCodeLabel(PHOTO, lens.photo_code, lang), lensCodeLabel(AR_OPTIONS, lens.ar_code, lang)].filter(Boolean) : []);
/** Proveedor de pago de Medusa, legible: «pp_stripe_stripe» → «stripe»; el manual del POS, «caja». */
const providerName = (id, t) => { const k = String(id || "").replace(/^pp_/, "").split("_")[0]; return !k ? "—" : k === "system" ? t("adm.sd.order.posSale") : k; };

/**
 * Cuándo alcanzó el pedido cada etapa: el historial que escribe transitionOrderStage
 * (`stage_history`), y si falta, lo que Medusa registró (creación, preparación,
 * envío, entrega) o la entrega en caja. null = sin fecha conocida.
 */
export function stageDateOf(order, key) {
  if (!order) return null;
  const hist = (order.stage_history || []).filter((h) => h.stage === key).at(-1)?.at;
  if (hist) return hist;
  const live = (order.fulfillments || []).filter((f) => !f.canceled_at);
  switch (key) {
    case "confirmed": return order.created_at || null;
    case "shipped": return live.map((f) => f.packed_at || f.created_at).find(Boolean) || null;
    case "in_transit": return live.map((f) => f.shipped_at).find(Boolean) || null;
    case "delivered": return live.map((f) => f.delivered_at).find(Boolean) || order.pos_delivered_at || null;
    default: return null;
  }
}

/**
 * Bloque «Etapa del pedido»: la línea de las cinco etapas con su fecha, el
 * estado terminal si lo hay, y un botón por cada etapa que el servidor acepta
 * ahora (`next_stages`) — la siguiente natural en primario. Lo usan la ficha
 * de venta (por `sale.order_id`) y la de pedido web.
 */
function StageBlock({ order, state, moving, onMove, tracking, setTracking }) {
  const { t, lang } = useLang();
  if (state === "none") return <p className="sd-empty">{t("adm.sd.stage.noOrder")}</p>;
  if (state === "loading" || !order) return <p className="sd-hint">{state === "error" ? t("adm.sd.stage.failed") : t("adm.sd.stage.loading")}</p>;
  const cur = order.terminal ? -1 : STAGE_INDEX[order.stage] ?? 0;
  const next = order.next_stages || [];
  const natural = nextForward(order);
  const needsTracking = next.includes("in_transit");
  return (
    <>
      <ol className="sd-stages">
        {STAGES.map((st, i) => {
          const at = stageDateOf(order, st.key);
          const tone = order.terminal ? "off" : i < cur ? "done" : i === cur ? "current" : "todo";
          return (
            <li key={st.key} className={`sd-stage ${tone}`}>
              <span className="sd-stage-dot"><Icon name={STAGE_ICON[st.key]} size={12} /></span>
              <b>{t(st.label)}</b>
              <small>{at && tone !== "todo" ? fmt(at, lang) : tone === "current" ? t("adm.sd.stage.now") : t("adm.sd.stage.pendingStep")}</small>
            </li>
          );
        })}
      </ol>
      {order.terminal && <div className={`sd-banner ${order.terminal === "payment_pending" ? "warn" : "bad"}`}>{t("adm.sd.stage.terminal", { state: stageLabel(order.terminal, t) })}</div>}
      {order.pos_delivered_at && <p className="sd-hint"><Icon name="hand" size={12} /> {t("adm.sd.stage.posDelivered")} · {fmt(order.pos_delivered_at, lang)}</p>}
      {next.length ? (
        <div className="sd-stage-actions adm-noprint">
          {needsTracking && <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder={t("adm.sd.stage.tracking")} aria-label={t("adm.sd.stage.tracking")} />}
          {next.map((k) => (
            <button key={k} type="button" className={`btn-sm ${k === natural ? "primary" : ""}`} disabled={moving} onClick={() => onMove(k)} title={t(STAGE_BY_KEY[k].action)}>
              <Icon name={STAGE_ICON[k]} size={13} /> {t("adm.sd.stage.moveTo", { stage: t(STAGE_BY_KEY[k].label) })}
            </button>
          ))}
        </div>
      ) : !order.terminal && <p className="sd-hint">{t("adm.sd.stage.none")}</p>}
    </>
  );
}

/**
 * Props: `saleId` (venta de caja) o `orderId` (pedido de Medusa, p. ej. web),
 * `open`, `onClose`, `onChanged` (tras cobrar/entregar/anular/avanzar, para
 * que la lista se refresque), `me` (GET /admin/team/me; sin él se usa el
 * contexto del POS), `economics` (fila de /admin/sales-analytics/sales con
 * cost/fee/commission/profit/margin_pct, opcional), `ctx` (contexto del POS si
 * la pantalla ya lo tiene; opcional).
 */
export default function SaleDetailPanel({ saleId: givenSaleId, orderId: givenOrderId = null, open, onClose, onChanged, me, economics = null, ctx: givenCtx = null }) {
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
  // El pedido de Medusa detrás (etapa, next_stages, historial; artículos y cobros de un pedido web).
  const [order, setOrder] = useState(null);
  const [orderState, setOrderState] = useState("idle");
  const [moving, setMoving] = useState(false);
  const [tracking, setTracking] = useState("");
  const [oTick, setOTick] = useState(0);
  const panelRef = useRef(null);
  const m = (v) => money(v, "usd", lang);

  useEffect(() => { if (givenCtx) setCtx(givenCtx); else loadCtx().then(setCtx).catch(() => setCtx({ stores: [], payment_methods: [], void_reasons: [], can_void: false })); }, [givenCtx]);

  const who = me || (ctx && ctx.role !== undefined ? { is_admin: ctx.is_admin, role: ctx.role } : null);
  const rxAllowed = canSeeRx(who);

  // Un pedido de caja abierto por `orderId` lleva `pos_sale_id`: se pinta la ficha de venta completa.
  const saleId = givenSaleId || (!givenSaleId && order && givenOrderId && order.id === givenOrderId ? order.pos_sale_id : null) || null;
  const orderMode = !saleId && Boolean(givenOrderId);

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

  // El pedido: el dado (`orderId`) o el de la venta (`sale.order_id`). Sin pedido, sin etapas.
  const orderIdToLoad = givenOrderId || data?.sale?.order_id || null;
  // El tablero de pedidos no admite al vendedor (boardAccessFor: forbidden_role):
  // no se pide, y la sección de etapa no se pinta en vez de decir «no se pudo
  // leer», que suena a avería.
  const canReadBoard = !who || who.is_admin !== false || who.role === "supervisor" || who.role === "manager";
  useEffect(() => {
    if (!open) return undefined;
    if (!canReadBoard) { setOrder(null); setOrderState("none"); return undefined; }
    if (!orderIdToLoad) { if (givenSaleId && data) { setOrder(null); setOrderState("none"); } else { setOrder(null); setOrderState("idle"); } return undefined; }
    let on = true;
    setOrderState("loading");
    setTracking("");
    adminFetch(`/admin/order-board/${encodeURIComponent(orderIdToLoad)}`)
      .then((r) => { if (on) { setOrder(r.order || null); setOrderState(r.order ? "ok" : "error"); } })
      .catch(() => { if (on) { setOrder(null); setOrderState("error"); } });
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderIdToLoad, tick, oTick, Boolean(data), canReadBoard]);
  useEffect(() => { if (!open) { setOrder(null); setOrderState("idle"); } }, [open]);
  // Sin venta (ficha de pedido web, o cerrada): nada de la venta anterior se queda pintado.
  useEffect(() => { if (!saleId) { setData(null); setDoc(null); setCustomer(null); setRxDoc(null); setState("idle"); } }, [saleId]);

  // Avanzar (o retroceder la nota de laboratorio): una de `next_stages`, confirmada; el servidor devuelve el pedido ya movido.
  const moveStage = async (stage) => {
    if (!order) return;
    const st = STAGE_BY_KEY[stage];
    const n = data?.sale?.number || orderLabel(order);
    if (!(await confirm({ title: t("adm.sd.stage.confirm", { n, stage: t(st.label) }), message: t(st.action) }))) return;
    setMoving(true);
    try {
      const after = await setOrderStage(order.id, stage, { trackingNumber: stage === "in_transit" ? tracking.trim() : "" });
      if (after) setOrder((o) => ({ ...(o || {}), ...after })); else setTick((x) => x + 1);
      toast({ tone: "success", title: t("adm.sd.stage.moved", { stage: t(st.label) }) });
      onChanged?.();
    } catch (e) { toast({ tone: "error", title: stageErrorText(t, e) }); }
    finally { setMoving(false); }
  };

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
  const methods = useMemo(() => (ctx?.payment_methods || []).filter((x) => (!store || (store.payment_methods || []).includes(x.code)) && !(x.kind === "insurance" || x.receivable)), [ctx, store]);
  const meth = methods.find((x) => x.code === pay.method_code);
  // El monto propuesto es el saldo; cambia cuando la venta cambia (tras un cobro parcial).
  useEffect(() => { if (s) setPay((p) => ({ ...p, amount: s.balance > 0 ? String(s.balance) : "" })); }, [s?.balance]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn, ok) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r?.sale) setData((d) => ({ ...d, sale: r.sale }));
      toast({ tone: "success", title: ok(r) });
      // Entregar / anular mueven el pedido de Medusa (entrega en caja, cancelación): la etapa se relee.
      setOTick((n) => n + 1);
      onChanged?.();
    } catch (e) { toast({ tone: "error", title: t(errKey(e)) }); }
    finally { setBusy(false); }
  };
  const collect = () => run(
    () => collectPayment(s.id, payRow()),
    () => { setPay({ method_code: "", amount: "", details: {} }); return t("adm.pos.sales.collected"); },
  );
  const deliver = async () => {
    if (!(await confirm({ title: t("adm.pos.sales.deliverConfirm", { n: s.number }), message: t("adm.ops.deliver.body") }))) return;
    run(() => deliverSale(s.id), () => t("adm.pos.sales.delivered"));
  };
  // HU-32: the whole balance and the hand-over in one call (POST …/deliver with payments).
  const payRow = () => [{ method_code: pay.method_code, amount: pay.amount, details: pay.details }];
  const collectAndDeliver = async () => {
    if (!(await confirm({ title: t("adm.ops.collectDeliver.confirm", { v: m(s.balance), n: s.number }), message: t("adm.ops.collectDeliver.hint") }))) return;
    run(
      () => deliverSale(s.id, payRow()),
      () => { setPay({ method_code: "", amount: "", details: {} }); return t("adm.ops.collectDeliver.done"); },
    );
  };
  // The footer shortcut: the balance as the amount and the collection form in view.
  const collectRef = useRef(null);
  const startCollectDeliver = () => {
    setPay((p) => ({ ...p, amount: String(s.balance) }));
    collectRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    collectRef.current?.querySelector("select")?.focus();
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
  // One step for both (HU-32), only when the amount typed is exactly the balance.
  const canCollectDeliver = canCollect && canDeliver;
  const fullAmount = s ? Math.round((Number(pay.amount) || 0) * 100) === Math.round(s.balance * 100) : false;
  const canVoidBtn = s && s.status !== "voided";

  // Pedido web (sin venta de caja): cabecera, cliente, artículos, importes y cobros salen del pedido.
  const o = orderMode ? order : null;
  const oStage = o ? (o.terminal === "canceled" || o.terminal === "refunded" ? "voided" : o.terminal || o.stage) : null;
  const oStoreLabel = o ? (o.channel === "pos" ? ((ctx?.stores || []).find((x) => x.id === o.establishment_id) || null) : null) : null;
  const oHistory = !o ? [] : [
    { at: o.created_at, key: "created", tone: "accent", icon: "receipt", what: t("adm.sd.h.created"), sub: o.seller_code || "" },
    ...(o.stage_history || []).map((h, i) => ({ at: h.at, key: `h${i}`, tone: h.stage === "delivered" ? "ok" : "", icon: STAGE_ICON[h.stage] || "box", what: stageLabel(h.stage, t), sub: "" })),
    ...(o.payments || []).filter((p) => p.captured > 0 || p.refunded > 0).map((p, i) => ({ at: p.captured_at || p.created_at, key: `p${i}`, tone: p.refunded > 0 && p.captured === 0 ? "bad" : "ok", icon: "dollar", what: `${t("adm.sd.pay.captured")} · ${money(p.captured, p.currency_code, lang)}`, sub: providerName(p.provider_id, t) })),
  ].filter((h) => h.at).sort((a, b) => new Date(a.at) - new Date(b.at));
  const headNumber = s ? s.number : o ? orderLabel(o) : "…";
  const stageRight = order && orderState === "ok" ? <StageChip stage={order.terminal === "canceled" || order.terminal === "refunded" ? "voided" : order.terminal || order.stage} t={t} /> : null;
  const stageSection = !canReadBoard ? null : (
    <Section icon="layers" title={t("adm.sd.sec.stage")} right={stageRight}>
      <StageBlock order={order} state={orderState} moving={moving} onMove={moveStage} tracking={tracking} setTracking={setTracking} />
    </Section>
  );

  return createPortal(
    <div className="sd-root" role="presentation" onKeyDown={onKey}>
      <div className="sd-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="sd-panel" role="dialog" aria-modal="true" aria-label={`${orderMode ? t("adm.sd.order.title") : t("adm.sd.title")} ${headNumber}`} tabIndex={-1} ref={panelRef}>
        <header className="sd-head">
          <div className="sd-head-row">
            <div style={{ minWidth: 0 }}>
              <p className="sd-kicker">{orderMode ? t("adm.sd.order.title") : t("adm.sd.title")}</p>
              <h2 className="sd-number">
                {headNumber}
                {status && <span className={`adm-chip ${status[1]}`}>{t(`adm.sd.st.${status[0]}`)}</span>}
                {s?.void_requested_at && s.status !== "voided" && <span className="adm-chip warn">{t("adm.sd.st.voidAsked")}</span>}
                {o && <StageChip stage={oStage} t={t} />}
                {o && !o.terminal && <span className={`adm-chip ${o.paid ? "ok" : "warn"}`}>{t(o.paid ? "adm.sd.order.paid" : "adm.sd.order.unpaid")}</span>}
              </h2>
            </div>
            <div className="sd-head-actions adm-noprint">
              <button type="button" className="sd-icobtn" onClick={() => window.print()} title={t("adm.sd.print")} aria-label={t("adm.sd.print")} disabled={!s && !o}><Icon name="printer" size={15} /></button>
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
          {o && (
            <ul className="sd-meta">
              <li><Icon name="calendar" size={13} /> <b>{fmt(o.created_at, lang)}</b></li>
              <li>{o.channel === "pos" ? <span className="sd-dot" style={{ background: oStoreLabel?.color || "var(--adm-line)" }} /> : <Icon name="globe" size={13} />} {t("adm.sd.store")}: <b>{o.channel === "pos" ? (oStoreLabel ? `${oStoreLabel.code} · ${oStoreLabel.name}` : o.establishment_id || "—") : t("adm.sd.order.web")}</b></li>
              {o.seller_code && <li><Icon name="user" size={13} /> {t("adm.sd.order.seller")}: <b>{o.seller_code}</b></li>}
              {o.has_prescription && <li><Icon name="eye" size={13} /> <b>{t("adm.sd.rxYes")}</b></li>}
            </ul>
          )}
        </header>

        <div className="sd-body">
          {(state === "loading" || (orderMode && orderState === "loading")) && <div className="sd-loading" aria-busy="true"><div className="sd-skel" /><div className="sd-skel" /><div className="sd-skel" /><p className="sd-empty">{t("adm.sd.loading")}</p></div>}
          {(state === "error" || (orderMode && orderState === "error")) && (
            <div className="sd-card"><p className="sd-empty">{orderMode ? t("adm.sd.order.notFound") : t("adm.sd.notFound")}</p><div><button type="button" className="btn-sm" onClick={() => setTick((n) => n + 1)}><Icon name="refresh" size={14} /> {t("adm.sd.retry")}</button></div></div>
          )}
          {o && orderState === "ok" && (
            <>
              {o.owner_note && <div className="sd-banner info"><b>{t("adm.sd.order.note")}:</b> {o.owner_note}</div>}
              {stageSection}

              <Section icon="user" title={t("adm.sd.sec.customer")}>
                {o.customer?.name ? <div className="sd-name">{o.customer.name}</div> : <p className="sd-empty">{t("adm.sd.noCustomer")}</p>}
                <dl className="sd-kv">
                  {o.customer?.phone && <><dt>{t("adm.sd.phone")}</dt><dd><a href={`tel:${o.customer.phone}`}>{o.customer.phone}</a></dd></>}
                  {o.customer?.email && <><dt>{t("adm.sd.email")}</dt><dd><a href={`mailto:${o.customer.email}`}>{o.customer.email}</a></dd></>}
                  <dt>{t("adm.sd.order.address")}</dt>
                  <dd>{o.shipping_address ? [o.shipping_address.address_1, o.shipping_address.address_2, [o.shipping_address.city, o.shipping_address.province, o.shipping_address.postal_code].filter(Boolean).join(", "), String(o.shipping_address.country_code || "").toUpperCase()].filter(Boolean).join(" · ") : <span className="sd-muted">{t("adm.sd.order.noAddress")}</span>}</dd>
                  {o.shipping_method && <><dt>{t("adm.sd.order.shippingMethod")}</dt><dd>{o.shipping_method}</dd></>}
                  {o.tracking_number && <><dt>{t("adm.sd.order.tracking")}</dt><dd>{o.tracking_url ? <a href={o.tracking_url} target="_blank" rel="noreferrer">{o.tracking_number}</a> : <b>{o.tracking_number}</b>}</dd></>}
                </dl>
              </Section>

              <Section icon="glasses" title={t("adm.sd.order.items")}>
                {!(o.items || []).length && <p className="sd-empty">{t("adm.sd.order.noItems")}</p>}
                {(o.items || []).map((it, i) => {
                  const lens = lensChipsOf(it.lens, lang);
                  return (
                    <div key={it.id || i} className="sd-line">
                      <PosFramePhoto line={{ kind: "frame", image: it.thumbnail, title: it.title }} size="md" />
                      <div className="sd-line-info">
                        <div className="sd-line-title">{it.title}</div>
                        <div className="sd-line-sub">
                          {it.variant_title && <span>{t("adm.sd.color")}: <b>{it.variant_title}</b></span>}
                          {it.sku && <span>{t("adm.sd.sku")}: <b>{it.sku}</b></span>}
                          {it.quantity > 1 && <span>×{it.quantity}</span>}
                        </div>
                        <div className="sd-chips">
                          {lens.length ? lens.map((x) => <span key={x} className="adm-chip neutral">{x}</span>) : <span className="adm-chip neutral">{t("adm.sd.frameOnly")}</span>}
                          <span className={`adm-chip ${it.has_prescription ? "ok" : "neutral"}`}>{it.has_prescription ? t("adm.sd.rxYes") : t("adm.sd.rxNo")}</span>
                        </div>
                        <div className="sd-line-price">{money(it.total, o.currency_code, lang)}</div>
                      </div>
                    </div>
                  );
                })}
              </Section>

              <Section icon="dollar" title={t("adm.sd.sec.amounts")}>
                <dl className="sd-totals">
                  <div><dt>{t("adm.sd.order.subtotal")}</dt><dd>{money(o.item_total, o.currency_code, lang)}</dd></div>
                  {Number(o.discount_total) > 0 && <div><dt>{t("adm.sd.order.discountTotal")}</dt><dd>−{money(o.discount_total, o.currency_code, lang)}</dd></div>}
                  {Number(o.shipping_total) > 0 && <div><dt>{t("adm.sd.order.shippingTotal")}</dt><dd>{money(o.shipping_total, o.currency_code, lang)}</dd></div>}
                  {Number(o.tax_total) > 0 && <div><dt>{t("adm.sd.tax")}</dt><dd>{money(o.tax_total, o.currency_code, lang)}</dd></div>}
                  <div className="sd-total"><dt>{t("adm.sd.total")}</dt><dd>{money(o.total, o.currency_code, lang)}</dd></div>
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

              <Section icon="wallet" title={t("adm.sd.sec.payments")}>
                {!(o.payments || []).length ? <p className="sd-empty">{t("adm.sd.pay.empty")}</p> : (
                  <table className="sd-table">
                    <thead><tr><th>{t("adm.sd.pay.when")}</th><th>{t("adm.sd.pay.provider")}</th><th>{t("adm.sd.pay.kind")}</th><th className="r">{t("adm.sd.pay.amount")}</th></tr></thead>
                    <tbody>
                      {o.payments.map((p, i) => (
                        <tr key={p.id || i}>
                          <td>{fmt(p.captured_at || p.created_at, lang)}</td>
                          <td>{providerName(p.provider_id, t)}</td>
                          <td>{p.canceled_at ? t("adm.sd.pay.canceled") : p.refunded > 0 ? `${t("adm.sd.pay.refunded")} · ${money(p.refunded, p.currency_code, lang)}` : p.captured > 0 ? t("adm.sd.pay.captured") : t("adm.sd.pay.pending")}</td>
                          <td className={`r ${p.canceled_at ? "neg" : ""}`}><b>{money(p.captured > 0 ? p.captured : p.amount, p.currency_code, lang)}</b></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>

              <Section icon="history" title={t("adm.sd.sec.history")}>
                <ol className="sd-timeline">
                  {oHistory.map((h) => (
                    <li key={h.key} className={`sd-tl ${h.tone}`}>
                      <span className="sd-tl-dot"><Icon name={h.icon} size={10} /></span>
                      <span className="sd-tl-what">{h.what}{h.sub && <small>{h.sub}</small>}</span>
                      <span className="sd-tl-when">{fmt(h.at, lang)}</span>
                    </li>
                  ))}
                </ol>
              </Section>
            </>
          )}
          {s && (
            <>
              {s.void_requested_at && s.status !== "voided" && <div className="sd-banner warn">{t("adm.pos.sales.voidPending", { reason: t(`adm.pos.void.${s.void_reason}`) })}</div>}
              {s.status === "voided" && <div className="sd-banner bad">{t("adm.pos.sales.voidedAt", { date: fmt(s.voided_at, lang), reason: t(`adm.pos.void.${s.void_reason}`) })}</div>}
              {stageSection}

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
                  <div className="sd-collect adm-noprint" ref={collectRef}>
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
                      <button type="button" className={`btn-sm ${canCollectDeliver ? "" : "primary"}`} disabled={busy || !pay.method_code || !Number(pay.amount)} onClick={collect}><Icon name="check" size={14} /> {t("adm.sd.collect.btn")}</button>
                      {canCollectDeliver && (
                        <button type="button" className="btn-sm primary" disabled={busy || !pay.method_code || !fullAmount} title={!fullAmount ? t("adm.ops.collectDeliver.full", { v: m(s.balance) }) : undefined} onClick={collectAndDeliver}>
                          <Icon name="hand" size={14} /> {t("adm.ops.collectDeliver")}
                        </button>
                      )}
                      <p className="sd-hint">{canCollectDeliver ? t("adm.ops.collectDeliver.hint") : t("adm.sd.collect.hint")}</p>
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
          {canCollectDeliver && !orderMode && (
            <button type="button" className="btn-sm primary" disabled={busy} onClick={startCollectDeliver}><Icon name="hand" size={14} /> {t("adm.ops.collectDeliver")}</button>
          )}
          {canDeliver && (
            <button type="button" className={`btn-sm ${canCollectDeliver ? "" : "primary"}`} disabled={busy || s.balance > 0} title={s.balance > 0 ? t("adm.err.pos.balance_due") : undefined} onClick={deliver}><Icon name="hand" size={14} /> {t("adm.sd.act.deliver")}</button>
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
    // Dentro del armazón (.adm-shell) para heredar los tokens del modo claro/oscuro y del tema de la tienda; el cajón es fixed, así que da igual dónde cuelgue.
    document.querySelector(".adm-shell") || document.body,
  );
}

/**
 * Dos líneas para que cualquier pantalla abra la ficha:
 *   const sp = useSalePanel({ me, ctx?, onChanged? });
 *   …onClick={() => sp.open(sale.id, { economics: row })}… {sp.panel}        // venta de caja
 *   …onClick={() => sp.open({ orderId: order.id }, { economics: row })}…     // pedido web / de Medusa
 * `sp.open` acepta el id de la venta (string) o `{ saleId }` / `{ orderId }`.
 * `sp.saleId` / `sp.orderId` es lo abierto (para resaltar su fila); `sp.close()` la cierra.
 */
export function useSalePanel({ me, ctx = null, onChanged } = {}) {
  const [cur, setCur] = useState({ id: null, orderId: null, extra: {} });
  const open = useCallback((ref, extra = {}) => {
    const saleId = typeof ref === "string" ? ref : ref?.saleId || null;
    const orderId = (typeof ref === "object" && ref?.orderId) || extra?.orderId || null;
    if (saleId || orderId) setCur({ id: saleId, orderId, extra: extra || {} });
  }, []);
  const close = useCallback(() => setCur((c) => (c.id || c.orderId ? { ...c, id: null, orderId: null } : c)), []);
  const isOpen = Boolean(cur.id || cur.orderId);
  const panel = <SaleDetailPanel saleId={cur.id} orderId={cur.orderId} open={isOpen} onClose={close} onChanged={onChanged} me={me} ctx={ctx} economics={cur.extra.economics || null} />;
  return { open, close, panel, saleId: cur.id, orderId: cur.orderId };
}

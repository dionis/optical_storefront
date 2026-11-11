// Dónde se usa: interior de /admin. Secciones Ejecutivo/Pedidos/Costos/Vendedores/Resumen/Ventas/Productos/Precios/Equipo/Seguridad dentro del armazón AdminShell (barra lateral de iconos).
import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { ensureSeed } from "./analytics.js";
import { isDemoLogin } from "./adminAuth.js";
import { getSession } from "./adminApi.js";
import { printElement } from "./exportUtils.js";
import { fetchSetup } from "./adminTenant.js";
// The Orders tab is the one part of this panel backed by the real store: it
// reads and mutates Medusa orders instead of the seeded localStorage the other
// tabs still use. `money` is aliased because this file already has its own,
// which assumes dollars and knows nothing about an order's currency.
import {
  STAGES, STAGE_BY_KEY, TERMINALS, TERMINAL_BY_KEY,
  fetchOrders, setOrderStage, setOrderTracking, setOrderNote, ordersToCsv, downloadText,
  orderLabel, stageErrorText, money as fmtMoney, shortDate, fetchPrescription,
} from "./adminOrders.js";
import { fetchOrderCost, marginTone } from "./adminCosting.js";
import { fetchSellers } from "./adminSellers.js";
import AdminShell, { navGroupsFor, tabsOf } from "./AdminShell.jsx";
import { fetchAiStatus } from "./aiUsage.js";
import { useSalePanel } from "./SaleDetailPanel.jsx";
import { useStoreFilter } from "./StoreFilter.jsx";
import { webStoreLabel } from "./useStoreTheme.js";
import WelcomeBriefing, { briefingShown } from "./WelcomeBriefing.jsx";
import Icon from "./icons.jsx";
import { TENANT } from "../config/tenant.js";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";

// RENDIMIENTO (tabletas de gama baja, 9-nov-2026): cada pestaña es su propio
// trozo de código y se baja la primera vez que se abre; el armazón, la ficha de
// venta y el saludo diario van en el trozo principal. Las pestañas de trabajo
// del rol se precargan en segundo plano tras el primer pintado (prefetchTabs).
const TAB_IMPORTS = {
  exec: () => import("./ExecutiveHub.jsx"),
  catalogsync: () => import("./CatalogSync.jsx"),
  team: () => import("./Team.jsx"),
  stores: () => import("./Stores.jsx"),
  security: () => import("./Security.jsx"),
  setup: () => import("./Setup.jsx"),
  profile: () => import("./StaffProfile.jsx"),
  audit: () => import("./AuditLog.jsx"),
  pos: () => import("./PosSale.jsx"),
  possales: () => import("./PosSales.jsx"),
  approvals: () => import("./PosApprovals.jsx"),
  posconfig: () => import("./PosConfig.jsx"),
  alerts: () => import("./AlertRules.jsx"),
  aiusage: () => import("./AiUsage.jsx"),
  salesboard: () => import("./SalesBoard.jsx"),
  storestatus: () => import("./StoreStatus.jsx"),
  mysales: () => import("./MySales.jsx"),
  cash: () => import("./PosCash.jsx"),
  storecosts: () => import("./StoreCosts.jsx"),
  statement: () => import("./StoreStatement.jsx"),
  storeorders: () => import("./StoreOrders.jsx"),
  pendingbalances: () => import("./PendingBalances.jsx"),
  patients: () => import("./Patients.jsx"),
  costs: () => import("./Costs.jsx"),
  sellers: () => import("./Sellers.jsx"),
  products: () => import("./PricingPanel.jsx"),
};
// La pestaña de la URL empieza a bajar ya, mientras se pinta el armazón (sin esperar a que React la pida).
try {
  const first = new URLSearchParams(window.location.search).get("tab");
  if (first && TAB_IMPORTS[first]) TAB_IMPORTS[first]().catch(() => {});
  // Nueva venta: el contexto del punto de venta (tiendas, cajas, formas de pago) también, con la sesión ya guardada.
  if (first === "pos" && getSession()) import("./posApi.js").then((m) => m.posContext()).catch(() => {});
} catch { /* sin window (pruebas) */ }
const ExecutiveHub = lazy(TAB_IMPORTS.exec);
const CatalogSync = lazy(TAB_IMPORTS.catalogsync);
const Team = lazy(TAB_IMPORTS.team);
const Stores = lazy(TAB_IMPORTS.stores);
const Security = lazy(TAB_IMPORTS.security);
const Setup = lazy(TAB_IMPORTS.setup);
const StaffProfile = lazy(TAB_IMPORTS.profile);
const AuditLog = lazy(TAB_IMPORTS.audit);
const PosSale = lazy(TAB_IMPORTS.pos);
const PosSales = lazy(TAB_IMPORTS.possales);
const PosApprovals = lazy(TAB_IMPORTS.approvals);
const PosConfig = lazy(TAB_IMPORTS.posconfig);
const AlertRules = lazy(TAB_IMPORTS.alerts);
const AiUsage = lazy(TAB_IMPORTS.aiusage);
const SalesBoard = lazy(TAB_IMPORTS.salesboard);
const StoreStatus = lazy(TAB_IMPORTS.storestatus);
const MySales = lazy(TAB_IMPORTS.mysales);
const PosCash = lazy(TAB_IMPORTS.cash);
const StoreCosts = lazy(TAB_IMPORTS.storecosts);
const StoreStatement = lazy(TAB_IMPORTS.statement);
const StoreOrders = lazy(TAB_IMPORTS.storeorders);
const PendingBalances = lazy(TAB_IMPORTS.pendingbalances);
const Patients = lazy(TAB_IMPORTS.patients);
const Costs = lazy(TAB_IMPORTS.costs);
const Sellers = lazy(TAB_IMPORTS.sellers);
const PricingPanel = lazy(TAB_IMPORTS.products);
/** Lo que cada rol abre a diario: se baja en segundo plano para que el cambio de pestaña sea instantáneo. */
const PREFETCH = {
  seller: [TAB_IMPORTS.pos, TAB_IMPORTS.mysales, TAB_IMPORTS.pendingbalances, TAB_IMPORTS.cash],
  staff: [TAB_IMPORTS.pos, TAB_IMPORTS.possales, TAB_IMPORTS.cash, TAB_IMPORTS.pendingbalances, TAB_IMPORTS.storestatus],
  admin: [TAB_IMPORTS.exec, TAB_IMPORTS.pos, TAB_IMPORTS.possales, TAB_IMPORTS.cash],
};
function prefetchTabs(me) {
  const list = !me || me.is_admin !== false ? PREFETCH.admin : me.role === "seller" ? PREFETCH.seller : PREFETCH.staff;
  const idle = typeof window !== "undefined" && window.requestIdleCallback ? (fn) => window.requestIdleCallback(fn, { timeout: 4000 }) : (fn) => setTimeout(fn, 1500);
  // De una en una: en una tableta lenta, bajar y compilar todo a la vez competiría con lo que se está pintando.
  const next = (i) => { if (i < list.length) idle(() => list[i]().catch(() => {}).finally(() => next(i + 1))); };
  next(0);
}
/** Mientras baja el trozo de una pestaña: reserva alto (sin saltos) y dice que está cargando. */
const TabFallback = () => <div className="adm-section adm-tab-loading" aria-busy="true"><div className="adm-src-note loading" /></div>;



// US business: "$1,234.50" in both languages (never "$1.234,50").
const money = (n) => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (n) => (Number(n) || 0).toLocaleString("en-US");

const PAGE_SIZE = 20;

const DATE_PRESETS = ["today", "7d", "30d", "90d", "all"];

const ymd = (d) => new Date(d).toISOString().slice(0, 10);

function presetFrom(preset) {
  if (preset === "today") return ymd(Date.now());
  const days = { "7d": 7, "30d": 30, "90d": 90 }[preset];
  return days ? ymd(Date.now() - days * 864e5) : "";
}

/** Icono profesional por etapa / estado terminal (sustituye a los emojis). */
const STAGE_ICON = { confirmed: "receipt", in_lab: "lab", shipped: "box", in_transit: "truck", delivered: "checkCircle", payment_pending: "clock", canceled: "alert", refunded: "undo" };

/** Coloured pill for the stage, or for the terminal state that replaced it. */
function StageBadge({ order }) {
  const { t } = useLang();
  const term = order.terminal && TERMINAL_BY_KEY[order.terminal];
  if (term && order.terminal !== "payment_pending") {
    return <span className="ord-badge" style={{ background: term.bg, color: term.color }}><Icon name={STAGE_ICON[order.terminal]} size={13} /> {t(term.label)}</span>;
  }
  const st = STAGE_BY_KEY[order.stage] || STAGE_BY_KEY.confirmed;
  return (
    <span className="ord-badge" style={{ background: st.bg, color: st.color }}>
      <Icon name={STAGE_ICON[st.key]} size={13} /> {t(st.label)}
      {term && <span className="ord-badge-sub" title={t("adm.ord.paymentPending")}> · <Icon name="clock" size={12} /></span>}
    </span>
  );
}

/**
 * The "advance" control. Only `order.next_stages` is offered. Moving to
 * `in_transit` asks for the courier reference first, because that number is
 * what the customer's tracking page renders.
 */
function StageControl({ order, busy, onMove }) {
  const { t } = useLang();
  const [asking, setAsking] = useState(null);
  const [tracking, setTracking] = useState(order.tracking_number || "");
  const [trackUrl, setTrackUrl] = useState(order.tracking_url || "");
  const next = order.next_stages || [];

  if (!next.length) return <span className="muted ord-nomove">{t("adm.ord.noMoves")}</span>;

  if (asking) {
    return (
      <form
        className="ord-track-form"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onMove(asking, { trackingNumber: tracking.trim(), trackingUrl: trackUrl.trim() });
          setAsking(null);
        }}
      >
        <input autoFocus placeholder={t("adm.ord.trackingPh")} value={tracking} onChange={(e) => setTracking(e.target.value)} />
        <input type="url" placeholder={t("adm.ord.trackingUrlPh")} value={trackUrl} onChange={(e) => setTrackUrl(e.target.value)} />
        <button className="btn-sm primary" disabled={busy}><Icon name="check" size={14} />{t("adm.ord.confirm")}</button>
        <button type="button" className="btn-sm" onClick={() => setAsking(null)}>{t("adm.ord.cancel")}</button>
      </form>
    );
  }

  return (
    <div className="ord-moves" onClick={(e) => e.stopPropagation()}>
      {next.map((key) => {
        const st = STAGE_BY_KEY[key];
        return (
          <button key={key} className="btn-sm ord-move" disabled={busy} title={t(st.action)}
            onClick={() => (key === "in_transit" ? setAsking(key) : onMove(key, {}))}>
            <Icon name={STAGE_ICON[key]} size={14} /> {t(st.label)}
          </button>
        );
      })}
    </div>
  );
}

// Visor bajo demanda de la receta de una línea: valores clave + imágenes
// (prueba virtual y receta subida) desde /admin/prescriptions/:id.
function RxImages({ prescriptionId }) {
  const { t } = useLang();
  const [state, setState] = useState("idle");
  const [data, setData] = useState(null);
  const load = async () => {
    if (state === "loading") return;
    setState("loading");
    try { setData(await fetchPrescription(prescriptionId)); setState("done"); } catch { setState("error"); }
  };
  if (state === "idle") return <button type="button" className="ord-rxbtn" onClick={load}><Icon name="eye" size={14} />{t("adm.ord.viewRx")}</button>;
  if (state === "loading") return <p className="ord-rxnote muted">{t("adm.ord.rxLoading")}</p>;
  if (state === "error") return <button type="button" className="ord-rxbtn" onClick={load}><Icon name="refresh" size={14} />{t("adm.ord.rxRetry")}</button>;
  const rx = data?.prescription || {};
  const tryon = data?.tryon_download_url;
  const file = data?.file_download_url;
  const mm = (v) => (v == null ? "—" : `${v} mm`);
  const patient = rx.patient_for === "other" ? (rx.patient_name || t("adm.ord.rxOther")) : rx.patient_for === "me" ? t("adm.ord.rxMe") : null;
  const pdText = rx.pd != null ? mm(rx.pd) : `OD ${mm(rx.pd_od)} · OS ${mm(rx.pd_os)}`;
  return (
    <div className="ord-rxview">
      <div className="ord-rxvals">
        {patient && <span><b>{t("adm.ord.rxFor")}:</b> {patient}</span>}
        <span><b>{t("lens.pd")}:</b> {pdText}</span>
        {rx.seg_height != null && <span><b>{t("adm.ord.rxHeight")}:</b> {mm(rx.seg_height)}</span>}
      </div>
      {(tryon || file) ? (
        <div className="ord-rximgs">
          {tryon && <a href={tryon} target="_blank" rel="noopener noreferrer"><img src={tryon} alt={t("adm.ord.rxTryon")} loading="lazy" /><span>{t("adm.ord.rxTryon")}</span></a>}
          {file && <a href={file} target="_blank" rel="noopener noreferrer"><img src={file} alt={t("adm.ord.rxPhotoImg")} loading="lazy" /><span>{t("adm.ord.rxPhotoImg")}</span></a>}
        </div>
      ) : <p className="ord-rxnote muted">{t("adm.ord.rxNoImages")}</p>}
    </div>
  );
}

/** Mini ficha de costo del pedido (lectura; la edición vive en Costos). */
function OrderCostMini({ orderId, onGoCosts }) {
  const { t, lang } = useLang();
  const [sheet, setSheet] = useState(null);
  const [state, setState] = useState("loading");
  useEffect(() => {
    let on = true;
    fetchOrderCost(orderId).then((s) => { if (on) { setSheet(s); setState("ok"); } }).catch(() => { if (on) setState("error"); });
    return () => { on = false; };
  }, [orderId]);
  if (state === "loading") return <div className="adm-skel" style={{ height: 36, marginTop: 8 }} />;
  if (state === "error" || !sheet) return null;
  const good = sheet.profit_gap == null ? marginTone(sheet.margin_pct) !== "bad" : sheet.profit_gap >= 0;
  return (
    <div className="ord-cost-mini">
      <span>{t("adm.cost.gross")}: <b>{fmtMoney(sheet.gross ?? sheet.revenue, sheet.currency_code, lang)}</b></span>
      <span>{t("adm.cost.netBase")}: <b>{fmtMoney(sheet.net_base, sheet.currency_code, lang)}</b></span>
      <span>{t("adm.cost.cost")}: <b className="bad">{fmtMoney(sheet.cost_total, sheet.currency_code, lang)}</b></span>
      <span>{t("adm.cost.ownerProfit")}: <b className={good ? "good" : "bad"}>{fmtMoney(sheet.margin, sheet.currency_code, lang)}</b> <span className={`margin-pct ${good ? "good" : "bad"}`}>{sheet.profit_pct_net == null ? "" : `${Math.round(sheet.profit_pct_net)}% ${t("adm.cost.ofNetShort")}`}</span></span>
      {sheet.profit_target_pct != null && <span className={`adm-chip ${good ? "ok" : "bad"}`}><Icon name="gauge" size={12} />{t("adm.cost.targetLine", { pct: sheet.profit_target_pct })} · {good ? "+" : "−"}{fmtMoney(Math.abs(sheet.profit_gap || 0), sheet.currency_code, lang)}</span>}
      {sheet.manual && <span className="adm-chip gold"><Icon name="edit" size={12} />{t("adm.cost.manual")}</span>}
      <button type="button" className="btn-xs" onClick={(e) => { e.stopPropagation(); onGoCosts(orderId); }}><Icon name="costs" size={13} />{t("adm.cost.openSheet")}</button>
    </div>
  );
}

/**
 * "Cambiar estado": el mismo cambio que los botones de la fila, como lista
 * desplegable con la etapa actual marcada. Solo ofrece las etapas que el
 * servidor acepta (`next_stages`); "En camino" pide la guía antes de confirmar.
 */
function StageSelect({ order, busy, onMove }) {
  const { t } = useLang();
  const [target, setTarget] = useState("");
  const [tracking, setTracking] = useState(order.tracking_number || "");
  const [trackUrl, setTrackUrl] = useState(order.tracking_url || "");
  const next = order.next_stages || [];
  const current = order.terminal && order.terminal !== "payment_pending" ? TERMINAL_BY_KEY[order.terminal] : STAGE_BY_KEY[order.stage];
  const submit = (e) => { e.preventDefault(); if (!target) return; onMove(target, target === "in_transit" ? { trackingNumber: tracking.trim(), trackingUrl: trackUrl.trim() } : {}); setTarget(""); };
  return (
    <form className="ord-edit-row ord-stage-form" onSubmit={submit}>
      <select className="adm-sel" value={target} onChange={(e) => setTarget(e.target.value)} disabled={busy || !next.length} style={{ flex: 1, minWidth: 160 }}>
        <option value="">{t("adm.ord.currentStage", { stage: current ? t(current.label) : order.stage })}</option>
        {next.map((k) => <option key={k} value={k}>→ {t(STAGE_BY_KEY[k].label)}</option>)}
      </select>
      {target === "in_transit" && (
        <>
          <input value={tracking} placeholder={t("adm.ord.trackingPh")} onChange={(e) => setTracking(e.target.value)} />
          <input type="url" value={trackUrl} placeholder={t("adm.ord.trackingUrlPh")} onChange={(e) => setTrackUrl(e.target.value)} />
        </>
      )}
      <button className="btn-sm primary" disabled={!target || busy}><Icon name="check" size={14} />{t("adm.ord.applyStage")}</button>
      {!next.length && <small className="muted">{t("adm.ord.noMoves")}</small>}
    </form>
  );
}

function OrderDetail({ order, onPatched, onGoCosts, onMove }) {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const addr = order.shipping_address;
  const [tracking, setTracking] = useState(order.tracking_number || "");
  const [trackUrl, setTrackUrl] = useState(order.tracking_url || "");
  const [note, setNote] = useState(order.owner_note || "");
  const [busy, setBusy] = useState("");
  useEffect(() => { setTracking(order.tracking_number || ""); setTrackUrl(order.tracking_url || ""); setNote(order.owner_note || ""); }, [order]);

  const saveTracking = async () => {
    setBusy("tracking");
    try {
      const o = await setOrderTracking(order.id, { trackingNumber: tracking.trim(), trackingUrl: trackUrl.trim() });
      toast({ tone: "success", title: t("adm.ord.trackingSaved") });
      onPatched(o);
    } catch (e) { toast({ tone: "error", title: stageErrorText(t, e, "adm.ord.saveFailed") }); } finally { setBusy(""); }
  };
  const saveNote = async () => {
    setBusy("note");
    try {
      const o = await setOrderNote(order.id, note.trim());
      toast({ tone: "success", title: t("adm.ord.noteSaved") });
      onPatched(o);
    } catch (e) { toast({ tone: "error", title: stageErrorText(t, e, "adm.ord.saveFailed") }); } finally { setBusy(""); }
  };
  const history = order.stage_history || [];

  return (
    <div className="ord-detail-grid" onClick={(e) => e.stopPropagation()}>
      <div>
        <b>{t("adm.ord.itemsTitle")}</b>
        <ul>
          {order.items.map((it) => (
            <li key={it.id} className="ord-li">
              <div className="ord-li-row">
                <span>
                  {it.quantity > 1 && <em className="ord-qty">{it.quantity}× </em>}
                  {it.title}
                  {it.has_prescription && <span className="ord-rx" title={t("adm.ord.rxTitle")}><Icon name="glasses" size={12} />{t("adm.ord.rx")}</span>}
                </span>
                <b>{fmtMoney(it.total, order.currency_code, lang)}</b>
              </div>
              {it.has_prescription && it.prescription_id && <RxImages prescriptionId={it.prescription_id} />}
            </li>
          ))}
        </ul>
        <p className="ord-totals muted">
          {t("adm.ord.totalsLine", {
            items: fmtMoney(order.item_total, order.currency_code, lang),
            shipping: fmtMoney(order.shipping_total, order.currency_code, lang),
            tax: fmtMoney(order.tax_total, order.currency_code, lang),
          })}
        </p>
        <OrderCostMini orderId={order.id} onGoCosts={onGoCosts} />
        {history.length > 0 && (
          <>
            <b style={{ display: "block", marginTop: 12 }}>{t("adm.ord.timeline")}</b>
            <ul className="ord-timeline">
              {history.slice().reverse().map((h, i) => (
                <li className="ord-tl" key={i}><b>{STAGE_BY_KEY[h.stage] ? t(STAGE_BY_KEY[h.stage].label) : h.stage}</b><span>{new Date(h.at).toLocaleString(lang === "en" ? "en-US" : "es")}</span></li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div>
        <b>{addr ? t("adm.ord.deliveryTitle") : t("adm.ord.pickupTitle")}</b>
        {addr ? (
          <p className="ord-addr">
            <span><Icon name="mapPin" size={14} />{[addr.address_1, addr.address_2].filter(Boolean).join(", ")}{addr.city ? `, ${addr.city}` : ""}{addr.postal_code ? ` (${addr.postal_code})` : ""}</span>
            <span><Icon name="user" size={14} />{order.customer.name || "—"}{order.customer.phone ? ` · ${order.customer.phone}` : ""}</span>
            <span><Icon name="mail" size={14} />{order.customer.email || "—"}</span>
            {order.shipping_method && <span><Icon name="truck" size={14} />{order.shipping_method}</span>}
          </p>
        ) : (
          <p className="ord-addr muted">
            <span><Icon name="store" size={14} />{t("adm.ord.noAddress")}</span>
            <span><Icon name="user" size={14} />{order.customer.name || "—"}{order.customer.phone ? ` · ${order.customer.phone}` : ""}</span>
            <span><Icon name="mail" size={14} />{order.customer.email || "—"}</span>
          </p>
        )}
        {order.seller_code && <p className="ord-addr"><span><Icon name="sellers" size={14} />{t("adm.ord.seller")}: <b>{order.seller_code}</b>{order.seller_source ? <span className="adm-chip neutral" style={{ marginLeft: 6 }}>{t(`adm.src.${order.seller_source}`) === `adm.src.${order.seller_source}` ? order.seller_source : t(`adm.src.${order.seller_source}`)}</span> : null}</span></p>}
        <b style={{ display: "block", marginTop: 12 }}>{t("adm.ord.changeStage")}</b>
        <StageSelect order={order} busy={busy === "stage"} onMove={onMove} />
        {order.lab_stage && <p className="ord-addr muted"><span><Icon name="lab" size={14} />{t("adm.ord.labPinned", { stage: t(STAGE_BY_KEY[order.lab_stage]?.label ?? order.lab_stage) })}</span></p>}

        <b style={{ display: "block", marginTop: 12 }}>{t("adm.ord.tracking")}</b>
        <div className="ord-edit-row">
          <input value={tracking} placeholder={t("adm.ord.trackingPh")} onChange={(e) => setTracking(e.target.value)} />
          <input type="url" value={trackUrl} placeholder={t("adm.ord.trackingUrlPh")} onChange={(e) => setTrackUrl(e.target.value)} />
          <button type="button" className="btn-sm primary" disabled={busy === "tracking" || (tracking.trim() === (order.tracking_number || "") && trackUrl.trim() === (order.tracking_url || ""))} onClick={saveTracking}><Icon name="save" size={14} />{t("adm.ord.save")}</button>
        </div>
        <b style={{ display: "block", marginTop: 12 }}>{t("adm.ord.note")}</b>
        <div className="ord-edit-row">
          <textarea value={note} maxLength={1000} placeholder={t("adm.ord.notePh")} onChange={(e) => setNote(e.target.value)} />
          <button type="button" className="btn-sm primary" disabled={busy === "note" || note.trim() === (order.owner_note || "")} onClick={saveNote}><Icon name="save" size={14} />{t("adm.ord.save")}</button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}><Icon name="sheet" size={12} /> {t("adm.ord.sheetSync")}</p>
      </div>
    </div>
  );
}

// Enlace directo a un pedido (`/admin?tab=orders&order=<id>`), tal como lo
// enlaza la hoja de Google (Archivo → receta / foto de la prueba virtual).
function deepLinkedOrder() {
  if (typeof window === "undefined") return "";
  return (new URLSearchParams(window.location.search).get("order") || "").trim();
}

export function Orders({ onGoCosts, sellers = [], params = {}, me = null }) {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  // La tienda elegida en la barra (una tienda, la tienda online o todas) filtra la lista en el servidor.
  const sf = useStoreFilter(me);
  const store = sf.isAll ? "" : sf.storeId;
  const storeById = new Map(sf.stores.map((x) => [x.id, x]));
  // Llega desde la hoja (`?order=`) o desde otra pantalla del panel (`go("orders", {...})`).
  const [linked] = useState(() => params.order || deepLinkedOrder());
  const initialPreset = params.preset || (linked ? "all" : "30d");
  const [query, setQuery] = useState(linked || params.q || "");
  const [debounced, setDebounced] = useState(linked || params.q || "");
  const [preset, setPreset] = useState(initialPreset);
  const [from, setFrom] = useState(() => (initialPreset === "today" ? ymd(Date.now()) : presetFrom(initialPreset)));
  const [to, setTo] = useState("");
  const [stage, setStage] = useState(params.stage || "");
  const [terminal, setTerminal] = useState(params.terminal || "");
  const [rx, setRx] = useState("");
  const [seller, setSeller] = useState(params.seller || "");
  const tableRef = useRef(null);
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { const id = setTimeout(() => setDebounced(query.trim()), 300); return () => clearTimeout(id); }, [query]);
  useEffect(() => { setPage(0); }, [debounced, from, to, stage, terminal, rx, seller, store]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchOrders({ q: debounced, from, to, stage, terminal, hasPrescription: rx, seller, store, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then((result) => {
        if (!alive) return;
        setData(result); setError("");
        if (linked && debounced === linked) {
          const hit = (result?.orders ?? []).find((o) => o.id === linked || `#${o.display_id}` === linked);
          if (hit) setOpenId(hit.id);
        }
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.status === 401 ? t("adm.err.sessionExpired") : stageErrorText(t, e, "adm.err.orders.loadFailed"));
        if (e.status === 401) setData(null);
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [debounced, from, to, stage, terminal, rx, seller, store, page, reloadKey]);

  function applyPreset(key) { setPreset(key); setFrom(presetFrom(key)); setTo(""); }

  const orders = data?.orders ?? [];
  const count = data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const hasFilters = stage || terminal || rx || seller || debounced || preset === "custom";
  // De dónde viene cada pedido: la tienda online (con el nombre de su web si lo tiene) o la tienda que lo vendió.
  const originText = (o) => {
    // Con la web llevada como una tienda del panel, su código delante (Op4 · la web de donde vino).
    if (o.channel !== "pos") return [webStoreLabel(sf.stores, t, { short: true }), o.storefront?.name || o.storefront?.host].filter(Boolean).join(" · ");
    const st = storeById.get(o.establishment_id);
    return st ? [st.code, st.name].filter(Boolean).join(" · ") : "—";
  };

  async function move(order, target, opts) {
    setBusyId(order.id);
    try {
      const updated = await setOrderStage(order.id, target, opts);
      const reached = STAGE_BY_KEY[updated?.stage ?? target];
      toast({ tone: "success", title: t("adm.ord.moved", { order: orderLabel(order), stage: reached ? t(reached.label) : target }), message: updated?.__notified ? t("adm.ord.notified") : undefined });
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ tone: "error", title: stageErrorText(t, e), duration: 8000 });
    } finally { setBusyId(null); }
  }

  // Un pedido editado (guía/nota) se repinta en sitio: el servidor devolvió la verdad.
  const patch = (o) => { if (o) setData((d) => d ? { ...d, orders: d.orders.map((x) => (x.id === o.id ? o : x)) } : d); };

  const exportCsv = () => {
    const stageText = (o) => o.terminal && o.terminal !== "payment_pending" ? t(TERMINAL_BY_KEY[o.terminal].label) : t(STAGE_BY_KEY[o.stage]?.label || o.stage);
    const csv = ordersToCsv(orders, [
      [t("adm.col.order"), (o) => orderLabel(o)], [t("adm.ord.colOrigin"), originText], [t("adm.col.date"), (o) => shortDate(o.created_at, lang)],
      [t("adm.ord.colCustomer"), (o) => o.customer.name || ""], [t("adm.login.email"), (o) => o.customer.email || ""], [t("adm.sel.phone"), (o) => o.customer.phone || ""],
      [t("adm.ord.colDelivery"), (o) => o.shipping_address?.city || t("adm.ord.pickup")], [t("adm.col.total"), (o) => Number(o.total || 0).toFixed(2)],
      [t("adm.ord.colStage"), stageText], [t("adm.ord.tracking"), (o) => o.tracking_number || ""], [t("adm.ord.seller"), (o) => o.seller_code || ""],
      [t("adm.col.items"), (o) => o.items.map((i) => `${i.quantity}× ${i.title}`).join(" | ")], [t("adm.ord.note"), (o) => o.owner_note || ""],
    ]);
    downloadText(`pedidos-${ymd(Date.now())}.csv`, csv);
  };

  return (
    <div className="adm-section">
      <div className="adm-head-row">
        <h2>{t("adm.ord.title")}</h2>
        <div className="adm-orders-tools">
          <label className="adm-find compact" title={t("adm.ord.searchTitle")}>
            <Icon name="search" size={15} />
            <input placeholder={t("adm.ord.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
            {query && <button type="button" className="adm-find-x" title={t("adm.ord.clear")} onClick={() => setQuery("")}><Icon name="close" size={12} /></button>}
          </label>
          <div className="adm-range">
            {DATE_PRESETS.map((k) => <button key={k} className={preset === k ? "on" : ""} onClick={() => applyPreset(k)}>{t(`adm.ord.preset.${k}`)}</button>)}
          </div>
          <button className="btn-sm" onClick={exportCsv} disabled={!orders.length} title={t("adm.ord.exportTitle")}><Icon name="excel" size={14} />CSV</button>
          <button className="btn-sm" onClick={() => printElement(tableRef.current, t("adm.ord.title"))} disabled={!orders.length} title={t("adm.ui.pdf")}><Icon name="printer" size={14} />PDF</button>
          <button className="btn-sm ghost" onClick={() => setReloadKey((k) => k + 1)} title={t("adm.sec.refresh")}><Icon name="refresh" size={15} /></button>
        </div>
      </div>

      <div className="adm-orders-filters">
        <label>{t("adm.ord.from")}<input type="date" className="adm-sel" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }} /></label>
        <label>{t("adm.ord.to")}<input type="date" className="adm-sel" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPreset("custom"); }} /></label>
        <label>{t("adm.ord.stage")}
          <select className="adm-sel" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">{t("adm.ord.allF")}</option>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{t(s.label)}</option>)}
          </select>
        </label>
        <label>{t("adm.ord.state")}
          <select className="adm-sel" value={terminal} onChange={(e) => setTerminal(e.target.value)}>
            <option value="">{t("adm.ord.allM")}</option>
            {TERMINALS.map((s) => <option key={s.key} value={s.key}>{t(s.label)}</option>)}
          </select>
        </label>
        <label>{t("adm.ord.kind")}
          <select className="adm-sel" value={rx} onChange={(e) => setRx(e.target.value)}>
            <option value="">{t("adm.ord.allM")}</option>
            <option value="true">{t("adm.ord.withRx")}</option>
            <option value="false">{t("adm.ord.withoutRx")}</option>
          </select>
        </label>
        <label>{t("adm.ord.seller")}
          <select className="adm-sel" value={seller} onChange={(e) => setSeller(e.target.value)}>
            <option value="">{t("adm.ord.allM")}</option>
            <option value="none">{t("adm.ord.noSeller")}</option>
            {sellers.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}
          </select>
        </label>
        {hasFilters && (
          <button className="btn-sm ghost" onClick={() => { setStage(""); setTerminal(""); setRx(""); setSeller(""); setQuery(""); applyPreset("30d"); }}><Icon name="close" size={14} />{t("adm.ord.clearFilters")}</button>
        )}
      </div>

      {error && <div className="adm-login-err">{error}</div>}
      {data?.truncated && <div className="adm-find-note muted">{t("adm.ord.truncated", { n: data.scan_limit })}</div>}

      <div className="adm-card" ref={tableRef}>
        <div className="adm-table-wrap">
          <table className="adm-table orders responsive">
            <thead>
              <tr>
                <th>{t("adm.col.order")}</th><th>{t("adm.ord.colOrigin")}</th><th>{t("adm.col.date")}</th><th>{t("adm.ord.colCustomer")}</th><th>{t("adm.ord.colDelivery")}</th>
                <th className="r">{t("adm.col.total")}</th><th>{t("adm.ord.colStage")}</th><th>{t("adm.ord.colAdvance")}</th>
              </tr>
            </thead>
            <tbody>
              {loading && !orders.length ? (
                <tr><td colSpan="8" className="full"><div className="adm-skel-rows"><div className="adm-skel" /><div className="adm-skel" /><div className="adm-skel" /></div></td></tr>
              ) : error && !orders.length ? (
                <tr><td colSpan="8" className="muted full">{t("adm.ord.loadFailed")}</td></tr>
              ) : !orders.length ? (
                <tr><td colSpan="8" className="full"><div className="adm-empty"><Icon name="orders" size={36} /><b>{hasFilters ? t("adm.ord.noResults") : t("adm.ord.noneInRange")}</b><p>{t("adm.ord.emptyHint")}</p></div></td></tr>
              ) : orders.map((o) => {
                const open = openId === o.id;
                return [
                  <tr key={o.id} className={`ord-row ${open ? "open" : ""}`} onClick={() => setOpenId(open ? null : o.id)}>
                    <td data-label={t("adm.col.order")}>
                      <b>{orderLabel(o)}</b>
                      {o.has_prescription && <span className="ord-rx" title={t("adm.ord.rxTitle")}><Icon name="glasses" size={13} /></span>}
                      {o.has_tryon && <span className="ord-tryon" title={t("adm.ord.tryonTitle")}><Icon name="camera" size={13} /></span>}
                      {o.owner_note && <span className="ord-tryon" title={o.owner_note}><Icon name="clipboard" size={13} /></span>}
                    </td>
                    <td data-label={t("adm.ord.colOrigin")}>
                      {o.channel !== "pos" ? (
                        <span className="ord-origin web" title={originText(o)}><Icon name="globe" size={13} /><b>{t("adm.ord.originWeb")}</b>{(o.storefront?.name || o.storefront?.host) && <small>{o.storefront.name || o.storefront.host}</small>}</span>
                      ) : (
                        <span className="ord-origin" title={originText(o)}><i className="dot" style={{ background: storeById.get(o.establishment_id)?.color || "var(--adm-line)" }} /><b>{storeById.get(o.establishment_id)?.code || "—"}</b>{storeById.get(o.establishment_id)?.name && <small>{storeById.get(o.establishment_id).name}</small>}</span>
                      )}
                    </td>
                    <td data-label={t("adm.col.date")}>{shortDate(o.created_at, lang)}</td>
                    <td data-label={t("adm.ord.colCustomer")}><span title={o.customer.email || ""}>{o.customer.name || o.customer.email || "—"}</span>{o.seller_code && <span className="adm-chip gold" style={{ marginLeft: 6, fontSize: 10.5 }}>{o.seller_code}</span>}</td>
                    <td data-label={t("adm.ord.colDelivery")}>{o.shipping_address?.city ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="truck" size={13} />{o.shipping_address.city}</span> : <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="store" size={13} />{t("adm.ord.pickup")}</span>}</td>
                    <td data-label={t("adm.col.total")} className="r num">{fmtMoney(o.total, o.currency_code, lang)}</td>
                    <td data-label={t("adm.ord.colStage")}><StageBadge order={o} /></td>
                    <td data-label={t("adm.ord.colAdvance")}><StageControl order={o} busy={busyId === o.id} onMove={(target, opts) => move(o, target, opts)} /></td>
                  </tr>,
                  open && (
                    <tr key={o.id + "-d"} className="ord-detail">
                      <td colSpan="8" className="full"><OrderDetail order={o} onPatched={patch} onGoCosts={onGoCosts} onMove={(target, opts) => move(o, target, opts)} /></td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>

        <div className="adm-pager">
          <span className="muted">
            {count === 0 ? t("adm.ord.pagerEmpty") : t("adm.ord.pagerRange", { first: page * PAGE_SIZE + 1, last: Math.min((page + 1) * PAGE_SIZE, count), total: int(count) })}
            {loading && orders.length ? t("adm.ord.updating") : ""}
          </span>
          <div>
            <button className="btn-sm" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>{t("adm.ord.prev")}</button>
            <span className="adm-pager-n">{page + 1} / {pages}</span>
            <button className="btn-sm" disabled={page + 1 >= pages || loading} onClick={() => setPage((p) => p + 1)}>{t("adm.ord.next")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * `?tab=` en la URL: los enlaces de la hoja de Google abren la sección directa.
 * Las pestañas antiguas (overview/sales/prices) siguen funcionando: ahora viven
 * dentro de Ejecutivo y de Costos y precios.
 */
// `pricing` («Precios y costos») vive desde el 6-nov-2026 dentro de «Productos y
// precios» (`products`): sus `sub` antiguos los traduce PricingPanel.
const LEGACY_TABS = { overview: ["exec", { sub: "overview" }], sales: ["exec", { sub: "detail" }], prices: ["costs", { sub: "prices" }], pricing: ["products", {}] };
function navFromUrl(tabs) {
  const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const want = q.get("tab") || "";
  const params = {};
  for (const k of ["sub", "order", "stage", "seller", "q", "approval", "number", "patient"]) if (q.get(k)) params[k] = q.get(k);
  // A legacy tab keeps the deep link's own `sub`/`q` (?tab=pricing&sub=lenses) over its default.
  if (LEGACY_TABS[want]) return { tab: LEGACY_TABS[want][0], params: { ...LEGACY_TABS[want][1], ...params }, n: 0 };
  // El panel abre en el Ejecutivo para quien lo tiene; el resto, en su caja.
  return { tab: tabs.includes(want) ? want : tabs.includes("exec") ? "exec" : tabs[0], params, n: 0 };
}

export default function AdminDashboard({ user, onLogout, me = null }) {
  // Tras el primer pintado, las pestañas de trabajo del rol bajan en segundo plano.
  useEffect(() => { prefetchTabs(me); }, [me?.role, me?.is_admin]); // eslint-disable-line react-hooks/exhaustive-deps
  const { t } = useLang();
  const groups = navGroupsFor(me);
  const tabs = tabsOf(groups);
  const restricted = me?.is_admin === false;
  // `nav.n` cambia en cada salto para que la pantalla destino se monte con los
  // parámetros nuevos (p. ej. Pedidos filtrado por etapa desde el Ejecutivo).
  const [nav, setNav] = useState(() => navFromUrl(tabs));
  const [preset, setPreset] = useState("30d");
  const [find, setFind] = useState("");
  const [sellers, setSellers] = useState([]);
  const demo = isDemoLogin();
  const [showBriefing, setShowBriefing] = useState(() => !demo && me && !briefingShown());
  useEffect(() => { if (demo) ensureSeed(); }, [demo]);
  const loadSellers = () => { if (demo || restricted) return; fetchSellers().then((r) => setSellers(r?.sellers ?? [])).catch(() => {}); };
  useEffect(loadSellers, [demo]);
  // Insignia de «Consumo IA»: proveedores con saldo bajo, agotado o rechazando
  // llamadas. Se relee cada 10 min y al entrar o salir de la pestaña.
  const [aiAttention, setAiAttention] = useState(0);
  const canSeeAi = !demo && tabs.includes("aiusage");
  useEffect(() => {
    if (!canSeeAi) return undefined;
    let alive = true;
    // A 404 means the backend does not have the AI-usage module yet (older
    // deploy): stop asking instead of logging a failed request every 10 min.
    const id = setInterval(() => read(), 600000);
    const read = () => fetchAiStatus()
      .then((r) => { if (alive) setAiAttention(Number(r?.attention) || 0); })
      .catch((e) => { if (e?.status === 404) clearInterval(id); });
    read();
    return () => { alive = false; clearInterval(id); };
  }, [canSeeAi, nav.tab]);
  // «Configuración de la óptica»: insignia con los pasos pendientes mientras el
  // dueño no dé la puesta en marcha por terminada. Un dueño recién activado sin
  // ?tab= en la URL entra directamente ahí.
  const [setupPending, setSetupPending] = useState(0);
  const canSeeSetup = !demo && tabs.includes("setup");
  const onSetup = (s) => setSetupPending(s && !s.completed_at ? Number(s.pending) || 0 : 0);
  useEffect(() => {
    if (!canSeeSetup) return undefined;
    let alive = true;
    fetchSetup()
      .then((s) => {
        if (!alive) return;
        onSetup(s);
        const asked = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("tab");
        if (s && !s.completed_at && !asked && me?.is_super) setNav((n) => ({ tab: "setup", params: {}, n: n.n + 1 }));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [canSeeSetup]); // eslint-disable-line react-hooks/exhaustive-deps
  const badges = { ...(aiAttention ? { aiusage: aiAttention } : {}), ...(setupPending ? { setup: setupPending } : {}) };

  /** Salto a cualquier pantalla con parámetros: la base de "todo es clicable". */
  // Ficha de una venta delante de cualquier pantalla (Mi panel, Cobros pendientes…).
  const salePanel = useSalePanel({ me });
  const go = (tab, params = {}) => {
    const wanted = LEGACY_TABS[tab] ? LEGACY_TABS[tab][0] : tab;
    const target = tabs.includes(wanted) ? wanted : tabs[0];
    const p = LEGACY_TABS[tab] ? { ...LEGACY_TABS[tab][1], ...params } : params;
    setNav((n) => ({ tab: target, params: p, n: n.n + 1 }));
    if (typeof window !== "undefined") {
      const u = new URL(window.location.href);
      [...u.searchParams.keys()].forEach((k) => u.searchParams.delete(k));
      u.searchParams.set("tab", target);
      if (p.sub) u.searchParams.set("sub", p.sub);
      window.history.replaceState({}, "", u.toString());
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };
  // El rol llega después del primer pintado: una pestaña que ya no le toca cae en la primera suya.
  const tab = tabs.includes(nav.tab) ? nav.tab : tabs.includes("exec") ? "exec" : tabs[0];
  const onFind = (v) => { setFind(v); if (v && tab !== "costs") go("costs", { sub: "prices" }); };
  const onSub = (sub) => setNav((n) => ({ ...n, params: { ...n.params, sub } }));

  return (
    <AdminShell tab={tab} onTab={(k) => go(k)} user={user} onLogout={onLogout} goTo={go} find={restricted ? null : find} onFind={onFind} groups={groups} me={me} badges={Object.keys(badges).length ? badges : undefined}>
      {showBriefing && <WelcomeBriefing me={me} go={go} onDone={() => setShowBriefing(false)} />}
      <Suspense fallback={<TabFallback />}>
      {tab === "exec" && (
        <ExecutiveHub me={me} go={go} sub={nav.params.sub} onSub={onSub} params={nav.params} />
      )}
      {tab === "orders" && <Orders key={`orders-${nav.n}`} onGoCosts={(id) => go("costs", { sub: "profit", order: id })} sellers={sellers} params={nav.params} me={me} />}
      {tab === "costs" && <Costs key={`costs-${nav.n}`} params={nav.params} sellers={sellers} go={go} onSub={onSub} />}
      {tab === "sellers" && <Sellers onChanged={loadSellers} go={go} me={me} params={nav.params} />}
      {/* «Productos y precios»: Productos + Precios y costos en una pantalla
          (matriz por marca con costo y, por tienda, precio y descuento). `me`
          hace falta: sin él useStoreFilter no ve las tiendas. */}
      {tab === "products" && <PricingPanel key={`products-${nav.n}`} me={me} sellers={sellers} go={go} params={nav.params} onSub={onSub} />}
      {tab === "catalogsync" && <CatalogSync />}
      {tab === "stores" && <Stores go={go} />}
      {tab === "team" && <Team />}
      {tab === "security" && <Security />}
      {tab === "setup" && <Setup go={go} onChanged={onSetup} />}
      {tab === "audit" && <AuditLog me={me} />}
      {tab === "pos" && <PosSale me={me} />}
      {tab === "possales" && <PosSales me={me} params={nav.params} />}
      {tab === "approvals" && <PosApprovals params={nav.params} me={me} />}
      {tab === "posconfig" && <PosConfig />}
      {tab === "alerts" && <AlertRules me={me} />}
      {tab === "aiusage" && <AiUsage />}
      {tab === "salesboard" && <SalesBoard go={go} tabs={tabs} me={me} />}
      {tab === "storestatus" && <StoreStatus key={`storestatus-${nav.n}`} go={go} tabs={tabs} me={me} />}
      {tab === "mysales" && <MySales go={go} me={me} openSale={salePanel.open} />}
      {tab === "pendingbalances" && <PendingBalances me={me} go={go} openSale={salePanel.open} />}
      {salePanel.panel}
      {tab === "cash" && <PosCash me={me} />}
      {tab === "storecosts" && <StoreCosts me={me} />}
      {tab === "statement" && <StoreStatement me={me} go={go} />}
      {tab === "storeorders" && <StoreOrders me={me} go={go} params={nav.params} />}
      {tab === "patients" && <Patients me={me} openSale={salePanel.open} params={nav.params} />}
      {tab === "profile" && (
        <div className="adm-section">
          <div className="adm-head-row"><h2>{t("adm.tab.profile")}</h2></div>
          <div className="adm-card"><StaffProfile mode="self" /></div>
        </div>
      )}
      </Suspense>
      <p className="muted adm-foot">{t("adm.footer", { name: TENANT.name })}</p>
    </AdminShell>
  );
}

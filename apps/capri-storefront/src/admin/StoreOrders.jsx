// Dónde se usa: Ejecutivo → acordeón «Pedidos y etapas» (OrdersStagesView) y,
// para quien administra una tienda, la pestaña "storeorders" (StoreOrders en
// solitario). UNA lista con todo lo vendido en el período para la tienda
// elegida (global, useStoreFilter) y lo que el dueño quiere leer de cada venta:
// precio, descuento, costo, comisión, ganancia, margen, cobrado, saldo y la
// ETAPA del pedido (confirmado → laboratorio → preparado → en camino →
// entregado), con «Avanzar» en la fila y la ficha (SaleDetailPanel) al pulsar.
//
// QUIÉN VE EL DINERO (privacidad, no estética):
//   · Costo, ganancia y margen: solo si el servidor los manda (`access.profit`
//     de /admin/sales-analytics/sales). Si no, la columna NO existe — ni
//     cabecera ni celda: un «Costo: oculto» sigue siendo un dato de costo
//     delante de quien no le corresponde.
//   · Comisión: `access.commission` (un vendedor ve la suya).
//   · Importe de las tarjetas por etapa (StageStrip): solo el administrador
//     (`me.is_admin === true`, y hasta que `me` cargue, NADIE) — por regla del
//     dueño, al resto solo la cantidad y el porcentaje. El servidor además
//     manda `total: null` en las filas del tablero a quien no administra
//     (boardAccessFor, lib/order-board.ts): el importe no viaja, no solo no
//     se pinta.
//   · Atrasados (HU-33): pedidos sin entregar ni anular cuya fecha prometida
//     (`promised_on` del tablero, la del recibo) ya pasó, deban o no saldo.
//     Chip «Atrasados» en la tira y pastilla «N d» en la fila. Se calcula
//     aquí con fechas locales (lateness.js), igual que Cobros pendientes.
//
// Datos — dos fuentes, UNA lista:
//   GET /admin/sales-analytics/sales   el dinero y la descripción de cada venta
//                                      (cost/fee/profit null si no se pueden ver);
//   GET /admin/order-board?view=stages la etapa, `next_stages` e historial de
//                                      cada pedido del período (≤300 filas, una
//                                      petición), casadas aquí por `order_id`.
//
// ───────────────────────────────────────────────────────────────────────────
// CONTRATO DE `params` (go("storeorders", params) · go("exec", { sub: "stages", …params }))
// Toda pantalla que salte a esta lista pasa el elemento que la motivó, para que
// la lista abra YA filtrada por él (y lo muestre como chip quitable):
//   seller  código de vendedor (seller_code, p. ej. "DAN")   → chip «Vendedor: DAN ×»
//   stage   "pending" (confirmado + laboratorio) | confirmed | in_lab | shipped
//           | in_transit | delivered | voided                 → chip «Etapa: … ×»
//   late    "1" → solo los atrasados frente a la fecha prometida → chip «Atrasados ×»
//   q       texto libre: nº de venta, nº de pedido, cliente o teléfono → chip «Buscar: … ×»
//   period  uno de PERIODS (today…year) — o from/to (YYYY-MM-DD) para «Rango»
//   store   "all" | "web" | id de establecimiento → fija el filtro GLOBAL de tienda
//   order   id de pedido ("order_…") o de venta de caja → abre su ficha encima
// Las claves que no vengan no cambian nada. `paramsKey(params)` resume las que
// cuentan; los componentes reaccionan a ese resumen, no a la identidad del objeto.
// ───────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { adminGet } from "./adminApi.js";
import { isDemoLogin } from "./adminAuth.js";
import { STAGES, STAGE_BY_KEY, money as fmtMoney, setOrderStage, stageErrorText } from "./adminOrders.js";
import { useStoreFilter } from "./StoreFilter.jsx";
import { WEB_STORE } from "./useStoreTheme.js";
import { useSortable } from "./useSortable.js";
import SortTh from "./SortTh.jsx";
import { PERIODS, applyPeriodParams, usePeriodFilter } from "./periodStore.js";
import { menuHandlers, useRegisterExport } from "./GlobalFilterBar.jsx";
import { useSalePanel } from "./SaleDetailPanel.jsx";
import { StageBar, StageBarCard, StageChip, STAGE_ICON, STAGE_INDEX, nextForward, stageLabel } from "./StageBar.jsx";
import { InfoTip } from "./ui.jsx";
import { daysLate } from "./lateness.js";
import "./exec.css";

/** Los períodos del panel (periodStore.js); se re-exportan por compatibilidad (SellerPanel). */
export { PERIODS };
/** Pages of sales read for one list: beyond it the panel says `truncated`. */
const MAX_PAGES = 10;
/**
 * Filas por página que se piden. El backend acepta `limit` (hasta 200); una
 * versión que todavía no lo entienda devuelve sus 100 de siempre, y el tamaño
 * REAL de página se deduce de la primera respuesta, así que pedir 200 nunca
 * rompe nada: solo parte en dos el número de viajes cuando ya esté desplegado.
 */
const PAGE_LIMIT = 200;
/**
 * Páginas que se piden a la vez cuando la respuesta no trae `total` y hay que
 * descubrir el final a tientas. Antes se pedía una tras otra (hasta 10 viajes
 * encadenados, ~0,5 s cada uno = varios segundos de espera en el Ejecutivo);
 * ahora van en lotes paralelos y se corta en cuanto una dice `has_more: false`.
 */
const PAGE_BATCH = 4;
/** Chips de filtro por etapa, las pendientes primero. */
export const STAGE_FILTERS = ["pending", "shipped", "in_transit", "delivered", "voided"];
/** Claves de `params` que esta lista entiende (ver el contrato de arriba). */
export const PARAM_KEYS = ["seller", "stage", "q", "late", "period", "from", "to", "store", "order"];
export const paramsKey = (p) => JSON.stringify([...PARAM_KEYS, "_n"].map((k) => (p && p[k] != null ? String(p[k]) : "")));
const STUCK_DAYS = 7;

const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Local Date bounds of a "YYYY-MM-DD" range (what analytics.js / realAnalytics.js take). */
export const datesOf = ({ from, to }) => ({ from: new Date(`${from}T00:00:00`), to: new Date(`${to}T23:59:59.999`) });
export const pct = (v) => (v == null || Number.isNaN(Number(v)) ? "—" : `${Math.round(Number(v) * 10) / 10}%`);
const shiftDay = (day, n) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
const DAY_MS = 86400_000;

// El período (chips + desde/hasta) ya no vive aquí: es el GLOBAL del panel
// (periodStore.js → usePeriodFilter, pintado por GlobalFilterBar en AdminShell).

/** Las lecturas de la lista con caché (adminCache.js): volver a la pestaña pinta al instante. */
const LIST_TTL = 60_000;
/** Lo que pide la lista para un rango y una tienda (también lo usa AdminShell.prefetchTab). */
export function storeOrdersQueries({ from, to, storeId }) {
  // Mismo `limit` que useStoreSales: si no coincidiera, lo que se precarga
  // quedaría en otra clave de caché y la lista lo pediría otra vez.
  // `voided: 1`: the list paints voided sales too (grey row, «Anuladas» chip,
  // status column); without it the server leaves them out and the chip read 0
  // with four voided sales in the month (QA roles 5-nov-2026).
  const q = { from, to, page: 0, limit: PAGE_LIMIT, voided: 1 };
  if (storeId && storeId !== "all") q.stores = storeId;
  const b = { from: shiftDay(from, -1), to: shiftDay(to, 1), view: "stages", limit: 300 };
  if (storeId && storeId !== "all") b.store = storeId;
  return [{ path: "/admin/sales-analytics/sales", query: q }, { path: "/admin/order-board", query: b }];
}

/** Suma de la lista: la fila en negrita del final y las pastillas del acordeón. */
export function salesTotals(rows) {
  const t = { count: 0, units: 0, total: 0, discount: 0, net: 0, cost: 0, commission: 0, profit: 0, paid: 0, balance: 0, hasEcon: false, hasCommission: false, missing: 0 };
  for (const r of rows) {
    if (r.status === "voided") continue;
    t.count += 1;
    t.units += Number(r.units) || 0;
    t.total += Number(r.total) || 0;
    t.discount += Number(r.discount) || 0;
    t.paid += Number(r.paid) || 0;
    t.balance += Number(r.balance) || 0;
    if (r.profit != null) {
      t.hasEcon = true;
      t.net += Number(r.net) || 0;
      t.cost += (Number(r.cost) || 0) + (Number(r.fee) || 0);
      t.profit += Number(r.profit) || 0;
      if (r.missing_cost) t.missing += 1;
    }
    if (r.commission != null) { t.hasCommission = true; t.commission += Number(r.commission) || 0; }
  }
  t.margin_pct = t.hasEcon && t.net > 0 ? (t.profit / t.net) * 100 : null;
  return t;
}

/**
 * Las ventas del período para la(s) tienda(s): todas las páginas (hasta
 * MAX_PAGES). `storeId`: "all" | "web" | id de establecimiento. `reload()`
 * vuelve a leer (tras cobrar, entregar o anular desde la ficha).
 *
 * Las páginas se piden EN PARALELO, no una tras otra: la primera dice si hay
 * más, cuánto mide una página y —cuando el backend lo manda— el `total`, y con
 * eso el resto se lanza de una vez. Paginar en secuencia costaba un viaje por
 * página (hasta diez encadenados), y el Ejecutivo monta este hook antes de
 * poder pintar nada. El orden de las filas es el del servidor: cada respuesta
 * se guarda en el hueco de SU número de página, no por orden de llegada.
 */
export function useStoreSales({ from, to, storeId }, enabled = true) {
  const [data, setData] = useState({ rows: [], access: null, state: "idle", truncated: false });
  const [tick, setTick] = useState(0);
  const demo = isDemoLogin();
  useEffect(() => {
    if (!enabled || demo || !from || !to || from > to) { setData((d) => ({ ...d, state: demo ? "demo" : "idle" })); return undefined; }
    let on = true;
    setData((d) => ({ ...d, state: "loading" }));
    const getPage = (page) => {
      const q = { from, to, page, limit: PAGE_LIMIT, voided: 1 };
      if (storeId && storeId !== "all") q.stores = storeId;
      return adminGet("/admin/sales-analytics/sales", { query: q, ttl: LIST_TTL, force: tick > 0 });
    };
    (async () => {
      const first = await getPage(0);
      // `on` se comprueba antes de cada tanda y antes de escribir: una
      // respuesta que llega tras desmontar no toca el estado ni pide más.
      if (!on) return;
      const pages = [first.sales || []];
      let access = first.access || null;
      let truncated = false;
      const take = (r, page) => { pages[page] = r.sales || []; access = r.access || access; };
      if (first.has_more) {
        // Tamaño real de página: si el backend todavía ignora `limit`, esto son
        // sus 100 y las cuentas siguen cuadrando.
        const size = (first.sales || []).length || PAGE_LIMIT;
        const total = Number(first.total);
        if (Number.isFinite(total) && total > 0) {
          // Con `total` se sabe cuántas páginas faltan: todas juntas, un viaje.
          const want = Math.ceil(total / size);
          const nums = [];
          for (let page = 1; page < Math.min(want, MAX_PAGES); page++) nums.push(page);
          const res = await Promise.all(nums.map(getPage));
          if (!on) return;
          nums.forEach((page, i) => take(res[i], page));
          truncated = want > MAX_PAGES;
        } else {
          // Sin `total`: lotes de PAGE_BATCH en paralelo hasta que una página
          // diga que ya no hay más. Lo pedido de más tras esa página se tira.
          let next = 1;
          let more = true;
          while (more && next < MAX_PAGES) {
            const nums = [];
            for (let page = next; page < Math.min(next + PAGE_BATCH, MAX_PAGES); page++) nums.push(page);
            const res = await Promise.all(nums.map(getPage));
            if (!on) return;
            for (let i = 0; i < nums.length; i++) {
              take(res[i], nums[i]);
              if (!res[i].has_more) { more = false; break; }
            }
            next += nums.length;
            // Igual que antes: se avisa solo si tras la última página permitida
            // el servidor seguía teniendo ventas.
            if (more && next >= MAX_PAGES) truncated = true;
          }
        }
      }
      if (on) setData({ rows: pages.flat(), access, state: "ok", truncated });
    })().catch(() => { if (on) setData({ rows: [], access: null, state: "error", truncated: false }); });
    return () => { on = false; };
  }, [from, to, storeId, enabled, demo, tick]);
  const totals = useMemo(() => salesTotals(data.rows), [data.rows]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...data, totals, reload };
}

/**
 * La etapa de cada pedido del período (GET /admin/order-board?view=stages),
 * indexada por id de pedido (= `order_id` de la venta). Una petición por
 * período, con un día de margen a cada lado para que un pedido en el borde no
 * se quede sin etapa. `patch(order)` actualiza una fila tras avanzarla;
 * `reload()` vuelve a leer todo. `truncated`: el tablero solo mira los
 * `scanLimit` pedidos más recientes — la lista lo dice, no lo calla.
 */
export function useOrderStages({ from, to, storeId }, enabled = true) {
  const [st, setSt] = useState({ byOrder: new Map(), state: "idle", truncated: false, scanLimit: 300 });
  const [tick, setTick] = useState(0);
  const demo = isDemoLogin();
  useEffect(() => {
    if (!enabled || demo || !from || !to || from > to) { setSt((s) => ({ ...s, state: demo ? "demo" : "idle" })); return undefined; }
    let on = true;
    setSt((s) => ({ ...s, state: "loading" }));
    const q = { from: shiftDay(from, -1), to: shiftDay(to, 1), view: "stages", limit: 300 };
    if (storeId && storeId !== "all") q.store = storeId;
    adminGet("/admin/order-board", { query: q, ttl: LIST_TTL, force: tick > 0 })
      .then((r) => {
        if (!on) return;
        const byOrder = new Map((r.orders || []).map((o) => [o.id, o]));
        setSt({ byOrder, state: "ok", truncated: Boolean(r.truncated) || (Number(r.count) || 0) > byOrder.size, scanLimit: r.scan_limit || 300 });
      })
      .catch(() => { if (on) setSt({ byOrder: new Map(), state: "error", truncated: false, scanLimit: 300 }); });
    return () => { on = false; };
  }, [from, to, storeId, enabled, demo, tick]);
  const patch = useCallback((order) => {
    if (!order?.id) return;
    setSt((s) => { const byOrder = new Map(s.byOrder); byOrder.set(order.id, { ...(byOrder.get(order.id) || {}), ...order }); return { ...s, byOrder }; });
  }, []);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...st, patch, reload };
}

/**
 * Etapa de una fila de ventas: «voided» si la venta o el pedido se anularon,
 * la del tablero por `order_id`, o null si el pedido no está en la ventana.
 */
export function stageOfRow(r, byOrder) {
  if (r.status === "voided") return "voided";
  const b = byOrder?.get(r.order_id);
  if (!b) return null;
  if (b.terminal === "canceled" || b.terminal === "refunded") return "voided";
  if (b.terminal === "payment_pending") return "payment_pending";
  return b.stage || null;
}
/** ¿Cumple la fila el chip de etapa? "pending" agrupa confirmado + laboratorio (+ pago pendiente). */
export function matchesStageFilter(stage, f) {
  if (!f) return true;
  if (f === "pending") return stage === "confirmed" || stage === "in_lab" || stage === "payment_pending";
  return stage === f;
}
const isPendingStage = (s) => s === "confirmed" || s === "in_lab" || s === "payment_pending";
/** Lleva más de STUCK_DAYS días sin salir: pendiente y vendida hace más de una semana. */
export const isStuck = (r, stage, now = Date.now()) => isPendingStage(stage) && now - new Date(r.sold_at).getTime() > STUCK_DAYS * DAY_MS;

/**
 * Días de atraso de la fila frente a lo prometido (HU-33): el pedido sigue sin
 * entregar (ni anular, ni fuera de la ventana del tablero) y su `promised_on`
 * ya pasó. `null` = no está atrasado. Pure.
 */
export function lateDaysOf(r, board, stage, now = Date.now()) {
  if (!board || !stage || stage === "delivered" || stage === "voided" || r.status === "voided") return null;
  return daysLate(board.promised_on, now);
}
export const isLate = (r, board, stage, now = Date.now()) => lateDaysOf(r, board, stage, now) != null;

const costOf = (r) => (r.cost == null ? null : (Number(r.cost) || 0) + (Number(r.fee) || 0));

/** Nº de la venta como se imprime: el número de caja o «Web» + cola del id. */
export const saleNumber = (r, t) => r.number || (r.channel === "web" ? `${t("adm.ex.so.web")} ${String(r.order_id || "").slice(-6)}` : r.order_id);
/** Lo que describe la venta (campos del servidor, con respaldo para filas antiguas sin ellos). */
export const saleBrand = (r, t) => (r.frame_brand ? r.frame_brand : r.own_frame ? t("adm.rpt.ownFrame") : "");
export const saleModel = (r) => r.frame_model || "";
export const saleColor = (r) => r.frame_color || "";
export const saleRx = (r, t) => (r.has_rx == null ? "" : t(r.has_rx ? "adm.rpt.rx.yes" : "adm.rpt.rx.no"));
export const saleOwn = (r, t) => (r.own_frame == null ? "" : t(r.own_frame ? "adm.rpt.own.yes" : "adm.rpt.own.no"));
export const saleLens = (r, { t, lang }) => (r.lens_summary ? r.lens_summary[lang] || r.lens_summary.es || "" : r.has_rx === false ? t("adm.rpt.frameOnly") : "");

/**
 * Las columnas de la lista para el reporte (PDF, Excel y CSV comparten esta
 * definición: `get` da el crudo, `text` lo impreso). Costo, comisión, ganancia
 * y margen solo cuando el servidor los mandó (`access`). `stageOf(row)`, si se
 * pasa, añade la columna Etapa.
 */
export function salesReportCols({ t, lang, storeLabel, access, withStore = false, stageOf = null }) {
  const m = (v) => (v == null ? "" : Number(v));
  const showEcon = access?.profit === true;
  const showCommission = access?.commission === true;
  const when = (iso) => new Date(iso).toLocaleString(lang === "en" ? "en-US" : "es-US", { dateStyle: "short", timeStyle: "short" });
  const shortDate = (iso) => new Date(iso).toLocaleDateString(lang === "en" ? "en-US" : "es-US", { day: "2-digit", month: "2-digit", year: "2-digit" });
  return [
    { header: t("adm.ex.so.number"), get: (r) => saleNumber(r, t), width: 12, pw: 14 },
    { header: t("adm.ex.so.date"), get: (r) => when(r.sold_at), text: (r) => shortDate(r.sold_at), width: 13, pw: 12 },
    ...(withStore && storeLabel ? [{ header: t("adm.ex.so.store"), get: (r) => storeLabel(r), width: 9, pw: 9, groupHide: true }] : []),
    { header: t("adm.rpt.col.brand"), get: (r) => saleBrand(r, t), width: 11, pw: 12 },
    { header: t("adm.rpt.col.model"), get: saleModel, width: 15, pw: 18 },
    { header: t("adm.rpt.col.color"), get: saleColor, width: 10, pw: 12 },
    { header: t("adm.rpt.col.patient"), key: "customer", width: 17, pw: 20 },
    { header: t("adm.rpt.col.rx"), get: (r) => saleRx(r, t), width: 9, pw: 9, tag: true, cls: (r) => (r.has_rx ? "on" : "") },
    { header: t("adm.rpt.col.own"), get: (r) => saleOwn(r, t), width: 9, pw: 11, tag: true, cls: (r) => (r.own_frame ? "on" : "") },
    { header: t("adm.rpt.col.lens"), get: (r) => saleLens(r, { t, lang }), width: 16, pw: 20, cls: () => "muted" },
    { header: t("adm.ex.so.seller"), key: "seller_code", width: 7, pw: 8 },
    { header: t("adm.ex.so.price"), key: "total", type: "money", width: 9, pw: 13 },
    { header: t("adm.ex.so.discount"), key: "discount", type: "money", width: 8, pw: 12, text: (r) => (Number(r.discount) > 0 ? `−${fmtMoney(r.discount, "usd", lang)}` : "—"), cls: () => "muted" },
    { header: t("adm.ex.so.paid"), key: "paid", type: "money", width: 9, pw: 13 },
    { header: t("adm.ex.so.balance"), key: "balance", type: "money", width: 9, pw: 13, text: (r) => (Number(r.balance) > 0 ? fmtMoney(r.balance, "usd", lang) : "—"), cls: (r) => (Number(r.balance) > 0 ? "neg" : "muted") },
    ...(showEcon ? [
      { header: t("adm.ex.so.cost"), get: (r) => m(costOf(r)), key: "cost", type: "money", width: 9, pw: 13 },
      { header: t("adm.ex.so.profit"), get: (r) => m(r.profit), key: "profit", type: "money", width: 9, pw: 13, cls: (r) => (r.profit == null ? "" : Number(r.profit) < 0 ? "neg" : "pos") },
      { header: t("adm.ex.so.margin"), get: (r) => (r.margin_pct == null ? "" : Number(r.margin_pct)), key: "margin_pct", type: "pct", width: 7, pw: 10 },
    ] : []),
    ...(showCommission ? [{ header: t("adm.ex.so.commission"), get: (r) => m(r.commission), key: "commission", type: "money", width: 9, pw: 11 }] : []),
    stageOf
      ? { header: t("adm.ex.stg.col"), get: (r) => stageLabel(stageOf(r), t), width: 11, pw: 11 }
      : { header: t("adm.ex.so.status"), get: (r) => t(`adm.ex.so.status.${r.status === "voided" ? "voided" : "active"}`), width: 8, pw: 9 },
  ];
}

/** La fila de totales de la lista, con las mismas claves que las columnas. */
export function salesReportTotals(totals) {
  return {
    total: totals.total, discount: totals.discount, paid: totals.paid, balance: totals.balance,
    ...(totals.hasEcon ? { cost: totals.cost, profit: totals.profit, margin_pct: totals.margin_pct == null ? "" : totals.margin_pct } : {}),
    ...(totals.hasCommission ? { commission: totals.commission } : {}),
  };
}

/**
 * Con «Todas las tiendas» el PDF se lee por bloques: un grupo por tienda (la
 * online como «Tienda online»), ordenados por total vendido, con subtotal; el
 * total general al pie. `stores` (id, code, name, color) da nombre y color a
 * cada banda; sin la lista se usa `storeLabel`. Ver groupBy en ReportDoc.jsx.
 */
export function salesGroupBy({ t, stores, storeLabel }) {
  const byId = new Map((stores || []).map((s) => [s.id, s]));
  return {
    get: (r) => (r.channel === "web" ? WEB_STORE.id : r.establishment_id || ""),
    label: (k) => {
      if (k === WEB_STORE.id) return t("adm.rpt.web");
      const s = byId.get(k);
      if (s) return [s.code, s.name].filter(Boolean).join(" · ");
      return (storeLabel ? storeLabel({ establishment_id: k }) : "") || k || "—";
    },
    colorOf: (k) => (k === WEB_STORE.id ? WEB_STORE.color : byId.get(k)?.color || null),
    order: "total-desc",
    totalKey: "total",
    subtotals: (rows) => salesReportTotals(salesTotals(rows)),
    count: (rows) => salesTotals(rows).count,
    countLabel: (n) => t("adm.ex.so.rows", { n }),
  };
}

/** La tabla de ventas como bloque de ReportDoc (`tables: [salesReportTable(...)]`). `groupBy` parte el PDF en bloques (salesGroupBy). */
export function salesReportTable(rows, totals, { t, lang, storeLabel, access, withStore = false, groupBy = null, stageOf = null }) {
  const active = rows.filter((r) => r.status !== "voided");
  return {
    ...(groupBy ? { groupBy } : {}),
    title: t("adm.rpt.salesTable"),
    sheet: t("adm.ex.so.sheet"),
    note: t("adm.rpt.salesNote", { n: active.length }),
    cols: salesReportCols({ t, lang, storeLabel, access: access || { profit: totals.hasEcon, commission: totals.hasCommission }, withStore, stageOf }),
    rows,
    rowCls: (r) => (r.status === "voided" ? "voided" : ""),
    totals: salesReportTotals(totals),
    totalsLabel: t("adm.ex.so.total"),
    empty: t("adm.rpt.noSales"),
    main: true,
  };
}

/**
 * El reporte de la lista (StoreOrders en solitario; el Ejecutivo le añade sus
 * KPI, resúmenes y gráficos). `scope` = { store (code, name, color, address,
 * phone) | null, isAll, isWeb }; `period` = { from, to }; `stores` (opcional,
 * las de useStoreFilter) nombra y colorea los bloques por tienda cuando isAll.
 */
export function salesReportSpec({ rows, totals, access, t, lang, storeLabel, stores, scope, period, title, kpis = [], summaries = [], charts = [], stageOf = null }) {
  const store = scope?.store && !scope.isAll && !scope.isWeb ? scope.store : null;
  const scopeName = store ? store.name || store.code : scope?.isWeb ? t("adm.rpt.web") : t("adm.rpt.allStores");
  const m = (v) => fmtMoney(v, "usd", lang);
  // Manda `access` (lo que el servidor dijo), y solo a falta de él los totales
  // calculados aquí: si alguna vez llegara una cifra de costo a quien no puede
  // verla, el PDF tampoco la imprimiría — la pantalla y el papel enseñan lo mismo.
  const showEcon = access ? access.profit === true : totals.hasEcon;
  const showCommission = access ? access.commission === true : totals.hasCommission;
  // `key` identifica el CONCEPTO de cada tarjeta (ReportDoc.specForAudience lo
  // usa para decidir qué sale en la versión para compartir). Nunca por el
  // rótulo traducido: cambiaría con el idioma y un costo se colaría en inglés.
  const baseKpis = kpis.length ? kpis : [
    { key: "sales", label: t("adm.ex.so.price"), value: m(totals.total), raw: totals.total, sub: t("adm.ex.so.rows", { n: totals.count }) },
    { key: "paid", label: t("adm.ex.so.paid"), value: m(totals.paid), raw: totals.paid },
    { key: "balance", label: t("adm.ex.so.balance"), value: m(totals.balance), raw: totals.balance, neg: totals.balance > 0 },
    totals.discount > 0 ? { key: "discount", label: t("adm.ex.so.discount"), value: m(totals.discount), raw: totals.discount } : null,
    showEcon && totals.hasEcon ? { key: "cost", label: t("adm.ex.so.cost"), value: m(totals.cost), raw: totals.cost } : null,
    showEcon && totals.hasEcon ? { key: "profit", label: t("adm.ex.so.profit"), value: m(totals.profit), raw: totals.profit, neg: totals.profit < 0 } : null,
    showEcon && totals.hasEcon && totals.margin_pct != null ? { key: "margin", label: t("adm.ex.so.margin"), value: pct(totals.margin_pct), raw: totals.margin_pct } : null,
    showCommission && totals.hasCommission ? { key: "commission", label: t("adm.ex.so.commission"), value: m(totals.commission), raw: totals.commission } : null,
  ];
  return {
    title: title || t("adm.rpt.salesTitle", { store: scopeName }),
    store,
    scope: store ? undefined : scopeName,
    period,
    kpis: baseKpis,
    summaries,
    charts,
    tables: [salesReportTable(rows, totals, { t, lang, storeLabel, access, withStore: Boolean(scope?.isAll), groupBy: scope?.isAll ? salesGroupBy({ t, stores, storeLabel }) : null, stageOf })],
    landscape: true,
    lang,
    t,
  };
}

/** Hojas del Excel de la lista (también las usa el Ejecutivo en su libro). */
export function salesSheets(rows, totals, { t, lang, storeLabel, access, stageOf = null }) {
  const cols = salesReportCols({ t, lang, storeLabel, access: access || { profit: totals.hasEcon, commission: totals.hasCommission }, withStore: Boolean(storeLabel), stageOf });
  return [{
    name: t("adm.ex.so.sheet"),
    cols: [...cols, { header: t("adm.ex.so.items"), key: "items", width: 40 }, { header: t("adm.rpt.col.phone"), key: "customer_phone", width: 14 }],
    rows,
    totals: salesReportTotals(totals),
    totalsLabel: t("adm.ex.so.total"),
  }];
}

/** Texto libre contra nº de venta, nº de pedido, cliente y teléfono. */
const matchesQuery = (r, q, t) => {
  if (!q) return true;
  const k = q.trim().toLowerCase().replace(/^#/, "");
  if (!k) return true;
  return [saleNumber(r, t), r.number, r.order_id, r.customer, r.customer_phone, r.items].filter(Boolean).join(" ").toLowerCase().includes(k);
};

/**
 * Filtros de elemento de la lista (vendedor, etapa, texto): estado inicial
 * desde `params`, y se vuelven a aplicar cuando cambia `paramsKey(params)`.
 */
export function useListFilters(params) {
  const key = paramsKey(params);
  const fromParams = (p) => ({ seller: p?.seller ? String(p.seller).toUpperCase() : "", stage: p?.stage && (STAGE_FILTERS.includes(p.stage) || STAGE_BY_KEY[p.stage]) ? p.stage : "", q: p?.q ? String(p.q) : "", late: p?.late === true || p?.late === "1" || p?.late === 1 });
  const [f, setF] = useState(() => fromParams(params));
  useEffect(() => { setF(fromParams(params)); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = useCallback((k, v) => setF((x) => ({ ...x, [k]: v })), []);
  const clear = useCallback(() => setF({ seller: "", stage: "", q: "", late: false }), []);
  return { ...f, set, clear, active: Boolean(f.seller || f.stage || f.q || f.late) };
}

/**
 * La tira de etapas: StageBar con las cinco etapas (cuántas y, SOLO para el
 * administrador, cuánto suman), chips por grupo (pendientes primero), la línea
 * de alertas («N llevan más de 7 días sin salir») y los filtros activos como
 * chips quitables.
 *
 * Regla del dueño: en los pedidos por etapa, a todo el mundo salvo el
 * administrador solo le sale la CANTIDAD y el porcentaje — «ese valor monetario
 * solo concierne a super admin». Por eso para quien no administra la tarjeta se
 * pinta sin importes y SIN el menú de exportación, que se llevaría el dinero
 * (StageBar.jsx: la hoja de StageBarCard siempre trae la columna «Importe»).
 * «Administrador» es `me.is_admin === true`, nada más: mientras `me` carga (o
 * si nunca llega) se pinta la versión sin dinero — cerrada por defecto, no
 * abierta hasta que alguien diga lo contrario.
 */
export function StageStrip({ rows, byOrder, stages, filters, compact = false, me = null }) {
  const { t, lang } = useLang();
  const m = (v) => fmtMoney(v, "usd", lang);
  const isAdmin = me?.is_admin === true;
  const stats = useMemo(() => {
    const by = Object.fromEntries([...STAGES.map((s) => s.key), "payment_pending", "voided", "none"].map((k) => [k, { n: 0, v: 0 }]));
    let stuck = 0;
    let late = 0;
    const now = Date.now();
    for (const r of rows) {
      const st = stageOfRow(r, byOrder) || "none";
      by[st].n += 1;
      by[st].v += Number(r.total) || 0;
      if (isStuck(r, st, now)) stuck += 1;
      if (isLate(r, byOrder?.get(r.order_id), st, now)) late += 1;
    }
    const group = (keys) => keys.reduce((acc, k) => ({ n: acc.n + by[k].n, v: acc.v + by[k].v }), { n: 0, v: 0 });
    return { by, stuck, late, groups: { pending: group(["confirmed", "in_lab", "payment_pending"]), shipped: by.shipped, in_transit: by.in_transit, delivered: by.delivered, voided: by.voided } };
  }, [rows, byOrder]);
  // Sin `amount` para quien no administra: así no hay importe que pintar ni que
  // exportar, en vez de mandar un 0 que se leería como «no se vendió nada».
  const tiles = STAGES.map((s) => ({ key: s.key, label: t(s.label), icon: STAGE_ICON[s.key], count: stats.by[s.key].n, ...(isAdmin ? { amount: stats.by[s.key].v } : {}) }));
  const pick = (key) => filters.set("stage", filters.stage === key ? "" : key);
  const chip = (key, label, n, v) => (
    <button key={key} type="button" className={`so-chip ${filters.stage === key ? "on" : ""} ${key}`} aria-pressed={filters.stage === key} onClick={() => pick(key)} title={isAdmin && v != null ? m(v) : undefined}>
      <Icon name={STAGE_ICON[key] || "lab"} size={12} />{label}<b>{n}</b>
    </button>
  );
  const el = [];
  if (filters.seller) el.push({ k: "seller", label: t("adm.ex.flt.seller"), value: filters.seller });
  if (filters.stage) el.push({ k: "stage", label: t("adm.ex.flt.stage"), value: stageLabel(filters.stage, t) });
  if (filters.q) el.push({ k: "q", label: t("adm.ex.flt.q"), value: filters.q });
  if (filters.late) el.push({ k: "late", label: t("adm.so.late"), value: t("adm.so.flt.lateOn"), off: false });
  return (
    <div className={`so-strip ${compact ? "compact" : ""}`}>
      {isAdmin ? (
        <StageBarCard icon="layers" title={t("adm.ex.stg.title")} hint={t("adm.ex.stg.hint")} name="etapas" className="so-stagebar"
          stages={tiles} active={filters.stage} onPick={(s) => pick(s.key)} emptyText={t("adm.ex.tr.empty")} />
      ) : (
        /* La misma tarjeta, pero sin importes y sin ExportMenu: su hoja de
           cálculo lleva la columna «Importe» y ese dinero solo lo ve el
           administrador. Mismas clases para que se vea igual. */
        <div className="adm-card so-stagebar">
          <div className="adm-card-head">
            <h3><Icon name="layers" size={16} />{t("adm.ex.stg.title")}</h3>
            <span className="adm-card-tools"><InfoTip text={t("adm.so.stgCountsOnly")} title={t("adm.ex.stg.title")} /></span>
          </div>
          <StageBar stages={tiles} showAmount={false} lang={lang} active={filters.stage} onPick={(s) => pick(s.key)} emptyText={t("adm.ex.tr.empty")} />
        </div>
      )}
      <div className="so-chips adm-noprint" role="group" aria-label={t("adm.ex.flt.stage")}>
        <button type="button" className={`so-chip all ${!filters.stage ? "on" : ""}`} aria-pressed={!filters.stage} onClick={() => filters.set("stage", "")}>{t("adm.ex.stg.all")}<b>{rows.length}</b></button>
        {chip("pending", t("adm.ex.stg.pending"), stats.groups.pending.n, stats.groups.pending.v)}
        {chip("shipped", t(STAGE_BY_KEY.shipped.label), stats.groups.shipped.n, stats.groups.shipped.v)}
        {chip("in_transit", t(STAGE_BY_KEY.in_transit.label), stats.groups.in_transit.n, stats.groups.in_transit.v)}
        {chip("delivered", t(STAGE_BY_KEY.delivered.label), stats.groups.delivered.n, stats.groups.delivered.v)}
        {chip("voided", t("adm.ex.stg.voided"), stats.groups.voided.n, stats.groups.voided.v)}
        {/* Atrasados (HU-33): un interruptor aparte de la etapa — se combina con
            ella («Pendientes» + «Atrasados» = los que urgen). Mismo chip. */}
        <button type="button" className={`so-chip late ${filters.late ? "on" : ""}`} aria-pressed={filters.late} onClick={() => filters.set("late", !filters.late)} title={t("adm.so.lateHint")}>
          <Icon name="alert" size={12} />{t("adm.so.late")}<b>{stats.late}</b>
        </button>
        <span className="so-search">
          <Icon name="search" size={13} />
          <input value={filters.q} onChange={(e) => filters.set("q", e.target.value)} placeholder={t("adm.ex.flt.search")} aria-label={t("adm.ex.flt.q")} />
        </span>
      </div>
      <div className="so-alerts">
        {stats.stuck > 0
          ? <button type="button" className="so-alert crit" onClick={() => filters.set("stage", "pending")}><Icon name="alert" size={13} />{t("adm.ex.stg.stuck", { n: stats.stuck })}<Icon name="arrowRight" size={12} /></button>
          : rows.length > 0 && stages.state === "ok" && <span className="so-alert ok"><Icon name="checkCircle" size={13} />{t("adm.ex.stg.allClear")}</span>}
        {stats.late > 0 && !filters.late && <button type="button" className="so-alert warn" onClick={() => filters.set("late", true)}><Icon name="calendar" size={13} />{t("adm.so.lateAlert", { n: stats.late })}<Icon name="arrowRight" size={12} /></button>}
        {stages.state === "ok" && stages.truncated && <span className="so-alert info"><Icon name="info" size={13} />{t("adm.ex.stg.boardTruncated", { n: stages.scanLimit })}</span>}
        {stages.state === "error" && <span className="so-alert warn"><Icon name="alert" size={13} />{t("adm.ex.stg.boardFailed")}</span>}
        {el.length > 0 && (
          <span className="so-active adm-noprint">
            {el.map((x) => (
              <span key={x.k} className="so-flt">
                <small>{x.label}:</small> <b>{x.value}</b>
                <button type="button" onClick={() => filters.set(x.k, x.off === undefined ? "" : x.off)} title={t("adm.ex.flt.clear")} aria-label={`${t("adm.ex.flt.clear")}: ${x.label} ${x.value}`}><Icon name="close" size={11} /></button>
              </span>
            ))}
            {el.length > 1 && <button type="button" className="so-flt-clear" onClick={filters.clear}>{t("adm.ex.flt.clearAll")}</button>}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * La tabla. `data` viene de useStoreSales (el Ejecutivo la comparte con sus
 * KPI); `rows` (opcional) son las filas ya filtradas a pintar. Pulsar una venta
 * abre su ficha (SaleDetailPanel): la de caja por `sale_id`, un pedido web por
 * `order_id` — la misma ficha, con etapa, artículos y fotos. `byOrder`
 * (useOrderStages) pone la columna Etapa y el botón «Avanzar»; `onAdvance(row,
 * stage)` lo ejecuta. `onOpen`, si se pasa, sustituye la ficha. `autoOpen` =
 * { id } abre esa venta/pedido al montar (params.order).
 */
export function StoreOrdersTable({ data, rows: givenRows, storeLabel, onOpen, compact = false, me, byOrder = null, onAdvance = null, onChanged, autoOpen = null, busyId = null }) {
  const { t, lang } = useLang();
  const { rows: allRows, access, state, truncated, totals: allTotals } = data;
  const rows = givenRows || allRows;
  const totals = useMemo(() => (givenRows ? salesTotals(givenRows) : allTotals), [givenRows, allTotals]);
  const sp = useSalePanel({ me, onChanged });
  const m = (v) => fmtMoney(v, "usd", lang);
  const when = (iso) => new Date(iso).toLocaleString(lang === "en" ? "en-US" : "es-US", { dateStyle: "short", timeStyle: "short" });
  const showEcon = access?.profit === true;
  const showCommission = access?.commission === true;
  const hidden = <span className="muted" title={t("adm.ex.so.hiddenHint")}>{t("adm.ex.so.hidden")}</span>;
  const openRow = (r) => (r.sale_id ? sp.open(r.sale_id, { economics: r, orderId: r.order_id }) : r.order_id ? sp.open({ orderId: r.order_id }, { economics: r }) : null);
  const onRow = typeof onOpen === "function" ? onOpen : openRow;
  const clickable = (r) => typeof onOpen === "function" || Boolean(r.sale_id || r.order_id);
  const stageOf = (r) => stageOfRow(r, byOrder);
  // params.order: abrir la ficha de esa venta / pedido nada más montar la lista.
  const opened = useRef(null);
  useEffect(() => {
    const id = autoOpen?.id;
    if (!id || opened.current === id) return;
    opened.current = id;
    if (String(id).startsWith("order_")) sp.open({ orderId: id }, { economics: rows.find((r) => r.order_id === id) || null });
    else sp.open(id, { economics: rows.find((r) => r.sale_id === id) || null });
  }, [autoOpen?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Las cabeceras ordenan (useSortable.js); la fila de totales va aparte y queda siempre abajo.
  const sorted = useSortable(rows, {
    id: "store-orders", defaultKey: "sold_at", defaultDir: "desc", deps: [lang, byOrder],
    getters: { number: (r) => saleNumber(r, t), brand: (r) => saleBrand(r, t), model: saleModel, color: saleColor, rx: (r) => r.has_rx, own: (r) => r.own_frame, lens: (r) => saleLens(r, { t, lang }), cost: costOf, stage: (r) => { const s = stageOf(r); return s === "voided" ? 99 : s == null ? 50 : s === "payment_pending" ? -1 : STAGE_INDEX[s]; } },
  });
  const th = (col, label, align = "") => <SortTh col={col} sort={sorted.sort} onSort={sorted.toggle} align={align}>{label}</SortTh>;
  if (state === "loading" && !allRows.length) return <div className="adm-skel" style={{ height: 120 }} />;
  if (state === "error") return <div className="adm-demo-banner">{t("adm.ex.loadFailed")}</div>;
  if (state === "demo") return <div className="adm-demo-banner">{t("adm.ex.demo")}</div>;
  if (!allRows.length) return <div className="adm-nodata">{t("adm.ex.so.empty")}</div>;
  return (
    <div className={`adm-table-wrap so-wrap ${compact ? "compact" : ""}`}>
      {truncated && <div className="adm-demo-banner">{t("adm.ex.truncated")}</div>}
      {givenRows && givenRows.length !== allRows.length && <p className="so-showing muted">{t("adm.ex.flt.showing", { n: givenRows.length, total: allRows.length })}</p>}
      {!rows.length ? <div className="adm-nodata">{t("adm.ex.flt.noMatch")}</div> : (
        <table className="adm-table responsive so-table">
          <thead>
            <tr>
              {th("number", t("adm.ex.so.number"))}
              {th("sold_at", t("adm.ex.so.date"))}
              {th("stage", t("adm.ex.stg.col"))}
              {th("customer", t("adm.ex.so.customer"))}
              {th("seller_code", t("adm.ex.so.seller"))}
              {th("brand", t("adm.rpt.col.brand"))}
              {th("model", t("adm.rpt.col.model"))}
              {th("color", t("adm.rpt.col.color"))}
              {th("rx", t("adm.rpt.col.rx"))}
              {th("own", t("adm.rpt.col.own"))}
              <SortTh col="lens" sort={sorted.sort} onSort={sorted.toggle} className="so-items">{t("adm.rpt.col.lens")}</SortTh>
              {th("total", t("adm.ex.so.price"), "r")}
              {th("discount", t("adm.ex.so.discount"), "r")}
              {showEcon && th("cost", t("adm.ex.so.cost"), "r")}
              {th("commission", t("adm.ex.so.commission"), "r")}
              {showEcon && th("profit", t("adm.ex.so.profit"), "r")}
              {showEcon && th("margin_pct", t("adm.ex.so.margin"), "r")}
              {th("paid", t("adm.ex.so.paid"), "r")}
              {th("balance", t("adm.ex.so.balance"), "r")}
            </tr>
          </thead>
          <tbody>
            {sorted.rows.map((r) => {
              const voided = r.status === "voided";
              const profit = r.profit == null ? null : Number(r.profit);
              const stage = stageOf(r);
              const board = byOrder?.get(r.order_id) || null;
              const next = stage && stage !== "voided" ? nextForward(board) : null;
              const late = lateDaysOf(r, board, stage);
              const current = sp.saleId && sp.saleId === r.sale_id || (sp.orderId && sp.orderId === r.order_id);
              return (
                <tr key={r.order_id || r.sale_id} className={`${clickable(r) ? "ord-row sd-open-row" : ""} ${current ? "sd-current" : ""} ${voided ? "so-voided" : ""} ${isStuck(r, stage) ? "so-stuck" : ""} ${late != null ? "so-late-row" : ""}`} onClick={clickable(r) ? () => onRow(r) : undefined} title={clickable(r) ? (r.sale_id ? t("adm.sd.openHint") : t("adm.ex.so.openOrder")) : undefined}>
                  <td data-label={t("adm.ex.so.number")}><b>{saleNumber(r, t)}</b>{storeLabel && <small className="muted so-store"> · {storeLabel(r)}</small>}</td>
                  <td data-label={t("adm.ex.so.date")}>{when(r.sold_at)}</td>
                  <td data-label={t("adm.ex.stg.col")} className="so-stage-cell">
                    <span className="so-stage-wrap">
                      <StageChip stage={stage} t={t} small title={board?.pos_delivered_at ? t("adm.sd.stage.posDelivered") : undefined} />
                      {late != null && <span className="so-late" title={t("adm.so.lateDaysHint", { date: board.promised_on, n: late })} aria-label={t("adm.so.lateDaysHint", { date: board.promised_on, n: late })}><Icon name="calendar" size={10} />{t("adm.so.lateDays", { n: late })}</span>}
                      {next && onAdvance && (
                        <button type="button" className="so-adv adm-noprint" disabled={busyId === r.order_id} title={t("adm.ex.stg.advanceTo", { stage: stageLabel(next, t) })} aria-label={t("adm.ex.stg.advanceTo", { stage: stageLabel(next, t) })}
                          onClick={(e) => { e.stopPropagation(); onAdvance(r, next); }}>
                          <Icon name="arrowRight" size={11} />{stageLabel(next, t)}
                        </button>
                      )}
                    </span>
                  </td>
                  <td data-label={t("adm.ex.so.customer")}>{r.customer || "—"}</td>
                  <td data-label={t("adm.ex.so.seller")}>{r.seller_code ? <span className="adm-chip gold">{r.seller_code}</span> : <span className="muted">—</span>}</td>
                  <td data-label={t("adm.rpt.col.brand")}>{saleBrand(r, t) || <span className="muted">—</span>}</td>
                  <td data-label={t("adm.rpt.col.model")} title={r.items}>{saleModel(r) || <span className="muted">{r.items || "—"}</span>}</td>
                  <td data-label={t("adm.rpt.col.color")}>{saleColor(r) || <span className="muted">—</span>}</td>
                  <td data-label={t("adm.rpt.col.rx")}>{r.has_rx == null ? <span className="muted">—</span> : <span className={`adm-chip ${r.has_rx ? "ok" : "neutral"}`}>{saleRx(r, t)}</span>}</td>
                  <td data-label={t("adm.rpt.col.own")}>{r.own_frame == null ? <span className="muted">—</span> : <span className={`adm-chip ${r.own_frame ? "warn" : "neutral"}`}>{saleOwn(r, t)}</span>}</td>
                  <td data-label={t("adm.rpt.col.lens")} className="so-items muted" title={r.items}>{saleLens(r, { t, lang }) || "—"}</td>
                  <td data-label={t("adm.ex.so.price")} className="r num"><b>{m(r.total)}</b></td>
                  <td data-label={t("adm.ex.so.discount")} className="r num muted">{Number(r.discount) > 0 ? `−${m(r.discount)}` : "—"}</td>
                  {showEcon && <td data-label={t("adm.ex.so.cost")} className="r num">{costOf(r) == null ? "—" : m(costOf(r))}{r.missing_cost && <span className="adm-chip warn so-warn" title={t("adm.ex.so.missingCost")}><Icon name="alert" size={10} /></span>}</td>}
                  <td data-label={t("adm.ex.so.commission")} className="r num">{showCommission ? (r.commission == null ? "—" : m(r.commission)) : hidden}</td>
                  {showEcon && <td data-label={t("adm.ex.so.profit")} className="r num">{profit == null ? "—" : <b className={profit < 0 ? "neg" : "pos"}>{m(profit)}</b>}</td>}
                  {showEcon && <td data-label={t("adm.ex.so.margin")} className="r num"><span className={`margin-pct ${r.margin_pct == null ? "" : r.margin_pct >= 30 ? "good" : r.margin_pct >= 15 ? "mid" : "bad"}`}>{pct(r.margin_pct)}</span></td>}
                  <td data-label={t("adm.ex.so.paid")} className="r num">{m(r.paid)}</td>
                  <td data-label={t("adm.ex.so.balance")} className="r num">{Number(r.balance) > 0 ? <b className="neg">{m(r.balance)}</b> : <span className="muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="so-total">
              <td data-label={t("adm.ex.so.total")} colSpan="10"><b>{t("adm.ex.so.total")}</b> <small className="muted">{t("adm.ex.so.rows", { n: totals.count })}</small></td>
              <td className="so-items muted">{totals.units}</td>
              <td data-label={t("adm.ex.so.price")} className="r num"><b>{m(totals.total)}</b></td>
              <td data-label={t("adm.ex.so.discount")} className="r num">{totals.discount > 0 ? `−${m(totals.discount)}` : "—"}</td>
              {showEcon && <td data-label={t("adm.ex.so.cost")} className="r num">{totals.hasEcon ? <b>{m(totals.cost)}</b> : "—"}</td>}
              <td data-label={t("adm.ex.so.commission")} className="r num">{showCommission && totals.hasCommission ? <b>{m(totals.commission)}</b> : hidden}</td>
              {showEcon && <td data-label={t("adm.ex.so.profit")} className="r num">{totals.hasEcon ? <b className={totals.profit < 0 ? "neg" : "pos"}>{m(totals.profit)}</b> : "—"}</td>}
              {showEcon && <td data-label={t("adm.ex.so.margin")} className="r num">{totals.hasEcon ? <b>{pct(totals.margin_pct)}</b> : "—"}</td>}
              <td data-label={t("adm.ex.so.paid")} className="r num"><b>{m(totals.paid)}</b></td>
              <td data-label={t("adm.ex.so.balance")} className="r num"><b className={totals.balance > 0 ? "neg" : ""}>{m(totals.balance)}</b></td>
            </tr>
          </tfoot>
        </table>
      )}
      {sp.panel}
    </div>
  );
}

/** Etiqueta de tienda de una venta a partir de las tiendas de useStoreFilter. */
export function storeLabelFor(stores, t) {
  const byId = new Map((stores || []).map((s) => [s.id, s]));
  return (r) => {
    if (r.channel === "web") return t("adm.ex.so.web");
    const s = byId.get(r.establishment_id);
    return s ? s.code || s.name : r.establishment_id || "—";
  };
}

/**
 * Lista + etapas: lo que el Ejecutivo monta en «Pedidos y etapas» y la pestaña
 * en solitario pinta bajo su barra. `data` (useStoreSales) y `stages`
 * (useOrderStages) los carga quien monta (los comparte con sus KPI); `params`
 * sigue el contrato de arriba (seller / stage / q / order); `onChanged` avisa a
 * quien monta tras cobrar, entregar, anular o avanzar (recarga sus cifras).
 */
export function OrdersStagesView({ data, stages, storeLabel, params, me, compact = false, onChanged }) {
  const { t } = useLang();
  const { toast, confirm } = useFeedback();
  const filters = useListFilters(params);
  const [busyId, setBusyId] = useState(null);
  // Vendedor y texto acotan la base (la tira cuenta sobre ella); la etapa acota la lista.
  const base = useMemo(() => data.rows.filter((r) => (!filters.seller || String(r.seller_code || "").toUpperCase() === filters.seller) && matchesQuery(r, filters.q, t)), [data.rows, filters.seller, filters.q, t]);
  const rows = useMemo(() => base.filter((r) => {
    const stage = stageOfRow(r, stages.byOrder);
    if (!matchesStageFilter(stage, filters.stage)) return false;
    return !filters.late || isLate(r, stages.byOrder?.get(r.order_id), stage);
  }), [base, stages.byOrder, filters.stage, filters.late]);
  const changed = () => { stages.reload(); data.reload?.(); onChanged?.(); };
  const advance = async (r, stage) => {
    const st = STAGE_BY_KEY[stage];
    const n = saleNumber(r, t);
    if (!(await confirm({ title: t("adm.ex.stg.confirmTitle", { n, stage: t(st.label) }), message: t("adm.ex.stg.confirmBody", { action: t(st.action) }) }))) return;
    setBusyId(r.order_id);
    try {
      const after = await setOrderStage(r.order_id, stage);
      if (after) stages.patch(after); else stages.reload();
      toast({ tone: "success", title: t("adm.ex.stg.moved", { n, stage: t(st.label) }) });
      onChanged?.();
    } catch (e) {
      toast({ tone: "error", title: stageErrorText(t, e) });
    } finally { setBusyId(null); }
  };
  return (
    <div className="so-view">
      <StageStrip rows={base} byOrder={stages.byOrder} stages={stages} filters={filters} compact={compact} me={me} />
      <StoreOrdersTable data={data} rows={rows} storeLabel={storeLabel} compact={compact} me={me} byOrder={stages.byOrder} onAdvance={advance} onChanged={changed} busyId={busyId}
        autoOpen={params?.order ? { id: String(params.order) } : null} />
    </div>
  );
}

/**
 * Standalone (pestaña "storeorders"): tienda y período de la barra GLOBAL del
 * panel (useStoreFilter + usePeriodFilter), exportación registrada en esa misma
 * barra (useRegisterExport) y la misma vista de etapas + lista del Ejecutivo.
 * `params`: contrato de arriba. `embedded` (compatibilidad) pinta solo la
 * tabla con `data` ya cargada; también entonces el período es el global.
 */
export default function StoreOrders({ me, go, params = null, embedded = false, data: given, storeLabel: givenLabel, openSale }) {
  const { t, lang } = useLang();
  const sf = useStoreFilter(me);
  const per = usePeriodFilter();
  const pkey = paramsKey(params);
  // store / period / from / to de los params → filtro global de tienda y período global, una vez por salto.
  useEffect(() => {
    if (!params) return;
    if (params.store) sf.setStoreId(params.store);
    applyPeriodParams(params);
  }, [pkey]); // eslint-disable-line react-hooks/exhaustive-deps
  const own = useStoreSales({ from: per.from, to: per.to, storeId: sf.storeId }, !embedded);
  const stages = useOrderStages({ from: per.from, to: per.to, storeId: sf.storeId }, !embedded);
  const data = embedded && given ? given : own;
  const storeLabel = givenLabel || storeLabelFor(sf.stores, t);
  const ref = useRef(null);
  // `openSale(row, go)` abre una venta cuando la pestaña de Ventas acepte una búsqueda por número.
  const onOpen = typeof openSale === "function" ? (r) => openSale(r, go) : undefined;
  const stageOf = (r) => stageOfRow(r, stages.byOrder);
  const scope = sf.isAll ? t("adm.ex.scope.all") : sf.isWeb ? t("adm.ex.scope.web") : `${sf.store?.code || ""} ${sf.store?.name || ""}`.trim();
  const meta = `${scope} · ${per.from} → ${per.to}`;
  // PDF / Excel / CSV: el reporte formal (ReportDoc) con la lista completa, una línea por venta.
  const report = () => salesReportSpec({
    rows: data.rows, totals: data.totals, access: data.access, t, lang, storeLabel, stores: sf.stores, stageOf,
    scope: { store: sf.store, isAll: sf.isAll, isWeb: sf.isWeb }, period: { from: per.from, to: per.to },
  });
  const xlsx = () => ({ filename: `${t("adm.ex.so.exportName")}-${per.from}-${per.to}.xlsx`, sheets: salesSheets(data.rows, data.totals, { t, lang, storeLabel, access: data.access, stageOf }) });
  useRegisterExport(embedded || data.state !== "ok" ? null : menuHandlers({ targetRef: ref, title: t("adm.ex.acc.stages"), name: t("adm.ex.so.exportName"), meta, report, xlsx }));
  if (embedded) return <StoreOrdersTable data={data} storeLabel={sf.isAll ? storeLabel : null} onOpen={onOpen} compact me={me} />;
  return (
    <div className="adm-section ex-root so-root">
      <div className="ex-head">
        <h2>{t("adm.ex.acc.stages")}</h2>
        <p>{t("adm.ex.so.sub")}</p>
        <span className="ex-scope adm-noprint"><Icon name="calendar" size={12} />{meta}</span>
      </div>
      <div ref={ref}>
        <OrdersStagesView data={data} stages={stages} storeLabel={sf.isAll ? storeLabel : null} params={params} me={me} />
      </div>
    </div>
  );
}

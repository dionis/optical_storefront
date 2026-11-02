// Panel de UN movimiento de caja. Dónde se usa: Caja → «Caja del día» (libro
// de la sesión abierta, PosCash.jsx) y Caja → «Movimientos» (CashReport.jsx).
// Al pulsar una fila se abre DELANTE de la pantalla, difuminando el fondo
// (portal en `.adm-main`, como SellerPanel: la barra lateral sigue usable),
// todo el detalle que pidió el dueño: quién lo hizo (nombre, código), cuándo
// (fecha y hora), dónde (tienda, punto de venta), cuánto, tipo, motivo, nota,
// la venta enlazada (número, cliente, estado; se abre con `openSale`), la
// sesión de caja a la que pertenece y su rastro de auditoría.
//
//   const mp = useMovementPanel({ stores, openSale });
//   <tr onClick={() => mp.open(movement)}>…</tr>
//   {mp.panel}
//
// `movement` es una fila del libro (GET /admin/pos/cash-sessions, campo
// `movements`) o del informe (GET /admin/pos/cash-report, `movements`): las
// dos traen id, session_id, kind, category, amount_cents, note, by, sale_id,
// payment_id, terminal_id/terminal_code y la hora (`created_at` o `at`). Lo
// que falta (ventas enlazadas, auditoría, sesión) se lee al abrir con
// GET /admin/pos/cash-sessions/:id.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import HelpTip from "./HelpTip.jsx";
import { money } from "./adminOrders.js";
import { fetchCashSession } from "./posApi.js";
import "./cash.css";

/* ───────────────────────── Capa (portal en .adm-main) ───────────────────────── */

export function useMainOffset() {
  const [left, setLeft] = useState(0);
  const [host, setHost] = useState(null);
  useEffect(() => {
    const main = typeof document !== "undefined" ? document.querySelector(".adm-main") : null;
    setHost(main || (typeof document !== "undefined" ? document.body : null));
    if (!main) return undefined;
    const measure = () => setLeft(Math.max(0, Math.round(main.getBoundingClientRect().left)));
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(main);
    window.addEventListener("resize", measure);
    const shell = main.closest(".adm-shell");
    shell?.addEventListener("transitionend", measure);
    return () => { ro?.disconnect(); window.removeEventListener("resize", measure); shell?.removeEventListener("transitionend", measure); };
  }, []);
  return { left, host };
}

/** Tarjeta centrada sobre el fondo difuminado; Escape y el fondo cierran. Compartida con CashClosePanel. */
export function CashOverlay({ title, subtitle, icon = "wallet", wide = false, onClose, children, foot, label }) {
  const { t } = useLang();
  const { left, host } = useMainOffset();
  const cardRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => { if (host) cardRef.current?.focus({ preventScroll: true }); }, [host]);
  // Foco en la tarjeta; Escape cierra; el fondo no hace scroll.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeRef.current?.(); } };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, []);
  if (!host) return null;
  return createPortal(
    <div className="cash-overlay" style={{ "--cash-left": `${left}px` }}>
      <div className="cash-backdrop" onClick={onClose} aria-hidden="true" />
      <div className={`cash-card ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={label || title} tabIndex={-1} ref={cardRef}>
        <button type="button" className="cash-card-close" onClick={onClose} aria-label={t("adm.cash.panel.close")} title={t("adm.cash.panel.close")}><Icon name="close" size={16} /></button>
        <div className="cash-card-head">
          <Icon name={icon} size={22} />
          <div><h2>{title}</h2>{subtitle && <small>{subtitle}</small>}</div>
        </div>
        {children}
        {foot && <div className="cash-card-foot">{foot}</div>}
      </div>
    </div>,
    host
  );
}

/* ───────────────────────── El movimiento ───────────────────────── */

const atOf = (m) => m?.created_at || m?.at || null;
export const catLabelOf = (t, c) => t(c ? `adm.cash.cat.${c}` : "adm.cash.cat.none");

/**
 * Props: `movement` (fila del libro o del informe), `stores` (ctx.stores, para
 * el nombre de la tienda), `openSale(saleId)` opcional (abre la venta enlazada
 * con el panel de venta), `onClose`.
 */
export default function CashMovementPanel({ movement, stores = [], openSale, onClose }) {
  const { t, lang } = useLang();
  const [detail, setDetail] = useState(null);
  const [failed, setFailed] = useState(false);
  const locale = lang === "en" ? "en-US" : "es-US";
  const m = (cents) => money((Number(cents) || 0) / 100, "usd", lang);
  const when = (iso) => (iso ? new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "—");

  useEffect(() => {
    let alive = true;
    setDetail(null); setFailed(false);
    if (!movement?.session_id) return undefined;
    fetchCashSession(movement.session_id).then((d) => { if (alive) setDetail(d); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [movement?.session_id, movement?.id]);

  if (!movement) return null;
  const session = detail?.session || null;
  // The fresh ledger line (with who / till resolved) wins over the row that opened the panel.
  const live = session?.movements?.find((x) => x.id === movement.id) || movement;
  const amountCents = live.amount_cents ?? Math.round((live.amount || 0) * 100);
  const storeId = live.establishment_id || session?.establishment_id || null;
  const store = stores.find((s) => s.id === storeId);
  const sale = live.sale_id ? detail?.sales?.[live.sale_id] || null : null;
  const by = live.by || null;
  const audit = detail?.audit || [];
  const auto = live.auto ?? ["sale_payment", "sale_refund", "opening_float"].includes(live.category);
  const kv = (label, value, sub, cls = "") => (
    <div className={`cm-kv ${cls}`}><small>{label}</small><b>{value ?? "—"}</b>{sub ? <span>{sub}</span> : null}</div>
  );
  const foot = (
    <>
      <span className="grow" />
      {sale && openSale && <button type="button" className="btn-sm primary" onClick={() => { onClose?.(); openSale(sale.id); }}><Icon name="receipt" size={14} /> {t("adm.cash.panel.openSale")} <Icon name="chevronRight" size={14} /></button>}
      <button type="button" className="btn-sm ghost" onClick={onClose}>{t("adm.cash.panel.close")}</button>
    </>
  );

  return (
    <CashOverlay icon={live.kind === "out" ? "trendDown" : "trendUp"} title={<>{t(`adm.cash.mv.${live.kind}`)} · {catLabelOf(t, live.category)}{auto && <span className="adm-chip neutral">{t("adm.cash.panel.auto")}</span>}</>}
      subtitle={`${when(atOf(live))}${store ? ` · ${store.code} · ${store.name}` : ""}`} onClose={onClose} foot={foot} label={t("adm.cash.panel.title")}>
      <div className={`cash-amount-big ${live.kind}`}>{live.kind === "out" ? "−" : "+"}{m(amountCents)}</div>
      <div className="cm-grid">
        {kv(t("adm.cash.panel.who"), by ? by.name : "—", by?.code ? `${t("adm.cash.panel.code")}: ${by.code}` : null)}
        {kv(t("adm.cash.panel.when"), when(atOf(live)))}
        {kv(t("adm.cash.panel.where"), store ? `${store.code} · ${store.name}` : storeId || "—", live.terminal_code ? `${t("adm.cash.rep.till")}: ${live.terminal_code}` : t("adm.cash.panel.noTill"))}
        {kv(t("adm.cash.rep.type"), t(`adm.cash.mv.${live.kind}`), auto ? t("adm.cash.panel.autoHint") : t("adm.cash.panel.manualHint"))}
        {kv(t("adm.cash.category"), catLabelOf(t, live.category))}
        {kv(t("adm.cash.rep.note"), live.note || "—", null, "wide")}
      </div>

      {live.sale_id && (
        <div className="cm-sale">
          <Icon name="receipt" size={18} />
          <div className="grow">
            <b>{sale?.number || live.note || live.sale_id}</b>
            {sale && <div className="cash-hint">{sale.customer_name || t("adm.cash.panel.noCustomer")} · {m(Math.round((sale.total || 0) * 100))}{sale.seller_code ? ` · ${sale.seller_code}` : ""}{sale.status === "voided" ? ` · ${t("adm.cash.panel.voided")}` : ""}</div>}
            {!sale && !failed && !detail && <div className="cash-hint">{t("adm.ord.loading")}</div>}
          </div>
          {openSale && <button type="button" className="btn-xs" onClick={() => { onClose?.(); openSale(live.sale_id); }}>{t("adm.cash.panel.openSale")} <Icon name="chevronRight" size={12} /></button>}
        </div>
      )}

      <div className="cm-section">
        <h4><Icon name="wallet" size={12} /> {t("adm.cash.panel.session")}<HelpTip topic="cash.session" /></h4>
        {session ? (
          <div className="cash-hint">
            {t("adm.cash.panel.sessionLine", { opened: when(session.opened_at), who: session.opened_by_person?.name || "—", sig: session.opened_signature || "—" })}
            {session.closed_at ? ` · ${t("adm.cash.panel.sessionClosed", { closed: when(session.closed_at), who: session.closed_by_person?.name || "—", sig: session.closed_signature || "—" })}` : ` · ${t("adm.cash.rep.stillOpen")}`}
            {" · "}<span className={`adm-chip cash-status-chip ${session.status}`}>{t(`adm.cash.status.${session.status}`)}</span>
          </div>
        ) : <div className="cash-hint">{failed ? t("adm.err.pos.generic") : t("adm.ord.loading")}</div>}
      </div>

      <div className="cm-section">
        <h4><Icon name="history" size={12} /> {t("adm.cash.panel.audit")}</h4>
        {audit.length ? (
          <ul className="cm-audit">
            {audit.map((e) => (
              <li key={e.id}><time>{when(e.created_at)}</time><span>{t(`adm.audit.action.${e.action}`)}</span>{e.after?.signature || e.after?.approval_signature ? <span className="cash-sig">{e.after.approval_signature || e.after.signature}</span> : null}{e.after?.kind ? <code>{e.after.kind}</code> : null}</li>
            ))}
          </ul>
        ) : <div className="cash-hint">{detail ? t("adm.cash.panel.noAudit") : failed ? "—" : t("adm.ord.loading")}</div>}
        <p className="cash-hint">{t("adm.cash.panel.ids", { id: live.id, payment: live.payment_id || "—" })}</p>
      </div>
    </CashOverlay>
  );
}

/** Estado + panel listos para usar: `open(movement)`, `close()`, `panel`. */
export function useMovementPanel({ stores = [], openSale } = {}) {
  const [cur, setCur] = useState(null);
  const open = useCallback((movement) => { if (movement) setCur(movement); }, []);
  const close = useCallback(() => setCur(null), []);
  const panel = cur ? <CashMovementPanel movement={cur} stores={stores} openSale={openSale} onClose={close} /> : null;
  return { open, close, panel, movement: cur };
}

// Dónde se usa: pestaña «Caja» de /admin (HU-32), en dos subpestañas.
// «Caja del día» — la caja de la TIENDA (no de un punto de venta; decisión
// del dueño, nov-2026): estado de la sesión abierta (desde cuándo, quién la
// abrió y su firma, fondo, cobros en efectivo, devoluciones, entradas y
// salidas manuales, lo que debe haber ahora), «Abrir caja» (fondo + iniciales),
// «Registrar movimiento», «Cerrar caja» (CashClosePanel.jsx: contador de
// billetes, diferencia en vivo, firma; con diferencia queda pendiente de la
// autorización del dueño), cierres pendientes con «Aprobar» para el dueño,
// impresión por duplicado y reenvío por correo de la apertura y el cierre, y
// el libro de movimientos de la sesión (ordenable, filtros por motivo y por
// caja; cada fila abre CashMovementPanel.jsx con todo el detalle).
// El efectivo cobrado en cualquier punto de venta de la tienda entra solo:
// el primer cobro en efectivo del día abre la caja si nadie lo hizo.
// «Movimientos» — el informe de caja del periodo (CashReport.jsx).
import { useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import HelpTip from "./HelpTip.jsx";
import { money } from "./adminOrders.js";
import { addCashMovement, emailCashDocument, listCashSessions, openCashSession, posContext } from "./posApi.js";
import { SubTabs } from "./ui.jsx";
import CashReport from "./CashReport.jsx";
import { useStoreFilter } from "./StoreFilter.jsx";
import { useSortable } from "./useSortable.js";
import SortTh from "./SortTh.jsx";
import { useSalePanel } from "./SaleDetailPanel.jsx";
import { catLabelOf, useMovementPanel } from "./CashMovementPanel.jsx";
import CashClosePanel, { printCashDocument } from "./CashClosePanel.jsx";
import "./screens.css";
import "./cash.css";

const errKey = (e) => (e?.reason ? `adm.err.pos.${e.reason}` : e?.message?.startsWith("adm.") ? e.message : "adm.err.pos.generic");
/** Same list as CASH_CATEGORIES in the backend (lib/cash.ts): what a person may pick. */
const CATEGORIES = ["supplier_payment", "expense", "owner_withdrawal", "bank_deposit", "change_fund", "refund", "correction", "other"];
/** Lines the register writes on its own (AUTO_CASH_CATEGORIES). */
const AUTO = ["sale_payment", "sale_refund", "opening_float"];
const EMPTY_MV = { kind: "in", amount: "", category: "", note: "" };
const cleanSig = (v) => String(v || "").toUpperCase().replace(/[^A-ZÑÁÉÍÓÚ]/g, "").slice(0, 4);
const SIG = /^[A-ZÑÁÉÍÓÚ]{2,4}$/;

/** Props: `me` (GET /admin/team/me) para el filtro de tienda global; sin él se deduce del contexto del POS. */
export default function PosCash({ me }) {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const [ctx, setCtx] = useState(null);
  const [terminalId, setTerminalId] = useState("");
  // La caja es de UNA tienda: la del filtro global si es suya; con «Todas» o la online, la primera de las suyas.
  const who = me || (ctx ? { is_admin: ctx.is_admin, role: ctx.role } : undefined);
  const { storeId: globalId, isAll, isWeb, store: globalStore } = useStoreFilter(who);
  const storeId = ctx ? (!isAll && !isWeb && ctx.stores.some((s) => s.id === globalId) ? globalId : ctx.stores[0]?.id || "") : "";
  const [sessions, setSessions] = useState([]);
  const [view, setView] = useState("day");
  const [opening, setOpening] = useState("");
  const [openSig, setOpenSig] = useState("");
  const [openNote, setOpenNote] = useState("");
  const [mv, setMv] = useState(EMPTY_MV);
  const [showMv, setShowMv] = useState(false);
  const [closing, setClosing] = useState(null); // { session, mode }
  const [busy, setBusy] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [termFilter, setTermFilter] = useState("");

  useEffect(() => { posContext().then(setCtx).catch(() => setCtx({ stores: [] })); }, []);
  // Solo la última petición pinta: al cambiar de tienda deprisa, las cajas de la anterior no pisan las de la nueva.
  const loadSeq = useRef(0);
  const load = () => {
    const seq = ++loadSeq.current;
    return storeId && listCashSessions(storeId, 40)
      .then((r) => { if (seq === loadSeq.current) setSessions(r.sessions || []); })
      .catch(() => { if (seq === loadSeq.current) setSessions([]); });
  };
  // Cambiar de tienda: su primer punto de venta y sus cajas.
  useEffect(() => { setTerminalId(ctx?.stores.find((s) => s.id === storeId)?.terminals[0]?.id || ""); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [storeId]);

  const store = ctx?.stores.find((s) => s.id === storeId);
  const isAdmin = Boolean(ctx?.is_admin);
  const open = sessions.find((s) => !s.closed_at);
  const pending = sessions.filter((s) => s.status === "pending_approval");
  const history = sessions.filter((s) => s.closed_at);
  const last = history[0] || null;
  const locale = lang === "en" ? "en-US" : "es-US";
  const m = (v) => money(v, "usd", lang);
  const when = (iso) => (iso ? new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }) : "—");
  const person = (p, sig) => (p ? `${p.name}${p.code ? ` (${p.code})` : ""}` : "—") + (sig ? ` · ${sig}` : "");
  const sp = useSalePanel({ me: who, ctx, onChanged: load });
  const mp = useMovementPanel({ stores: ctx?.stores || [], openSale: sp.open });

  const run = async (key, fn, ok) => {
    setBusy(key);
    try { const r = await fn(); if (ok) toast({ tone: "success", title: ok }); await load(); return r; }
    catch (e) { toast({ tone: "error", title: t(errKey(e)) }); return null; }
    finally { setBusy(""); }
  };
  const doOpen = () => run("open", () => openCashSession({ store: storeId, opening: opening === "" ? (last?.counted ?? 0) : opening, signature: openSig, note: openNote || undefined, terminal_id: terminalId || undefined }), t("adm.cash.opened")).then((r) => { if (r) { setOpening(""); setOpenSig(""); setOpenNote(""); } });
  const doMove = () => run("move", () => addCashMovement(open.id, { ...mv, terminal_id: terminalId || undefined }), t("adm.cash.moved")).then((r) => { if (r) { setMv(EMPTY_MV); setShowMv(false); } });
  const doPrint = (s, kind) => run(`print-${s.id}-${kind}`, () => printCashDocument(s.id, kind, lang, t), null);
  const doEmail = (s, kind) => run(`email-${s.id}-${kind}`, () => emailCashDocument(s.id, kind), t("adm.cash.emailSent"));

  // Libro de la sesión abierta: filtros por motivo y por caja, cabeceras que ordenan.
  const ledger = open?.movements || [];
  const catCounts = useMemo(() => { const o = {}; for (const x of ledger) { const k = x.category || "none"; o[k] = (o[k] || 0) + 1; } return o; }, [ledger]);
  const termCounts = useMemo(() => { const o = {}; for (const x of ledger) { const k = x.terminal_code || "—"; o[k] = (o[k] || 0) + 1; } return o; }, [ledger]);
  const filtered = useMemo(() => ledger.filter((x) => (!catFilter || (x.category || "none") === catFilter) && (!termFilter || (x.terminal_code || "—") === termFilter)), [ledger, catFilter, termFilter]);
  const sorted = useSortable(filtered, { id: "cash-ledger", defaultKey: "created_at", defaultDir: "desc", deps: [lang], getters: { kind: (x) => t(`adm.cash.mv.${x.kind}`), category: (x) => catLabelOf(t, x.category), who: (x) => x.by?.name || "", sale: (x) => (x.sale_id ? x.note || "" : ""), amount: (x) => (x.kind === "out" ? -x.amount_cents : x.amount_cents) } });
  const histSorted = useSortable(history, { id: "cash-history", defaultKey: "opened_at", defaultDir: "desc", deps: [lang], getters: { opened_by: (s) => s.opened_by_person?.name || "", closed_by: (s) => s.closed_by_person?.name || "", status: (s) => t(`adm.cash.status.${s.status}`) } });
  const sth = (srt, col, label, align = "") => <SortTh col={col} sort={srt.sort} onSort={srt.toggle} align={align}>{label}</SortTh>;
  const statusChip = (s) => <span className={`adm-chip cash-status-chip ${s.status}`}>{t(`adm.cash.status.${s.status}`)}</span>;

  if (!ctx) return <div className="adm-section"><div className="adm-src-note loading">{t("adm.ord.loading")}</div></div>;
  if (ctx.seller_block) return <div className="adm-section"><div className="adm-empty"><Icon name="lock" size={36} /><b>{t(`adm.err.pos.${ctx.seller_block}`)}</b><p>{t("adm.pos.sellerBlockHint")}</p></div></div>;
  const docButtons = (s, kind) => (
    <span className="cash-row-actions">
      <button type="button" className="btn-xs" disabled={busy !== ""} onClick={() => doPrint(s, kind)} title={t(kind === "close" ? "adm.cash.printClose" : "adm.cash.printOpen")}><Icon name="printer" size={12} /> {t("adm.cash.printDuo")}</button>
      <button type="button" className="btn-xs" disabled={busy !== ""} onClick={() => doEmail(s, kind)} title={t("adm.cash.emailResend")}><Icon name="mail" size={12} /></button>
    </span>
  );

  return (
    <div className="adm-section pos">
      <div className="adm-head-row">
        <h2>{t("adm.tab.cash")}<HelpTip topic="cash.session" size={16} /></h2>
        <div className="pos-where">
          {view === "day" && store && (!globalStore || globalStore.id !== store.id) && (
            <span className="scr-store-note" title={ctx.stores.length > 1 ? t("adm.scr.storeHint") : undefined}><Icon name="store" size={12} /> {t("adm.scr.storeShown", { store: `${store.code} · ${store.name}` })}</span>
          )}
          {view === "day" && ((store?.terminals.length || 0) > 1 ? (
            <select value={terminalId} onChange={(e) => setTerminalId(e.target.value)} aria-label={t("adm.cash.myTill")} title={t("adm.cash.myTill")}>
              {store?.terminals.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
            </select>
          ) : terminalId && <span className="adm-team-tag" title={t("adm.cash.myTill")}><Icon name="receipt" size={12} /> {store?.terminals.find((x) => x.id === terminalId)?.code || "…"}</span>)}
        </div>
      </div>
      <SubTabs value={view} onChange={setView} items={[{ key: "day", icon: "wallet", label: t("adm.cash.tab.day") }, { key: "report", icon: "history", label: t("adm.cash.tab.report") }]} />
      {view === "report" && <CashReport ctx={ctx} me={who} />}
      {view === "day" && <p className="adm-sub">{t("adm.cash.storeSub")}</p>}

      {view === "day" && pending.length > 0 && (
        <div className="cash-pending">
          <h3><Icon name="alert" size={14} /> {t("adm.cash.pendingTitle", { n: pending.length })}<HelpTip topic="cash.close" /></h3>
          {pending.map((s) => (
            <div key={s.id} className="cash-pending-row">
              <span className="grow">{t("adm.cash.pendingRow", { date: when(s.closed_at), who: person(s.closed_by_person, s.closed_signature), expected: m(s.expected), counted: m(s.counted) })}{s.note ? ` · ${s.note}` : ""}</span>
              <b className={s.diff < 0 ? "neg" : "pos"}>{s.diff > 0 ? "+" : "−"}{m(Math.abs(s.diff))}</b>
              {docButtons(s, "close")}
              {isAdmin ? <button type="button" className="btn-sm primary" onClick={() => setClosing({ session: s, mode: "approve" })}><Icon name="check" size={14} /> {t("adm.cash.approveBtn")}</button> : <span className="adm-chip warn">{t("adm.cash.status.pending_approval")}</span>}
            </div>
          ))}
        </div>
      )}

      {view !== "day" ? null : !open ? (
        <div className="adm-card pos-card cash-status">
          <div className="cash-status-head">
            <h3><Icon name="lock" size={14} /> {t("adm.cash.closedTitle", { store: store ? store.name : "" })}<HelpTip topic="cash.session" /></h3>
          </div>
          {last && <div className="cash-closed-note"><Icon name="history" size={13} /> {t("adm.cash.lastClose", { date: when(last.closed_at), who: person(last.closed_by_person, last.closed_signature), counted: m(last.counted) })} {statusChip(last)}</div>}
          <p className="cash-hint">{t("adm.cash.autoOpenHint")}</p>
          <div className="cash-form">
            <div className="cash-form-row">
              <label className="sm">{t("adm.cash.opening")}<input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value.replace(/[^\d.]/g, ""))} placeholder={String(last?.counted ?? 0)} /></label>
              <label className="sm">{t("adm.cash.signature")}<input className="sig" value={openSig} onChange={(e) => setOpenSig(cleanSig(e.target.value))} placeholder="AB" maxLength={4} /></label>
              <label className="lg">{t("adm.cash.openNote")}<input value={openNote} onChange={(e) => setOpenNote(e.target.value)} placeholder={t("adm.cash.openNotePh")} /></label>
              <button type="button" className="btn-sm primary" disabled={busy !== "" || !storeId || !SIG.test(openSig)} onClick={doOpen}><Icon name="wallet" size={14} /> {t("adm.cash.open")}</button>
            </div>
            <p className="cash-hint">{t("adm.cash.signatureHint")}</p>
          </div>
        </div>
      ) : (
        <div className="adm-card pos-card cash-status">
          <div className="cash-status-head">
            <h3><Icon name="wallet" size={14} /> {t("adm.cash.openStore", { store: store ? store.name : "" })} {statusChip(open)}<HelpTip topic="cash.session" /></h3>
            <span className="cash-since">{t("adm.cash.openSinceBy", { date: when(open.opened_at), who: person(open.opened_by_person, null) })} <span className="cash-sig">{open.opened_signature || "—"}</span>{open.opening_note === "auto" ? ` · ${t("adm.cash.autoOpen")}` : ""}</span>
          </div>
          <div className="cash-tiles">
            <div className="cash-tile"><small>{t("adm.cash.opening")}</small><b>{m(open.opening)}</b></div>
            <div className="cash-tile pos"><small>{t("adm.cash.cashSales")}</small><b>{m(open.cash_in_sales + (open.refunds || 0))}</b><span>{t("adm.cash.nPayments", { n: open.cash_payments_count || 0 })}</span></div>
            {open.refunds > 0 && <div className="cash-tile neg"><small>{t("adm.cash.refunds")}</small><b>−{m(open.refunds)}</b></div>}
            <div className={`cash-tile ${open.manual_in ? "pos" : ""}`}><small>{t("adm.cash.manualIn")}</small><b>+{m(open.manual_in)}</b></div>
            <div className={`cash-tile ${open.manual_out ? "neg" : ""}`}><small>{t("adm.cash.manualOut")}</small><b>−{m(open.manual_out)}</b></div>
            <div className="cash-tile main"><small>{t("adm.cash.expectedNow")}</small><b>{m(open.expected)}</b></div>
          </div>
          <div className="cash-actions">
            <button type="button" className="btn-sm" onClick={() => setShowMv((v) => !v)}><Icon name="plus" size={14} /> {t("adm.cash.recordMovement")}</button>
            <button type="button" className="btn-sm primary" disabled={busy !== ""} onClick={() => setClosing({ session: open, mode: "close" })}><Icon name="lock" size={14} /> {t("adm.cash.close")}</button>
            <span className="spacer" />
            <button type="button" className="btn-xs" disabled={busy !== ""} onClick={() => doPrint(open, "open")}><Icon name="printer" size={12} /> {t("adm.cash.printOpen")}</button>
            <button type="button" className="btn-xs" disabled={busy !== ""} onClick={() => doEmail(open, "open")}><Icon name="mail" size={12} /> {t("adm.cash.emailResend")}</button>
          </div>
          {showMv && (
            <div className="cash-form">
              <div className="cash-form-row">
                <HelpTip topic="cash.movement" />
                <label className="sm">{t("adm.cash.movement")}
                  <select value={mv.kind} onChange={(e) => setMv((x) => ({ ...x, kind: e.target.value }))} aria-label={t("adm.cash.movement")}>
                    <option value="in">{t("adm.cash.mv.in")}</option><option value="out">{t("adm.cash.mv.out")}</option>
                  </select>
                </label>
                <label className="sm">{t("adm.pos.pay.amount")}<input inputMode="decimal" value={mv.amount} onChange={(e) => setMv((x) => ({ ...x, amount: e.target.value.replace(/[^\d.]/g, "") }))} placeholder="0.00" /></label>
                <label>{t("adm.cash.category")}
                  <select value={mv.category} onChange={(e) => setMv((x) => ({ ...x, category: e.target.value }))} aria-label={t("adm.cash.category")} required>
                    <option value="">{t("adm.cash.categoryPick")}</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{t(`adm.cash.cat.${c}`)}</option>)}
                  </select>
                </label>
                <label className="lg">{t("adm.cash.mvNote")}<input value={mv.note} onChange={(e) => setMv((x) => ({ ...x, note: e.target.value }))} placeholder={t("adm.cash.mvNote")} /></label>
                <button type="button" className="btn-sm primary" disabled={busy !== "" || !Number(mv.amount) || !mv.category || !mv.note.trim()} onClick={doMove}>{t("adm.cash.record")}</button>
              </div>
            </div>
          )}

          <div className="cash-ledger-head">
            <h3>{t("adm.cash.ledger")} <small className="muted">{t("adm.cash.rep.nMovements", { n: ledger.length })}</small></h3>
            {ledger.length > 0 && (
              <span className="cash-chips" role="group" aria-label={t("adm.cash.category")}>
                <button type="button" className={`cash-chip ${!catFilter ? "on" : ""}`} onClick={() => setCatFilter("")}>{t("adm.cash.rep.all")}</button>
                {[...AUTO, ...CATEGORIES, "none"].filter((c) => catCounts[c]).map((c) => (
                  <button key={c} type="button" className={`cash-chip ${catFilter === c ? "on" : ""}`} onClick={() => setCatFilter(catFilter === c ? "" : c)}>{catLabelOf(t, c === "none" ? null : c)} · {catCounts[c]}</button>
                ))}
              </span>
            )}
            {Object.keys(termCounts).length > 1 && (
              <span className="cash-chips" role="group" aria-label={t("adm.cash.rep.till")}>
                {Object.keys(termCounts).sort().map((c) => (
                  <button key={c} type="button" className={`cash-chip ${termFilter === c ? "on" : ""}`} onClick={() => setTermFilter(termFilter === c ? "" : c)}><Icon name="receipt" size={11} /> {c} · {termCounts[c]}</button>
                ))}
              </span>
            )}
          </div>
          {filtered.length ? (
            <table className="adm-table responsive cash-ledger">
              <thead><tr>{sth(sorted, "created_at", t("adm.cash.rep.when"))}{sth(sorted, "terminal_code", t("adm.cash.rep.till"))}{sth(sorted, "kind", t("adm.cash.rep.type"))}{sth(sorted, "category", t("adm.cash.category"))}{sth(sorted, "sale", t("adm.cash.sale"))}{sth(sorted, "who", t("adm.cash.rep.who"))}{sth(sorted, "amount", t("adm.cash.rep.amount"), "r")}</tr></thead>
              <tbody>
                {sorted.rows.map((x) => (
                  <tr key={x.id} tabIndex={0} onClick={() => mp.open(x)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); mp.open(x); } }} title={t("adm.cash.rowHint")}>
                    <td data-label={t("adm.cash.rep.when")}>{when(x.created_at)}</td>
                    <td data-label={t("adm.cash.rep.till")}>{x.terminal_code || "—"}</td>
                    <td data-label={t("adm.cash.rep.type")}><span className={`cash-kind ${x.kind}`}>{t(`adm.cash.mv.${x.kind}`)}</span>{x.auto && <span className="cash-auto">{t("adm.cash.panel.auto")}</span>}</td>
                    <td data-label={t("adm.cash.category")}>{catLabelOf(t, x.category)}{x.note && !x.sale_id ? <small className="muted"> · {x.note}</small> : null}</td>
                    <td data-label={t("adm.cash.sale")}>{x.sale_id ? <code>{x.note}</code> : "—"}</td>
                    <td data-label={t("adm.cash.rep.who")}>{x.by ? <>{x.by.name}{x.by.code && <> <code>{x.by.code}</code></>}</> : "—"}</td>
                    <td data-label={t("adm.cash.rep.amount")} className={`r num cash-amt ${x.kind}`}><b>{x.kind === "out" ? "−" : "+"}{m(x.amount)}</b></td>
                  </tr>
                ))}
              </tbody>
              {(catFilter || termFilter) && <tfoot><tr><td colSpan="6">{t("adm.cash.rep.total")}</td><td className="r num">{m(filtered.reduce((s, x) => s + (x.kind === "out" ? -x.amount : x.amount), 0))}</td></tr></tfoot>}
            </table>
          ) : <div className="adm-nodata">{t("adm.cash.ledgerEmpty")}</div>}
        </div>
      )}

      {view === "day" && <div className="adm-card">
        <h3>{t("adm.cash.history")}</h3>
        <table className="adm-table responsive">
          <thead><tr>{sth(histSorted, "opened_at", t("adm.cash.openedAt"))}{sth(histSorted, "closed_at", t("adm.cash.rep.closedAt"))}{sth(histSorted, "opened_by", t("adm.cash.openedBy"))}{sth(histSorted, "closed_by", t("adm.cash.closedBy"))}{sth(histSorted, "opening", t("adm.cash.opening"), "r")}{sth(histSorted, "expected", t("adm.cash.expected"), "r")}{sth(histSorted, "counted", t("adm.cash.counted"), "r")}{sth(histSorted, "diff", t("adm.cash.diffCol"), "r")}{sth(histSorted, "status", t("adm.cash.statusCol"))}<th>{t("adm.cash.docs")}</th></tr></thead>
          <tbody>
            {histSorted.rows.map((s) => (
              <tr key={s.id}>
                <td data-label={t("adm.cash.openedAt")}>{when(s.opened_at)}</td>
                <td data-label={t("adm.cash.rep.closedAt")}>{when(s.closed_at)}</td>
                <td data-label={t("adm.cash.openedBy")}>{person(s.opened_by_person, null)} <span className="cash-sig">{s.opened_signature || "—"}</span>{s.opening_note === "auto" ? <small className="muted"> · {t("adm.cash.autoOpen")}</small> : null}</td>
                <td data-label={t("adm.cash.closedBy")}>{person(s.closed_by_person, null)} <span className="cash-sig">{s.closed_signature || "—"}</span></td>
                <td className="r num" data-label={t("adm.cash.opening")}>{m(s.opening)}</td>
                <td className="r num" data-label={t("adm.cash.expected")}>{m(s.expected)}</td>
                <td className="r num" data-label={t("adm.cash.counted")}>{m(s.counted)}</td>
                <td className={`r num ${s.diff ? (s.diff < 0 ? "cash-amt out" : "cash-amt in") : ""}`} data-label={t("adm.cash.diffCol")}><b>{m(s.diff)}</b>{s.note ? <small className="muted"> · {s.note}</small> : null}</td>
                <td data-label={t("adm.cash.statusCol")}>{statusChip(s)}{s.approval_signature && <small className="muted"> · {t("adm.cash.approvedBy", { who: person(s.approved_by_person, null) })} <span className="cash-sig">{s.approval_signature}</span></small>}</td>
                <td data-label={t("adm.cash.docs")}>{docButtons(s, "close")}</td>
              </tr>
            ))}
            {!history.length && <tr><td colSpan="10" className="full"><div className="adm-nodata">{t("adm.cash.none")}</div></td></tr>}
          </tbody>
        </table>
      </div>}

      {closing && <CashClosePanel session={closing.session} mode={closing.mode} isAdmin={isAdmin} onClose={() => setClosing(null)} onDone={() => load()} />}
      {mp.panel}
      {sp.panel}
    </div>
  );
}

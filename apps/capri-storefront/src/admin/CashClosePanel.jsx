// Cierre de la caja de la TIENDA (Caja → «Caja del día», PosCash.jsx). Capa
// delante de la pantalla (portal en .adm-main, fondo difuminado) con:
//   contador rápido de billetes (100/50/20/10/5/1) y monedas → «Contado»
//   (editable a mano), «Debe haber» del servidor, diferencia en vivo con
//   color, firma digital = iniciales de quien cierra (obligatoria), nota.
//   Si no cuadra y quien cierra no es dueño/superadmin: aviso de que queda
//   pendiente de la autorización del dueño. El dueño ve «Autorizar con mi
//   firma» (sus iniciales) y cierra en el mismo paso.
// En modo `approve` solo pide las iniciales del dueño para una sesión ya
// contada que quedó pendiente (POST …/approve).
//
//   <CashClosePanel session={open} isAdmin={ctx.is_admin} onClose={…} onDone={(session) => …} />
//   <CashClosePanel session={pending} mode="approve" isAdmin onClose={…} onDone={…} />
//
// También exporta la impresión del documento de apertura/cierre por duplicado
// (hoja carta apaisada, dos copias con línea de corte, mismo aspecto que el
// recibo doble de SaleDocuments.jsx): printCashDocument(sessionId, kind, lang, t).
import { useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import HelpTip from "./HelpTip.jsx";
import { money } from "./adminOrders.js";
import { printHtml } from "./exportUtils.js";
import { DUO_PAGE_CSS, PRINT_CSS } from "./SaleDocuments.jsx";
import { approveCashSession, closeCashSession, fetchCashDocument } from "./posApi.js";
import { CashOverlay, catLabelOf } from "./CashMovementPanel.jsx";
import "./cash.css";

const errKey = (e) => (e?.reason ? `adm.err.pos.${e.reason}` : e?.message?.startsWith("adm.") ? e.message : "adm.err.pos.generic");
/** Billetes y monedas en dólares; cada uno con su contador. */
const BILLS = [100, 50, 20, 10, 5, 1];
const COINS = [0.25, 0.1, 0.05, 0.01];
const SIG = /^[A-ZÑÁÉÍÓÚ]{2,4}$/;
const cleanSig = (v) => String(v || "").toUpperCase().replace(/[^A-ZÑÁÉÍÓÚ]/g, "").slice(0, 4);

export default function CashClosePanel({ session, isAdmin = false, mode = "close", onClose, onDone }) {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const [counts, setCounts] = useState({});
  const [manual, setManual] = useState("");
  const [signature, setSignature] = useState("");
  const [approval, setApproval] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const m = (v) => money(v, "usd", lang);
  const approving = mode === "approve";

  const fromDenoms = useMemo(() => Math.round([...BILLS, ...COINS].reduce((s, d) => s + d * (Number(counts[d]) || 0), 0) * 100) / 100, [counts]);
  const touched = Object.values(counts).some((v) => Number(v) > 0);
  const counted = approving ? session.counted : manual !== "" ? Number(manual) : touched ? fromDenoms : null;
  const expected = session.expected;
  const diff = counted == null ? null : Math.round((counted - expected) * 100) / 100;
  const tone = diff == null ? "" : diff === 0 ? "ok" : diff < 0 ? "short" : "over";
  const sigOk = SIG.test(signature);
  const approvalOk = SIG.test(approval);
  const needsApproval = diff != null && diff !== 0;
  const canSubmit = approving ? approvalOk : counted != null && sigOk && (!approval || approvalOk);

  const submit = async () => {
    setBusy(true);
    try {
      const r = approving
        ? await approveCashSession(session.id, approval)
        : await closeCashSession(session.id, { counted, signature, note: note || undefined, approval_signature: isAdmin && needsApproval && approval ? approval : undefined });
      toast({ tone: "success", title: approving ? t("adm.cash.approved") : r.session?.status === "pending_approval" ? t("adm.cash.closedPending") : t("adm.cash.closed") });
      onDone?.(r.session);
      onClose?.();
    } catch (e) {
      toast({ tone: "error", title: t(errKey(e)) });
    } finally { setBusy(false); }
  };

  const foot = (
    <>
      <span className="grow" />
      <button type="button" className="btn-sm ghost" onClick={onClose} disabled={busy}>{t("adm.cash.panel.cancel")}</button>
      <button type="button" className="btn-sm primary" onClick={submit} disabled={busy || !canSubmit}>
        <Icon name={approving ? "check" : "lock"} size={14} /> {approving ? t("adm.cash.approveBtn") : needsApproval && isAdmin && approvalOk ? t("adm.cash.closeApproved") : t("adm.cash.close")}
      </button>
    </>
  );

  const sinceText = new Date(session.opened_at).toLocaleString(lang === "en" ? "en-US" : "es-US", { dateStyle: "short", timeStyle: "short" });
  return (
    <CashOverlay icon="lock" wide title={approving ? t("adm.cash.approveTitle") : t("adm.cash.closeTitle")} subtitle={t("adm.cash.closeSub", { date: sinceText, who: session.opened_by_person?.name || "—", sig: session.opened_signature || "—" })} onClose={onClose} foot={foot}>
      <div className="cc-layout">
        {!approving && (
          <div className="cash-form">
            <div className="cm-section"><h4><Icon name="dollar" size={12} /> {t("adm.cash.denoms")}<HelpTip topic="cash.close" /></h4></div>
            <div className="cc-denoms">
              {[...BILLS, ...COINS].map((d) => (
                <label key={d} className="cc-denom">
                  <b>{d >= 1 ? `$${d}` : `${Math.round(d * 100)}¢`}</b>
                  <input inputMode="numeric" value={counts[d] ?? ""} onChange={(e) => { setManual(""); setCounts((c) => ({ ...c, [d]: e.target.value.replace(/\D/g, "").slice(0, 5) })); }} placeholder="0" aria-label={`${t("adm.cash.denomCount")} ${d}`} />
                  <small>{Number(counts[d]) ? m(d * Number(counts[d])) : "—"}</small>
                </label>
              ))}
            </div>
            <p className="cash-hint">{t("adm.cash.denomsHint")}</p>
          </div>
        )}
        <div className="cc-sum">
          <div className="cc-line"><span>{t("adm.cash.opening")}</span><b>{m(session.opening)}</b></div>
          <div className="cc-line"><span>{t("adm.cash.cashSales")} ({session.cash_payments_count ?? 0})</span><b>{m(session.cash_in_sales + (session.refunds || 0))}</b></div>
          {session.refunds > 0 && <div className="cc-line"><span>{t("adm.cash.refunds")}</span><b className="cash-amt out">−{m(session.refunds)}</b></div>}
          {session.manual_in > 0 && <div className="cc-line"><span>{t("adm.cash.manualIn")}</span><b className="cash-amt in">+{m(session.manual_in)}</b></div>}
          {session.manual_out > 0 && <div className="cc-line"><span>{t("adm.cash.manualOut")}</span><b className="cash-amt out">−{m(session.manual_out)}</b></div>}
          <div className="cc-line big"><span>{t("adm.cash.expected")}</span><b>{m(expected)}</b></div>
          {approving ? (
            <div className="cc-line big"><span>{t("adm.cash.counted")}</span><b>{m(session.counted)}</b></div>
          ) : (
            <label className="cc-counted">
              <span className="cash-hint">{t("adm.cash.counted")} {touched && manual === "" ? `· ${t("adm.cash.fromDenoms")}` : ""}</span>
              <input inputMode="decimal" value={manual !== "" ? manual : touched ? String(fromDenoms) : ""} onChange={(e) => setManual(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" aria-label={t("adm.cash.counted")} />
            </label>
          )}
          {diff != null && (
            <div className={`cc-diff ${tone}`}>
              <span>{t("adm.cash.diffCol")}</span>
              <b>{diff > 0 ? "+" : diff < 0 ? "−" : ""}{m(Math.abs(diff))}</b>
            </div>
          )}
          {diff != null && diff === 0 && <p className="cash-hint">{t("adm.cash.noDiff")}</p>}
          {needsApproval && !isAdmin && !approving && <div className="cc-note">{t("adm.cash.diffNeedsOwner")}</div>}
          {needsApproval && isAdmin && !approving && (
            <div className="cc-approve">
              <label>{t("adm.cash.approveWithSig")}<input className="sig" value={approval} onChange={(e) => setApproval(cleanSig(e.target.value))} placeholder="AB" maxLength={4} aria-label={t("adm.cash.approveWithSig")} /></label>
              <span className="cash-hint">{t("adm.cash.approveHint")}</span>
            </div>
          )}
          {approving && (
            <div className="cc-approve">
              {session.diff != null && <div className="cash-hint">{t("adm.cash.pendingLine", { who: session.closed_by_person?.name || "—", sig: session.closed_signature || "—", note: session.note || "—" })}</div>}
              <label>{t("adm.cash.approveWithSig")}<input className="sig" value={approval} onChange={(e) => setApproval(cleanSig(e.target.value))} placeholder="AB" maxLength={4} autoFocus aria-label={t("adm.cash.approveWithSig")} /></label>
              <span className="cash-hint">{t("adm.cash.approveHint")}</span>
            </div>
          )}
          {!approving && (
            <div className="cash-form-row">
              <label className="sm">{t("adm.cash.signature")}<input className="sig" value={signature} onChange={(e) => setSignature(cleanSig(e.target.value))} placeholder="AB" maxLength={4} aria-label={t("adm.cash.signature")} /></label>
              <label className="lg">{t("adm.cash.note")}<input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("adm.cash.notePh")} aria-label={t("adm.cash.note")} /></label>
            </div>
          )}
          {!approving && <p className="cash-hint">{t("adm.cash.signatureHint")}</p>}
        </div>
      </div>
    </CashOverlay>
  );
}

/* ───────────────────────── Documento por duplicado ───────────────────────── */

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Una mitad de la hoja: cabecera, resumen, cobros por caja/persona, manuales, movimientos, firmas. */
function cashCopyHtml(doc, t, lang, copyKey) {
  const locale = lang === "en" ? "en-US" : "es-US";
  const m = (c) => money((Number(c) || 0) / 100, "usd", lang);
  const when = (iso) => (iso ? new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }) : "—");
  const time = (iso) => (iso ? new Date(iso).toLocaleTimeString(locale, { timeStyle: "short" }) : "—");
  const who = (p, sig) => `${p ? esc(p.name) : "—"}${p?.code ? ` (${esc(p.code)})` : ""}${sig ? ` · <b>${esc(sig)}</b>` : ""}`;
  const s = doc.session;
  const tot = doc.totals;
  const close = doc.kind === "close";
  const kv = (k, v, cls = "") => `<tr${cls ? ` class="${cls}"` : ""}><td>${esc(k)}</td><td class="r">${cls ? `<b>${v}</b>` : v}</td></tr>`;
  const diffSign = (c) => `${c < 0 ? "−" : c > 0 ? "+" : ""}${m(Math.abs(c))}`;
  const rows = doc.movements.map((x) => `<tr><td>${esc(time(x.created_at))}</td><td>${esc(x.terminal_code || "—")}</td><td>${esc(catLabelOf(t, x.category))}${x.note && !x.sale_id ? ` · ${esc(x.note)}` : ""}</td><td>${x.sale_id ? esc(x.note || "") : ""}</td><td>${who(x.by, null)}</td><td class="r">${x.kind === "in" ? "+" : "−"}${m(x.amount_cents)}</td></tr>`).join("");
  return `<div class="half">
    <div class="dh">
      <div><b>${esc(doc.business.name)} · ${esc(doc.store.name)}</b><small>${esc([doc.store.address, doc.store.phone].filter(Boolean).join(" · "))}</small></div>
      <div style="text-align:right"><div class="no">${esc(t(close ? "adm.cash.doc.close" : "adm.cash.doc.open"))}</div><small>${esc(when(close ? s.closed_at : s.opened_at))}</small><small>${esc(t("adm.cash.doc.generated", { date: when(doc.generated_at) }))}</small></div>
    </div>
    <div class="who">
      <div><b>${esc(t("adm.cash.doc.openedBy"))}:</b> ${who(doc.opened_by, s.opened_signature)} · ${esc(when(s.opened_at))}${s.opening_note === "auto" ? ` · ${esc(t("adm.cash.autoOpen"))}` : ""}</div>
      ${close ? `<div><b>${esc(t("adm.cash.doc.closedBy"))}:</b> ${who(doc.closed_by, s.closed_signature)} · ${esc(when(s.closed_at))}</div>` : ""}
    </div>
    <div class="sum">
      <div><table>
        ${kv(t("adm.cash.opening"), m(tot.opening_cents))}
        ${close ? kv(`${t("adm.cash.cashSales")} (${tot.cash_payments_count})`, m(tot.cash_payments_cents)) : ""}
        ${close && tot.refunds_cents ? kv(`${t("adm.cash.refunds")} (${tot.refunds_count})`, `−${m(tot.refunds_cents)}`) : ""}
        ${close && tot.manual_in_cents ? kv(t("adm.cash.manualIn"), `+${m(tot.manual_in_cents)}`) : ""}
        ${close && tot.manual_out_cents ? kv(t("adm.cash.manualOut"), `−${m(tot.manual_out_cents)}`) : ""}
        ${kv(t("adm.cash.expected"), m(tot.expected_cents), "tot")}
        ${close ? kv(t("adm.cash.counted"), m(tot.counted_cents ?? 0), "tot") : ""}
        ${close ? kv(t("adm.cash.diffCol"), diffSign(tot.diff_cents ?? 0), "due") : ""}
        ${s.note ? kv(t("adm.cash.rep.note"), esc(s.note)) : ""}
      </table></div>
      <div>
        ${close && doc.by_terminal.length ? `<h4>${esc(t("adm.cash.doc.byTill"))}</h4><table>${doc.by_terminal.map((r) => `<tr><td>${esc(r.code || "—")}</td><td class="c">${r.count}</td><td class="r">${m(r.cents)}</td></tr>`).join("")}</table>` : ""}
        ${close && doc.by_seller.length ? `<h4>${esc(t("adm.cash.doc.bySeller"))}</h4><table>${doc.by_seller.map((r) => `<tr><td>${who(r.person, null)}</td><td class="c">${r.count}</td><td class="r">${m(r.cents)}</td></tr>`).join("")}</table>` : ""}
        ${close && doc.manual.length ? `<h4>${esc(t("adm.cash.rep.manual"))}</h4><table>${doc.manual.map((r) => `<tr><td>${esc(t(`adm.cash.mv.${r.kind}`))} · ${esc(catLabelOf(t, r.category))} (${r.count})</td><td>${esc(r.notes.join("; "))}</td><td class="r">${r.kind === "in" ? "+" : "−"}${m(r.cents)}</td></tr>`).join("")}</table>` : ""}
      </div>
    </div>
    ${close ? `<div class="note"><b>${esc(t("adm.cash.doc.approval"))}:</b> ${s.approval_signature ? `${who(doc.approved_by, s.approval_signature)} · ${esc(when(s.approved_at))}` : (tot.diff_cents ?? 0) === 0 ? esc(t("adm.cash.noDiff")) : s.status === "pending_approval" ? esc(t("adm.cash.status.pending_approval")) : "—"}</div>` : ""}
    <h4>${esc(t("adm.cash.doc.movements"))} (${doc.movements.length})</h4>
    <table><thead><tr><th>${esc(t("adm.cash.doc.time"))}</th><th>${esc(t("adm.cash.rep.till"))}</th><th>${esc(t("adm.cash.category"))}</th><th>${esc(t("adm.cash.sale"))}</th><th>${esc(t("adm.cash.rep.who"))}</th><th class="r">${esc(t("adm.cash.rep.amount"))}</th></tr></thead><tbody>${rows || `<tr><td colspan="6">${esc(t("adm.cash.rep.empty"))}</td></tr>`}</tbody></table>
    <div class="foot">
      <div class="note">${esc(t("adm.cash.doc.signLine", { open: s.opened_signature || "____", close: s.closed_signature || "____", owner: s.approval_signature || "____" }))}</div>
      <div class="copy">${esc(t(copyKey))}</div>
    </div>
  </div>`;
}

/** Hoja carta apaisada con dos copias idénticas y línea de corte (mismo CSS que el recibo doble). */
export function cashDuoHtml(doc, t, lang) {
  return `<section class="duo">
    ${cashCopyHtml(doc, t, lang, "adm.cash.doc.storeCopy")}
    <div class="cut"><span>✂</span><small>${esc(t("adm.doc.duo.cut"))}</small></div>
    ${cashCopyHtml(doc, t, lang, "adm.cash.doc.closerCopy")}
  </section>`;
}

/** Lee el documento (registrando la impresión) y lo manda a imprimir por duplicado. */
export async function printCashDocument(sessionId, kind, lang, t) {
  const { document: doc } = await fetchCashDocument(sessionId, kind, true);
  printHtml({ html: cashDuoHtml(doc, t, lang), css: PRINT_CSS + DUO_PAGE_CSS, title: `${doc.store.code} · ${t(kind === "close" ? "adm.cash.doc.close" : "adm.cash.doc.open")}`, lang });
  return doc;
}

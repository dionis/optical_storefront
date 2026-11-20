// Dónde se usa: la ficha de una venta (SaleDetailPanel.jsx) → Pagos → «Corregir pagos».
//
// El dueño (15-nov-2026): «debo poder enmendar los problemas de registro, por
// ejemplo si pongo que se cobró 250 de anticipo y fue total […] fundamental
// con los pagos». Se edita la lista de pagos del paciente TAL COMO DEBE
// QUEDAR: cambiar el importe, el método o la referencia de un pago, quitar uno
// anotado por error o añadir el que faltó. El seguro no se toca aquí.
//
// Lo que se ve antes de guardar: lo pagado y el saldo que quedan, y cuánto
// efectivo entra o sale de la caja (la diferencia va como «corrección» a la
// caja ABIERTA de hoy de esa tienda; una caja ya cerrada no se toca). Hace
// falta un motivo; con «Otro», una nota. Todo queda en la auditoría.
// El servidor vuelve a calcularlo todo (backend lib/payment-correction.ts).
import { useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { money } from "./adminOrders.js";
import { correctPayments, methodName } from "./posApi.js";

const REASONS = ["wrong_amount", "wrong_method", "duplicate", "not_received", "missing", "other"];
const cents = (v) => Math.round((Number(v) || 0) * 100);
const isInsurer = (m) => Boolean(m && (m.kind === "insurance" || m.receivable));
let seq = 0;
const key = () => `n${++seq}`;

export default function PaymentCorrection({ sale, methods, storeMethods = null, storeLabel = "", onCancel, onDone }) {
  const { t, lang } = useLang();
  const { toast, confirm } = useFeedback();
  const m = (v) => money(v, "usd", lang);
  const byCode = useMemo(() => new Map((methods || []).map((x) => [x.code, x])), [methods]);
  // Los métodos que se pueden elegir: los de la tienda, sin seguro.
  const choices = useMemo(() => (methods || []).filter((x) => x.is_active !== false && !isInsurer(x) && (!storeMethods || storeMethods.includes(x.code))), [methods, storeMethods]);
  const insurer = (sale.payments || []).filter((p) => p.kind !== "refund" && isInsurer(byCode.get(p.method_code)));
  const start = useMemo(
    () => (sale.payments || [])
      .filter((p) => p.kind !== "refund" && !isInsurer(byCode.get(p.method_code)))
      .map((p) => ({ k: p.id, id: p.id, method_code: p.method_code, amount: String(p.amount), details: { ...(p.details || {}) }, orig: p })),
    [sale.payments, byCode]
  );
  const [rows, setRows] = useState(start);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const due = cents(sale.total) - cents(sale.insurance);
  const paidAfter = rows.reduce((s, r) => s + cents(r.amount), 0);
  const paidBefore = start.reduce((s, r) => s + cents(r.amount), 0);
  const balanceAfter = due - paidAfter;
  const cashOf = (list) => list.reduce((s, r) => s + (byCode.get(r.method_code)?.counts_as_cash ? cents(r.amount) : 0), 0);
  const cashDelta = cashOf(rows) - cashOf(start);
  const changed = (r) => !r.orig || r.method_code !== r.orig.method_code || cents(r.amount) !== cents(r.orig.amount) || refOf(r) !== (r.orig.reference || "");
  const refOf = (r) => (byCode.get(r.method_code)?.reference_fields || []).map((f) => String(r.details?.[f.key] ?? "").trim()).filter(Boolean).join(" · ");
  const removed = start.filter((s0) => !rows.some((r) => r.id === s0.id));
  const dirty = removed.length > 0 || rows.some(changed);
  const missingRef = (r) => (byCode.get(r.method_code)?.reference_fields || []).some((f) => f.required && !String(r.details?.[f.key] ?? "").trim());
  const rowBad = (r) => !r.method_code || !(cents(r.amount) > 0) || (changed(r) && missingRef(r));
  const over = paidAfter > due;
  const canSave = dirty && reason && (reason !== "other" || note.trim()) && !over && !rows.some(rowBad) && !busy;

  const set = (k, patch) => setRows((rs) => rs.map((r) => (r.k === k ? { ...r, ...patch } : r)));
  const add = () => setRows((rs) => [...rs, { k: key(), id: null, method_code: choices[0]?.code || "", amount: balanceAfter > 0 ? String(balanceAfter / 100) : "", details: {}, orig: null }]);
  // El caso del dueño: lo anotado fue un anticipo y en realidad pagó el total.
  const payInFull = () => {
    if (balanceAfter <= 0) return;
    setRows((rs) => {
      if (!rs.length) return [{ k: key(), id: null, method_code: choices[0]?.code || "", amount: String(due / 100), details: {}, orig: null }];
      const last = rs[rs.length - 1];
      return rs.map((r) => (r.k === last.k ? { ...r, amount: String((cents(r.amount) + balanceAfter) / 100) } : r));
    });
    if (!reason) setReason("wrong_amount");
  };

  const save = async () => {
    if (!canSave) return;
    const cashLine = cashDelta === 0 ? "" : ` ${t(cashDelta > 0 ? "adm.sd.payfix.cashIn" : "adm.sd.payfix.cashOut", { v: m(Math.abs(cashDelta) / 100), store: storeLabel })}`;
    if (!(await confirm({ title: t("adm.sd.payfix.confirm", { n: sale.number }), message: `${t("adm.sd.payfix.confirmBody", { paid: m(paidAfter / 100), balance: m(balanceAfter / 100) })}${cashLine}` }))) return;
    setBusy(true);
    try {
      const r = await correctPayments(sale.id, {
        payments: rows.map((x) => (x.orig && !changed(x)
          ? { id: x.id, method_code: x.method_code, amount: x.amount }
          : { ...(x.id ? { id: x.id } : {}), method_code: x.method_code, amount: x.amount, details: x.details })),
        reason,
        note: note.trim() || null,
        seen_paid: sale.paid,
      });
      toast({ tone: "success", title: t("adm.sd.payfix.done") });
      onDone?.(r);
    } catch (e) {
      const max = e?.payload?.max;
      toast({ tone: "error", title: e?.reason === "overpaid" && max != null ? t("adm.sd.payfix.overpaid", { v: m(max) }) : t(e?.message?.startsWith("adm.") ? e.message : "adm.err.pos.generic") });
    } finally { setBusy(false); }
  };

  return (
    <div className="sd-payfix adm-noprint" role="group" aria-label={t("adm.sd.payfix.title")}>
      <h4 className="sd-card-head"><Icon name="edit" size={13} /> {t("adm.sd.payfix.title")}</h4>
      <p className="sd-hint">{t("adm.sd.payfix.hint")}</p>

      <div className="sd-payfix-rows">
        {rows.map((r) => {
          const meth = byCode.get(r.method_code);
          const offered = choices.some((x) => x.code === r.method_code) ? choices : [...(meth ? [meth] : []), ...choices];
          return (
            <div key={r.k} className={`sd-payfix-row ${changed(r) ? "is-changed" : ""} ${r.orig ? "" : "is-new"}`}>
              <div className="sd-payfix-main">
                <select value={r.method_code} onChange={(e) => set(r.k, { method_code: e.target.value, details: {} })} aria-label={t("adm.pos.pay.method")} disabled={busy}>
                  {!r.method_code && <option value="">{t("adm.pos.pay.method")}</option>}
                  {offered.map((x) => <option key={x.code} value={x.code}>{methodName(x, t, lang)}</option>)}
                </select>
                <input inputMode="decimal" value={r.amount} onChange={(e) => set(r.k, { amount: e.target.value.replace(/[^\d.]/g, "") })} aria-label={t("adm.pos.pay.amount")} placeholder={t("adm.pos.pay.amount")} disabled={busy} aria-invalid={!(cents(r.amount) > 0) || undefined} />
                <button type="button" className="btn-xs warn" onClick={() => setRows((rs) => rs.filter((x) => x.k !== r.k))} disabled={busy} aria-label={t("adm.sd.payfix.remove")} title={t("adm.sd.payfix.remove")}><Icon name="trash" size={13} /></button>
              </div>
              {(meth?.reference_fields || []).length > 0 && (
                <div className="sd-payfix-refs">
                  {meth.reference_fields.map((f) => (
                    <input key={f.key} value={r.details?.[f.key] ?? ""} onChange={(e) => set(r.k, { details: { ...r.details, [f.key]: e.target.value } })} disabled={busy}
                      placeholder={`${meth.builtin ? t(`adm.pos.ref.${f.key}`) : (lang === "en" && f.label_en) || f.label || f.key}${f.required ? " *" : ""}`}
                      aria-label={meth.builtin ? t(`adm.pos.ref.${f.key}`) : f.label || f.key} aria-invalid={(changed(r) && f.required && !String(r.details?.[f.key] ?? "").trim()) || undefined} />
                  ))}
                </div>
              )}
              <small className="sd-payfix-tag">
                {!r.orig ? t("adm.sd.payfix.new") : changed(r) ? t("adm.sd.payfix.was", { method: methodName(byCode.get(r.orig.method_code), t, lang) || r.orig.method_code, v: m(r.orig.amount) }) : t("adm.sd.payfix.same")}
              </small>
            </div>
          );
        })}
        {removed.map((p) => (
          <div key={`rm-${p.id}`} className="sd-payfix-row is-removed">
            <div className="sd-payfix-main">
              <span>{methodName(byCode.get(p.method_code), t, lang) || p.method_code} · {m(p.orig.amount)}</span>
              <button type="button" className="btn-xs" onClick={() => setRows((rs) => [...rs, p])} disabled={busy}><Icon name="undo" size={13} /> {t("adm.sd.payfix.undoRemove")}</button>
            </div>
            <small className="sd-payfix-tag">{t("adm.sd.payfix.removed")}</small>
          </div>
        ))}
        {insurer.map((p) => (
          <div key={`ins-${p.id}`} className="sd-payfix-row is-fixed">
            <div className="sd-payfix-main"><span>{methodName(byCode.get(p.method_code), t, lang) || p.method_code} · {m(p.amount)}</span></div>
            <small className="sd-payfix-tag">{t("adm.sd.payfix.insurer")}</small>
          </div>
        ))}
      </div>

      <div className="sd-payfix-actions">
        <button type="button" className="btn-xs" onClick={add} disabled={busy || !choices.length}><Icon name="plus" size={12} /> {t("adm.sd.payfix.add")}</button>
        {balanceAfter > 0 && <button type="button" className="btn-xs" onClick={payInFull} disabled={busy}><Icon name="check" size={12} /> {t("adm.sd.payfix.full", { v: m(due / 100) })}</button>}
      </div>

      <dl className="sd-payfix-sum">
        <div><dt>{t("adm.sd.total")}</dt><dd>{m(sale.total)}</dd></div>
        {sale.insurance > 0 && <div><dt>{t("adm.sd.insurance")}</dt><dd>{m(sale.insurance)}</dd></div>}
        <div><dt>{t("adm.sd.payfix.paidNow")}</dt><dd>{m(paidBefore / 100)} → <b>{m(paidAfter / 100)}</b></dd></div>
        <div className={over ? "bad" : balanceAfter > 0 ? "warn" : "ok"}><dt>{t("adm.sd.balance")}</dt><dd><b>{m(balanceAfter / 100)}</b></dd></div>
        {cashDelta !== 0 && <div className="cash"><dt>{t("adm.sd.payfix.cash")}</dt><dd>{t(cashDelta > 0 ? "adm.sd.payfix.cashIn" : "adm.sd.payfix.cashOut", { v: m(Math.abs(cashDelta) / 100), store: storeLabel })}</dd></div>}
      </dl>
      {over && <p className="sd-payfix-err" role="alert">{t("adm.sd.payfix.overpaid", { v: m(due / 100) })}</p>}

      <div className="sd-payfix-reason">
        <span className="sd-payfix-label">{t("adm.sd.payfix.reason")}</span>
        <div className="sd-payfix-chips" role="radiogroup" aria-label={t("adm.sd.payfix.reason")}>
          {REASONS.map((x) => (
            <button key={x} type="button" role="radio" aria-checked={reason === x} className={`sd-chip ${reason === x ? "on" : ""}`} onClick={() => setReason(x)} disabled={busy}>{t(`adm.sd.payfix.r.${x}`)}</button>
          ))}
        </div>
        <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t(reason === "other" ? "adm.sd.payfix.noteRequired" : "adm.sd.payfix.notePh")} aria-label={t("adm.sd.payfix.note")} disabled={busy} />
      </div>

      <div className="sd-void-row">
        <button type="button" className="btn-sm primary" disabled={!canSave} onClick={save}><Icon name="check" size={14} /> {busy ? t("adm.sd.payfix.saving") : t("adm.sd.payfix.save")}</button>
        <button type="button" className="btn-sm" disabled={busy} onClick={onCancel}>{t("adm.sd.edit.cancel")}</button>
        {!dirty && <small className="sd-hint">{t("adm.sd.payfix.noChanges")}</small>}
      </div>
    </div>
  );
}

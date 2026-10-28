// Dónde se usa: pestaña «Caja» de /admin (HU-32): abrir la caja del punto de
// venta con el fondo, registrar entradas y salidas de efectivo y cerrar con el
// conteo. El efectivo cobrado en ese punto de venta entra solo; la diferencia
// queda registrada y avisa por la regla «Diferencia de caja».
import { Fragment, useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { money } from "./adminOrders.js";
import { adminFetch } from "./adminApi.js";
import { posContext } from "./posApi.js";

const errKey = (e) => (e?.reason ? `adm.err.pos.${e.reason}` : "adm.err.pos.generic");

export default function PosCash() {
  const { t, lang } = useLang();
  const { toast, confirm } = useFeedback();
  const [ctx, setCtx] = useState(null);
  const [storeId, setStoreId] = useState("");
  const [terminalId, setTerminalId] = useState("");
  const [sessions, setSessions] = useState([]);
  const [opening, setOpening] = useState("");
  const [mv, setMv] = useState({ kind: "in", amount: "", note: "" });
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    posContext().then((c) => {
      setCtx(c);
      const s = c.stores[0];
      if (s) { setStoreId(s.id); setTerminalId(s.terminals[0]?.id || ""); }
    }).catch(() => setCtx({ stores: [] }));
  }, []);
  const load = () => storeId && adminFetch(`/admin/pos/cash-sessions?store=${encodeURIComponent(storeId)}`).then((r) => setSessions(r.sessions || [])).catch(() => setSessions([]));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [storeId]);

  const store = ctx?.stores.find((s) => s.id === storeId);
  const open = sessions.find((s) => s.terminal_id === terminalId && !s.closed_at);
  const termCode = (id) => ctx?.stores.flatMap((s) => s.terminals).find((x) => x.id === id)?.code || "…";
  const m = (v) => money(v, "usd", lang);
  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); toast({ tone: "success", title: ok }); await load(); }
    catch (e) { toast({ tone: "error", title: t(errKey(e)) }); }
    finally { setBusy(false); }
  };

  const doOpen = () => run(() => adminFetch("/admin/pos/cash-sessions", { method: "POST", body: { store: storeId, terminal_id: terminalId, opening: opening || 0 } }), t("adm.cash.opened"));
  const doMove = () => run(() => adminFetch(`/admin/pos/cash-sessions/${open.id}/movement`, { method: "POST", body: mv }), t("adm.cash.moved")).then(() => setMv({ kind: "in", amount: "", note: "" }));
  const doClose = async () => {
    const diff = Math.round((Number(counted) - open.expected) * 100) / 100;
    if (!(await confirm({ title: t("adm.cash.closeConfirm"), message: diff === 0 ? t("adm.cash.noDiff") : t("adm.cash.diffWarn", { v: m(diff) }) }))) return;
    run(() => adminFetch(`/admin/pos/cash-sessions/${open.id}/close`, { method: "POST", body: { counted, note } }), t("adm.cash.closed")).then(() => { setCounted(""); setNote(""); });
  };

  if (!ctx) return <div className="adm-section"><div className="adm-src-note loading">{t("adm.ord.loading")}</div></div>;
  if (ctx.seller_block) return <div className="adm-section"><div className="adm-empty"><Icon name="lock" size={36} /><b>{t(`adm.err.pos.${ctx.seller_block}`)}</b><p>{t("adm.pos.sellerBlockHint")}</p></div></div>;
  return (
    <div className="adm-section pos">
      <div className="adm-head-row">
        <h2>{t("adm.tab.cash")}</h2>
        <div className="pos-where">
          <select value={storeId} onChange={(e) => { setStoreId(e.target.value); setTerminalId(ctx.stores.find((s) => s.id === e.target.value)?.terminals[0]?.id || ""); }} aria-label={t("adm.pos.store")} title={t("adm.pos.store")}>
            {ctx.stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
          </select>
          <select value={terminalId} onChange={(e) => setTerminalId(e.target.value)} aria-label={t("adm.pos.terminal")} title={t("adm.pos.terminal")}>
            {store?.terminals.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
          </select>
        </div>
      </div>
      <p className="adm-sub">{t("adm.cash.sub")}</p>

      {!open ? (
        <div className="adm-card pos-card">
          <h3>{t("adm.cash.openTitle", { till: termCode(terminalId) })}</h3>
          <div className="pos-row">
            <label>{t("adm.cash.opening")}<input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" /></label>
          </div>
          <button type="button" className="btn-sm primary" disabled={busy || !terminalId} onClick={doOpen}><Icon name="wallet" size={14} /> {t("adm.cash.open")}</button>
        </div>
      ) : (
        <div className="adm-card pos-card">
          <h3>{t("adm.cash.openSince", { till: termCode(open.terminal_id), date: new Date(open.opened_at).toLocaleString(lang === "en" ? "en-US" : "es-US", { dateStyle: "short", timeStyle: "short" }) })}</h3>
          <dl className="pos-totals">
            <dt>{t("adm.cash.opening")}</dt><dd>{m(open.opening)}</dd>
            <dt>{t("adm.cash.cashSales")}</dt><dd>{m(open.cash_in_sales)}</dd>
            {open.movements.map((x, i) => <Fragment key={i}><dt>{t(`adm.cash.mv.${x.kind}`)} · {x.note}</dt><dd>{x.kind === "out" ? "−" : ""}{m(x.amount)}</dd></Fragment>)}
            <dt className="big">{t("adm.cash.expected")}</dt><dd className="big">{m(open.expected)}</dd>
          </dl>
          <div className="pos-pay">
            <select value={mv.kind} onChange={(e) => setMv((x) => ({ ...x, kind: e.target.value }))} aria-label={t("adm.cash.movement")} title={t("adm.cash.movement")}>
              <option value="in">{t("adm.cash.mv.in")}</option><option value="out">{t("adm.cash.mv.out")}</option>
            </select>
            <input inputMode="decimal" value={mv.amount} onChange={(e) => setMv((x) => ({ ...x, amount: e.target.value.replace(/[^\d.]/g, "") }))} placeholder={t("adm.pos.pay.amount")} aria-label={t("adm.pos.pay.amount")} />
            <input value={mv.note} onChange={(e) => setMv((x) => ({ ...x, note: e.target.value }))} placeholder={t("adm.cash.mvNote")} aria-label={t("adm.cash.mvNote")} />
            <button type="button" className="btn-sm" disabled={busy || !Number(mv.amount) || !mv.note.trim()} onClick={doMove}>{t("adm.cash.record")}</button>
          </div>
          <div className="pos-pay">
            <input inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^\d.]/g, ""))} placeholder={t("adm.cash.counted")} aria-label={t("adm.cash.counted")} />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("adm.cash.note")} aria-label={t("adm.cash.note")} />
            {counted !== "" && <small className={Number(counted) === open.expected ? "pos-change-due" : "pos-flag"}>{t("adm.cash.diff", { v: m(Math.round((Number(counted) - open.expected) * 100) / 100) })}</small>}
            <button type="button" className="btn-sm primary" disabled={busy || counted === ""} onClick={doClose}><Icon name="lock" size={14} /> {t("adm.cash.close")}</button>
          </div>
        </div>
      )}

      <div className="adm-card">
        <h3>{t("adm.cash.history")}</h3>
        <table className="adm-table responsive">
          <thead><tr><th>{t("adm.pos.terminal")}</th><th>{t("adm.cash.openedAt")}</th><th>{t("adm.cash.expected")}</th><th>{t("adm.cash.counted")}</th><th>{t("adm.cash.diffCol")}</th></tr></thead>
          <tbody>
            {sessions.filter((s) => s.closed_at).map((s) => (
              <tr key={s.id}>
                <td data-label={t("adm.pos.terminal")}>{termCode(s.terminal_id)}</td>
                <td data-label={t("adm.cash.openedAt")}>{new Date(s.opened_at).toLocaleString(lang === "en" ? "en-US" : "es-US", { dateStyle: "short", timeStyle: "short" })}</td>
                <td data-label={t("adm.cash.expected")}>{m(s.expected)}</td>
                <td data-label={t("adm.cash.counted")}>{m(s.counted)}</td>
                <td data-label={t("adm.cash.diffCol")}><b className={s.diff ? "pos-flag" : ""}>{m(s.diff)}</b>{s.note ? <small className="muted"> · {s.note}</small> : null}</td>
              </tr>
            ))}
            {!sessions.some((s) => s.closed_at) && <tr><td colSpan="5" className="full"><div className="adm-nodata">{t("adm.cash.none")}</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

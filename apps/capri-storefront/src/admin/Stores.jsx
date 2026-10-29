// Dónde se usa: pestaña Tiendas de /admin — alta y edición de las tiendas físicas
// (Op1, Op2, Op3…), cada una con su canal de venta. Backend: /admin/establishments.
import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { isDemoLogin } from "./adminAuth.js";
import { shortDate } from "./adminOrders.js";
import { fetchStores, createStore, updateStore } from "./adminStores.js";
import Icon from "./icons.jsx";
import StorePricing from "./StorePricing.jsx";
import StoreAssortment from "./StoreAssortment.jsx";
import PriceImport from "./PriceImport.jsx";
import StoreTerminals from "./StoreTerminals.jsx";

const EMPTY = { name: "", address: "", phone: "" };

/**
 * TIENDAS.
 *  · El código (Op1, Op2…) lo pone el servidor al crearla y no cambia nunca:
 *    va impreso en recibos y fichas de laboratorio.
 *  · El recibo lleva los datos del negocio; solo el NOMBRE de la tienda varía
 *    (decisión del dueño). Dirección y teléfono son informativos.
 *  · No se borran: una tienda con ventas solo se desactiva.
 */
export default function Stores() {
  const { t, lang } = useLang();
  const { toast, confirm } = useFeedback();
  const demo = isDemoLogin();
  const [stores, setStores] = useState([]);
  const [state, setState] = useState(demo ? "demo" : "loading");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null); // id en edición
  const [draft, setDraft] = useState(EMPTY);
  const [pricingId, setPricingId] = useState(null); // tienda con el panel de precios abierto
  const [assortId, setAssortId] = useState(null); // tienda con el panel de catálogo abierto

  const load = () => {
    if (demo) return;
    setState("loading");
    fetchStores()
      .then((r) => { setStores(r.establishments || []); setState("ok"); })
      .catch(() => setState("error"));
  };
  useEffect(load, [demo]);

  const run = async (fn, okTitle) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fn();
      setStores(r.establishments || []);
      if (okTitle) toast({ tone: "success", title: okTitle });
      return true;
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
      return false;
    } finally { setBusy(false); }
  };

  const create = async (e) => {
    e.preventDefault();
    const ok = await run(() => createStore(form), t("adm.stores.created"));
    if (ok) setForm(EMPTY);
  };

  const save = async (s) => {
    const ok = await run(() => updateStore(s.id, draft), t("adm.stores.saved", { code: s.code }));
    if (ok) setEditing(null);
  };

  const toggle = async (s) => {
    if (s.is_active) {
      const yes = await confirm({ tone: "danger", title: t("adm.stores.deactivateConfirm", { code: s.code, name: s.name }), message: t("adm.stores.deactivateBody") });
      if (!yes) return;
    }
    await run(() => updateStore(s.id, { is_active: !s.is_active }), t(s.is_active ? "adm.stores.deactivated" : "adm.stores.activated", { code: s.code }));
  };

  return (
    <div className="adm-section">
      <div className="adm-head-row"><h2>{t("adm.stores.title")}</h2></div>
      <p className="adm-sub" style={{ marginTop: -8 }}>{t("adm.stores.intro")}</p>
      {demo && <div className="adm-demo-banner">{t("adm.stores.demoNote")}</div>}
      {state === "error" && <div className="adm-demo-banner">{t("adm.err.stores.loadFailed")}</div>}

      <form className="adm-card" onSubmit={create}>
        <h3><Icon name="plus" size={16} />{t("adm.stores.newTitle")}</h3>
        <p className="adm-sub">{t("adm.stores.newSub")}</p>
        <div className="adm-form-grid">
          <label className="adm-field">{t("adm.stores.name")}<input className="adm-input" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("adm.stores.namePh")} /></label>
          <label className="adm-field">{t("adm.stores.address")}<input className="adm-input" maxLength={160} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
          <label className="adm-field">{t("adm.stores.phone")}<input className="adm-input" maxLength={40} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
        </div>
        <div className="adm-actions" style={{ marginTop: 12 }}>
          <button className="btn-sm primary" disabled={demo || busy}>{busy ? "…" : t("adm.stores.create")}</button>
        </div>
      </form>

      <div className="adm-card">
        <h3><Icon name="store" size={16} />{t("adm.stores.listTitle", { n: stores.length })}</h3>
        {state === "loading" && <div className="adm-src-note loading">{t("adm.ord.loading")}</div>}
        {state === "ok" && stores.length === 0 && <div className="adm-nodata">{t("adm.stores.empty")}</div>}
        <div className="adm-team-rows">
          {stores.map((s) => (
            <div key={s.id} className="adm-team-item">
            <div className="adm-team-row">
              <span className="adm-team-avatar adm-store-code">{s.code}</span>
              {editing === s.id ? (
                <span className="adm-team-main adm-store-edit">
                  <input className="adm-input" aria-label={t("adm.stores.name")} maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  <input className="adm-input" aria-label={t("adm.stores.address")} placeholder={t("adm.stores.address")} maxLength={160} value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
                  <input className="adm-input" aria-label={t("adm.stores.phone")} placeholder={t("adm.stores.phone")} maxLength={40} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
                  <select className="adm-input" aria-label={t("adm.stores.kind")} title={t("adm.stores.kind")} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                    {["own", "family", "partner", "consignment"].map((k) => <option key={k} value={k}>{t(`adm.stores.kind.${k}`)}</option>)}
                  </select>
                  {draft.kind !== "own" && (
                    <input className="adm-input" type="number" min="0" max="100" step="0.5" aria-label={t("adm.stores.settlementPct")} placeholder={t("adm.stores.settlementPct")} value={draft.settlement_pct ?? ""} onChange={(e) => setDraft({ ...draft, settlement_pct: e.target.value === "" ? null : Number(e.target.value) })} />
                  )}
                  <textarea className="adm-input" rows={3} maxLength={600} aria-label={t("adm.stores.receiptNote")} placeholder={t("adm.stores.receiptNote")} value={draft.receipt_note} onChange={(e) => setDraft({ ...draft, receipt_note: e.target.value })} />
                </span>
              ) : (
                <span className="adm-team-main">
                  <b>{s.name}</b>
                  <small className="muted">{[t(`adm.stores.kind.${s.kind || "own"}`), s.address, s.phone, shortDate(s.created_at, lang)].filter(Boolean).join(" · ")}</small>
                </span>
              )}
              {!s.is_active && <span className="adm-chip bad"><Icon name="alert" size={12} />{t("adm.stores.inactive")}</span>}
              {editing === s.id ? (
                <>
                  <button className="btn-xs primary" disabled={busy} onClick={() => save(s)}>{t("adm.stores.save")}</button>
                  <button className="btn-xs" disabled={busy} onClick={() => setEditing(null)}>{t("adm.stores.cancel")}</button>
                </>
              ) : (
                <>
                  <button className="btn-xs primary" disabled={demo} onClick={() => { setAssortId(null); setPricingId(pricingId === s.id ? null : s.id); }}>{t("adm.stores.prices")}</button>
                  <button className="btn-xs primary" disabled={demo} onClick={() => { setPricingId(null); setAssortId(assortId === s.id ? null : s.id); }}>{t("adm.stores.catalog")}</button>
                  <button className="btn-xs" disabled={busy || demo} onClick={() => { setEditing(s.id); setDraft({ name: s.name, address: s.address || "", phone: s.phone || "", kind: s.kind || "own", receipt_note: s.receipt_note || "", settlement_pct: s.settlement_pct ?? null }); }}>{t("adm.stores.edit")}</button>
                  <button className={`btn-xs ${s.is_active ? "warn" : ""}`} disabled={busy || demo} onClick={() => toggle(s)}>{t(s.is_active ? "adm.stores.deactivate" : "adm.stores.activate")}</button>
                </>
              )}
            </div>
            {/* Al editar la tienda se gestionan también sus puntos de venta. */}
            {editing === s.id && <StoreTerminals store={s} disabled={demo} />}
            </div>
          ))}
        </div>
        <p className="adm-sub adm-team-note">{t("adm.stores.codeNote")}</p>
      </div>

      {pricingId && stores.find((s) => s.id === pricingId) && (
        <StorePricing key={pricingId} store={stores.find((s) => s.id === pricingId)} onClose={() => setPricingId(null)} />
      )}

      {assortId && stores.find((s) => s.id === assortId) && (
        <StoreAssortment key={assortId} store={stores.find((s) => s.id === assortId)} onClose={() => setAssortId(null)} />
      )}

      {!demo && <PriceImport />}
    </div>
  );
}

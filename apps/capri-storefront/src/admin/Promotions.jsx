// Dónde se usa: pestaña «Promociones» de /admin (grupo Comercial; dueño y
// superadmin). Las promociones por tienda: cada una con su nombre, sus
// tiendas y sus fechas; se encienden y apagan, se editan, se añaden y se
// quitan. Backend: /admin/store-promotions (lib/promotions.ts, docs/PROMOCIONES.md).
//
// PROMOCIÓN ≠ DESCUENTO: el descuento es un porcentaje (el que el dueño pone
// por artículo en «Productos y precios» y el que teclea el vendedor en la
// caja); la promoción es una oferta con nombre y fechas que el vendedor elige
// en la venta cuando el paciente cumple la condición, y sale por su nombre en
// el recibo. Nunca se suman: la venta toma la mayor de las dos.
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { isDemoLogin } from "./adminAuth.js";
import { money } from "./adminOrders.js";
import { fetchStores } from "./adminStores.js";
import Icon from "./icons.jsx";
import { createPromotion, deletePromotion, fetchPromotions, promoEffect, togglePromotion, updatePromotion } from "./adminPromotions.js";
import "./store-hours.css";
import "./promotions.css";

const KINDS = ["bogo", "percent", "free_service", "gift"];
const KIND_ICON = { bogo: "copy", percent: "percent", free_service: "eye", gift: "box" };
const STATE_TONE = { live: "ok", off: "neutral", scheduled: "gold", ended: "warn" };
const EMPTY = { name: "", kind: "bogo", description: "", pct: 100, buy_qty: 2, get_qty: 1, min_total: "", min_purchases: "", value: "", establishment_ids: [], starts_on: "", ends_on: "", is_active: true };

const toForm = (p) => ({
  name: p.name,
  kind: p.kind,
  description: p.description || "",
  pct: p.pct ?? (p.kind === "bogo" ? 100 : 10),
  buy_qty: p.buy_qty ?? 2,
  get_qty: p.get_qty ?? 1,
  min_total: p.min_total_cents == null ? "" : p.min_total_cents / 100,
  min_purchases: p.min_purchases == null ? "" : p.min_purchases,
  value: p.value_cents == null ? "" : p.value_cents / 100,
  establishment_ids: p.establishment_ids || [],
  starts_on: p.starts_on || "",
  ends_on: p.ends_on || "",
  is_active: p.is_active,
});
const toBody = (f) => ({
  name: f.name,
  kind: f.kind,
  description: f.description || null,
  pct: f.kind === "percent" || f.kind === "bogo" ? Number(f.pct) : null,
  buy_qty: f.kind === "bogo" ? Number(f.buy_qty) : null,
  get_qty: f.kind === "bogo" ? Number(f.get_qty) : null,
  min_total: f.min_total === "" ? null : Number(f.min_total),
  min_purchases: f.min_purchases === "" ? null : Number(f.min_purchases),
  value: f.kind === "free_service" || f.kind === "gift" ? (f.value === "" ? null : Number(f.value)) : null,
  establishment_ids: f.establishment_ids.length ? f.establishment_ids : null,
  starts_on: f.starts_on || null,
  ends_on: f.ends_on || null,
  is_active: f.is_active,
});

function PromoForm({ initial, stores, onCancel, onSave, busy }) {
  const { t } = useLang();
  const [f, setF] = useState(initial);
  const set = (patch) => setF((v) => ({ ...v, ...patch }));
  const money$ = f.kind === "free_service" || f.kind === "gift";
  const toggleStore = (id) => set({ establishment_ids: f.establishment_ids.includes(id) ? f.establishment_ids.filter((x) => x !== id) : [...f.establishment_ids, id] });
  return (
    <form className="adm-card pr-form" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <div className="pr-grid">
        <label className="adm-field wide">{t("adm.promo.f.name")}<input className="adm-input" required maxLength={80} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("adm.promo.f.namePh")} /></label>
        <label className="adm-field">{t("adm.promo.f.kind")}
          <select className="adm-input" value={f.kind} onChange={(e) => set({ kind: e.target.value, pct: e.target.value === "bogo" ? 100 : e.target.value === "percent" ? 10 : f.pct })}>
            {KINDS.map((k) => <option key={k} value={k}>{t(`adm.promo.kind.${k}`)}</option>)}
          </select>
          <small className="muted">{t(`adm.promo.kindHint.${f.kind}`)}</small>
        </label>
        {f.kind === "bogo" && (
          <>
            <label className="adm-field">{t("adm.promo.f.buy")}<input className="adm-input" type="number" min="1" max="10" required value={f.buy_qty} onChange={(e) => set({ buy_qty: e.target.value })} /></label>
            <label className="adm-field">{t("adm.promo.f.get")}<input className="adm-input" type="number" min="1" max="10" required value={f.get_qty} onChange={(e) => set({ get_qty: e.target.value })} /></label>
          </>
        )}
        {(f.kind === "bogo" || f.kind === "percent") && (
          <label className="adm-field">{t(f.kind === "bogo" ? "adm.promo.f.pctBogo" : "adm.promo.f.pct")}<input className="adm-input" type="number" min="1" max="100" required value={f.pct} onChange={(e) => set({ pct: e.target.value })} /></label>
        )}
        {money$ && <label className="adm-field">{t("adm.promo.f.value")}<input className="adm-input" type="number" min="0" step="0.01" value={f.value} onChange={(e) => set({ value: e.target.value })} placeholder="0.00" /></label>}
        <label className="adm-field">{t("adm.promo.f.min")}<input className="adm-input" type="number" min="0" step="0.01" value={f.min_total} onChange={(e) => set({ min_total: e.target.value })} placeholder={t("adm.promo.f.minPh")} /></label>
        {/* Para pacientes que repiten: desde la compra n.º N (backend lib/patient-purchases.ts). */}
        <label className="adm-field">{t("adm.promo.f.minPurchases")}<input className="adm-input" type="number" min="2" max="50" step="1" value={f.min_purchases} onChange={(e) => set({ min_purchases: e.target.value })} placeholder={t("adm.promo.f.minPurchasesPh")} /></label>
        <label className="adm-field">{t("adm.promo.f.starts")}<input className="adm-input" type="date" value={f.starts_on} onChange={(e) => set({ starts_on: e.target.value })} /></label>
        <label className="adm-field">{t("adm.promo.f.ends")}<input className="adm-input" type="date" value={f.ends_on} min={f.starts_on || undefined} onChange={(e) => set({ ends_on: e.target.value })} /></label>
        <label className="adm-field wide">{t("adm.promo.f.description")}<textarea className="adm-input" rows={2} maxLength={300} value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder={t("adm.promo.f.descriptionPh")} /></label>
      </div>
      <fieldset className="pr-stores">
        <legend>{t("adm.promo.f.stores")}</legend>
        <label className="pr-check"><input type="checkbox" checked={f.establishment_ids.length === 0} onChange={() => set({ establishment_ids: [] })} />{t("adm.promo.allStores")}</label>
        {stores.map((s) => (
          <label key={s.id} className="pr-check"><input type="checkbox" checked={f.establishment_ids.includes(s.id)} onChange={() => toggleStore(s.id)} /><b>{s.code}</b> {s.name}</label>
        ))}
      </fieldset>
      <label className="pr-check pr-active"><input type="checkbox" checked={f.is_active} onChange={(e) => set({ is_active: e.target.checked })} />{t("adm.promo.f.active")}</label>
      <div className="adm-actions">
        <button className="btn-sm primary" disabled={busy}><Icon name="save" size={14} />{busy ? "…" : t("adm.promo.save")}</button>
        <button type="button" className="btn-sm" disabled={busy} onClick={onCancel}><Icon name="close" size={14} />{t("adm.promo.cancel")}</button>
      </div>
    </form>
  );
}

export default function Promotions() {
  const { t, lang } = useLang();
  const { toast, confirm } = useFeedback();
  const demo = isDemoLogin();
  const [list, setList] = useState([]);
  const [stores, setStores] = useState([]);
  const [state, setState] = useState(demo ? "demo" : "loading");
  const [editing, setEditing] = useState(null); // "new" | id
  const [busy, setBusy] = useState(false);
  const m = (v) => money(v, "usd", lang);

  useEffect(() => {
    if (demo) return;
    Promise.all([fetchPromotions(), fetchStores()])
      .then(([p, s]) => { setList(p.promotions || []); setStores((s.establishments || []).filter((x) => x.is_active)); setState("ok"); })
      .catch(() => setState("error"));
  }, [demo]);

  const storeCode = useMemo(() => Object.fromEntries(stores.map((s) => [s.id, s.code])), [stores]);

  const run = async (fn, ok) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r?.promotions) setList(r.promotions);
      if (ok) toast({ tone: "success", title: ok });
      return true;
    } catch (e) {
      toast({ tone: "error", title: t(e.message) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async (f) => {
    const body = toBody(f);
    const ok = await run(() => (editing === "new" ? createPromotion(body) : updatePromotion(editing, body)), t("adm.promo.saved", { name: f.name }));
    if (ok) setEditing(null);
  };
  const remove = async (p) => {
    const yes = await confirm({ tone: "danger", title: t("adm.promo.deleteConfirm", { name: p.name }), message: t("adm.promo.deleteBody") });
    if (yes) await run(() => deletePromotion(p.id), t("adm.promo.deleted"));
  };

  const dates = (p) => {
    if (!p.starts_on && !p.ends_on) return t("adm.promo.always");
    const d = (ymd) => new Date(`${ymd}T12:00:00`).toLocaleDateString(lang === "en" ? "en-US" : "es-ES", { day: "numeric", month: "short", year: "numeric" });
    if (p.starts_on && p.ends_on) return t("adm.promo.between", { from: d(p.starts_on), to: d(p.ends_on) });
    return p.starts_on ? t("adm.promo.from", { from: d(p.starts_on) }) : t("adm.promo.until", { to: d(p.ends_on) });
  };

  return (
    <div className="adm-section pr-root">
      <div className="adm-head-row">
        <h2><Icon name="tag" size={20} /> {t("adm.promo.title")}</h2>
        <button type="button" className="btn-sm primary" disabled={demo || busy || editing === "new"} onClick={() => setEditing("new")}><Icon name="plus" size={14} />{t("adm.promo.new")}</button>
      </div>
      <p className="adm-sub">{t("adm.promo.sub")}</p>
      <div className="pr-vs">
        <div><b><Icon name="tag" size={14} /> {t("adm.promo.vs.promoTitle")}</b><span>{t("adm.promo.vs.promo")}</span></div>
        <div><b><Icon name="percent" size={14} /> {t("adm.promo.vs.discountTitle")}</b><span>{t("adm.promo.vs.discount")}</span></div>
        <div className="pr-vs-rule"><Icon name="info" size={14} /> {t("adm.promo.vs.rule")}</div>
      </div>
      {demo && <div className="adm-demo-banner">{t("adm.promo.demo")}</div>}
      {state === "error" && <div className="adm-demo-banner">{t("adm.promo.loadFailed")}</div>}
      {state === "loading" && <div className="adm-src-note loading">{t("adm.ord.loading")}</div>}

      {editing === "new" && <PromoForm initial={EMPTY} stores={stores} busy={busy} onCancel={() => setEditing(null)} onSave={save} />}

      <div className="pr-list">
        {list.map((p) => (
          editing === p.id ? (
            <PromoForm key={p.id} initial={toForm(p)} stores={stores} busy={busy} onCancel={() => setEditing(null)} onSave={save} />
          ) : (
            <article key={p.id} className={`adm-card pr-item ${p.is_active ? "" : "off"}`}>
              <div className="pr-item-head">
                <span className="pr-icon"><Icon name={KIND_ICON[p.kind] || "tag"} size={18} /></span>
                <div className="pr-item-main">
                  <h3>{p.name}</h3>
                  <span className="pr-effect">{promoEffect(p, t, m)}</span>
                </div>
                <span className={`adm-chip ${STATE_TONE[p.state] || ""}`}>{t(`adm.promo.state.${p.state}`)}</span>
                <button type="button" role="switch" aria-checked={p.is_active} className={`sh-switch ${p.is_active ? "on" : ""}`} disabled={demo || busy} onClick={() => run(() => togglePromotion(p.id, !p.is_active), t(p.is_active ? "adm.promo.turnedOff" : "adm.promo.turnedOn", { name: p.name }))} title={t(p.is_active ? "adm.promo.turnOff" : "adm.promo.turnOn")}>
                  <span aria-hidden="true" />{t(p.is_active ? "adm.promo.on" : "adm.promo.off")}
                </button>
              </div>
              {p.description && <p className="pr-desc">{p.description}</p>}
              <div className="pr-facts">
                <span><Icon name="calendar" size={12} />{dates(p)}</span>
                <span><Icon name="store" size={12} />{p.establishment_ids ? p.establishment_ids.map((id) => storeCode[id] || "?").join(" · ") : t("adm.promo.allStores")}</span>
                {p.min_total_cents != null && <span><Icon name="dollar" size={12} />{t("adm.promo.minShort", { value: m(p.min_total_cents / 100) })}</span>}
                {p.min_purchases != null && <span><Icon name="user" size={12} />{t("adm.promo.fromNth", { n: p.min_purchases })}</span>}
                <span className="muted"><Icon name={KIND_ICON[p.kind] || "tag"} size={12} />{t(`adm.promo.kind.${p.kind}`)}</span>
              </div>
              <div className="adm-actions pr-actions">
                <button type="button" className="btn-xs" disabled={demo || busy} onClick={() => setEditing(p.id)}><Icon name="edit" size={12} />{t("adm.promo.edit")}</button>
                <button type="button" className="btn-xs warn" disabled={demo || busy} onClick={() => remove(p)}><Icon name="trash" size={12} />{t("adm.promo.delete")}</button>
              </div>
            </article>
          )
        ))}
        {state === "ok" && list.length === 0 && editing !== "new" && <div className="adm-card"><div className="adm-empty"><Icon name="tag" size={32} /><b>{t("adm.promo.empty")}</b></div></div>}
      </div>
    </div>
  );
}

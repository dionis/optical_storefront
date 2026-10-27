// Dónde se usa: pestaña «Punto de venta» de /admin. Cada bloque aparece solo a
// quien puede usarlo (matriz acordada); el servidor lo vuelve a comprobar:
//  · Puntos de venta (Op2-POS1…): dueño, superadmin, encargado de la tienda (HU-80).
//  · Formas de pago: dueño, superadmin o el privilegio «Gestionar formas de pago» (HU-111/112).
//  · Límites de descuento y umbrales del daño óptico: dueño y superadmin (HU-16, HU-123).
//  · Lo que deben las aseguradoras: dueño y encargados (HU-114).
import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { money } from "./adminOrders.js";
import {
  createMethod,
  createTerminal,
  fetchPosSettings,
  listClaims,
  listMethods,
  methodName,
  posContext,
  savePosSettings,
  setClaim,
  updateMethod,
  updateTerminal,
} from "./posApi.js";

const KINDS = ["cash", "debit", "credit", "zelle", "insurance", "other"];

function Terminals({ ctx, onChanged }) {
  const { t } = useLang();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const run = async (fn) => { setBusy(true); try { await fn(); onChanged(); } catch (e) { toast({ tone: "error", title: t(e.message) }); } finally { setBusy(false); } };
  const manageable = ctx.stores.filter(() => ctx.is_admin || ctx.role === "manager");
  return (
    <div className="adm-card">
      <h3>{t("adm.pos.cfg.terminals")}</h3>
      <p className="adm-sub">{t("adm.pos.cfg.terminalsSub")}</p>
      {manageable.map((s) => (
        <div key={s.id} className="pos-cfg-store">
          <b>{s.code} · {s.name}</b>
          <ul className="pos-cfg-list">
            {s.terminals.map((x) => (
              <li key={x.id}>
                <code>{x.code}</code>
                <input defaultValue={x.name || ""} placeholder={t("adm.pos.cfg.terminalName")} aria-label={t("adm.pos.cfg.terminalName")}
                  onBlur={(e) => e.target.value !== (x.name || "") && run(() => updateTerminal(x.id, { name: e.target.value }))} />
                <label>{t("adm.pos.cfg.receiptLang")}
                  <select value={x.receipt_locale} disabled={busy} onChange={(e) => run(() => updateTerminal(x.id, { receipt_locale: e.target.value }))}>
                    <option value="es">ES</option><option value="en">EN</option>
                  </select>
                </label>
                <label>{t("adm.pos.cfg.ticketLang")}
                  <select value={x.ticket_locale} disabled={busy} onChange={(e) => run(() => updateTerminal(x.id, { ticket_locale: e.target.value }))}>
                    <option value="en">EN</option><option value="es">ES</option>
                  </select>
                </label>
                {s.terminals.length > 1 && <button type="button" className="btn-xs warn" disabled={busy} onClick={() => run(() => updateTerminal(x.id, { is_active: false }))}>{t("adm.pos.cfg.deactivate")}</button>}
              </li>
            ))}
          </ul>
          <button type="button" className="btn-xs" disabled={busy} onClick={() => run(() => createTerminal({ store: s.id }))}><Icon name="plus" size={12} /> {t("adm.pos.cfg.addTerminal")}</button>
        </div>
      ))}
    </div>
  );
}

function Methods({ stores, canEditStores }) {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ label: "", label_en: "", kind: "other", fee_pct: "", fee_fixed: "", counts_as_cash: false, receivable: false, fields: [] });
  const load = () => listMethods().then((r) => setList(r.payment_methods || [])).catch((e) => toast({ tone: "error", title: t(e.message) }));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const run = async (fn) => { setBusy(true); try { const r = await fn(); setList(r.payment_methods || []); toast({ tone: "success", title: t("adm.pos.cfg.saved") }); } catch (e) { toast({ tone: "error", title: t(e.message) }); } finally { setBusy(false); } };
  const toggleStore = (m, id) => {
    const cur = m.establishment_ids || [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    run(() => updateMethod(m.id, { establishment_ids: next.length ? next : null }));
  };
  const add = (e) => {
    e.preventDefault();
    run(() => createMethod({
      label: form.label, label_en: form.label_en, kind: form.kind, fee_pct: form.fee_pct || 0, fee_fixed: form.fee_fixed || 0,
      counts_as_cash: form.counts_as_cash, receivable: form.receivable,
      reference_fields: form.fields.filter((f) => f.label.trim()),
    })).then(() => setForm({ label: "", label_en: "", kind: "other", fee_pct: "", fee_fixed: "", counts_as_cash: false, receivable: false, fields: [] }));
  };
  return (
    <div className="adm-card">
      <h3>{t("adm.pos.cfg.methods")}</h3>
      <p className="adm-sub">{t("adm.pos.cfg.methodsSub")}</p>
      <table className="adm-table responsive">
        <thead><tr><th>{t("adm.pos.pay.method")}</th><th>{t("adm.pos.cfg.fee")}</th><th>{t("adm.pos.cfg.stores")}</th><th>{t("adm.pos.cfg.active")}</th></tr></thead>
        <tbody>
          {list.map((m) => (
            <tr key={m.id} className={m.is_active ? "" : "muted"}>
              <td data-label={t("adm.pos.pay.method")}><b>{methodName(m, t, lang)}</b>{m.counts_as_cash ? <small className="muted"> · {t("adm.pos.cfg.cash")}</small> : null}{m.kind === "insurance" || m.receivable ? <small className="muted"> · {t("adm.pos.cfg.receivable")}</small> : null}</td>
              <td data-label={t("adm.pos.cfg.fee")} className="pos-fee">
                <input inputMode="decimal" defaultValue={m.fee_pct || ""} placeholder="%" aria-label={t("adm.pos.cfg.feePct")} onBlur={(e) => Number(e.target.value || 0) !== m.fee_pct && run(() => updateMethod(m.id, { fee_pct: e.target.value || 0 }))} />
                <input inputMode="decimal" defaultValue={m.fee_fixed_cents ? m.fee_fixed_cents / 100 : ""} placeholder="$" aria-label={t("adm.pos.cfg.feeFixed")} onBlur={(e) => Math.round(Number(e.target.value || 0) * 100) !== m.fee_fixed_cents && run(() => updateMethod(m.id, { fee_fixed: e.target.value || 0 }))} />
              </td>
              <td data-label={t("adm.pos.cfg.stores")} className="pos-cfg-stores">
                {stores.map((s) => (
                  <label key={s.id}><input type="checkbox" disabled={busy || !canEditStores} checked={!m.establishment_ids || m.establishment_ids.includes(s.id)} onChange={() => toggleStore({ ...m, establishment_ids: m.establishment_ids || stores.map((x) => x.id) }, s.id)} /> {s.code}</label>
                ))}
              </td>
              <td data-label={t("adm.pos.cfg.active")}><input type="checkbox" disabled={busy} checked={m.is_active} onChange={(e) => run(() => updateMethod(m.id, { is_active: e.target.checked }))} aria-label={t("adm.pos.cfg.active")} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="pos-cfg-add" onSubmit={add}>
        <h4>{t("adm.pos.cfg.addMethod")}</h4>
        <input required value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder={t("adm.pos.cfg.labelEs")} aria-label={t("adm.pos.cfg.labelEs")} />
        <input value={form.label_en} onChange={(e) => setForm((f) => ({ ...f, label_en: e.target.value }))} placeholder={t("adm.pos.cfg.labelEn")} aria-label={t("adm.pos.cfg.labelEn")} />
        <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))} aria-label={t("adm.pos.cfg.kind")} title={t("adm.pos.cfg.kind")}>
          {KINDS.map((k) => <option key={k} value={k}>{t(`adm.pos.cfg.kind.${k}`)}</option>)}
        </select>
        <input inputMode="decimal" value={form.fee_pct} onChange={(e) => setForm((f) => ({ ...f, fee_pct: e.target.value }))} placeholder={t("adm.pos.cfg.feePct")} aria-label={t("adm.pos.cfg.feePct")} />
        <input inputMode="decimal" value={form.fee_fixed} onChange={(e) => setForm((f) => ({ ...f, fee_fixed: e.target.value }))} placeholder={t("adm.pos.cfg.feeFixed")} aria-label={t("adm.pos.cfg.feeFixed")} />
        <label className="pos-check"><input type="checkbox" checked={form.counts_as_cash} onChange={(e) => setForm((f) => ({ ...f, counts_as_cash: e.target.checked }))} /> {t("adm.pos.cfg.cash")}</label>
        <label className="pos-check"><input type="checkbox" checked={form.receivable} onChange={(e) => setForm((f) => ({ ...f, receivable: e.target.checked }))} /> {t("adm.pos.cfg.receivable")}</label>
        <div className="pos-cfg-fields">
          <small className="muted">{t("adm.pos.cfg.refFields")}</small>
          {form.fields.map((fl, i) => (
            <div key={i} className="pos-row">
              <input value={fl.label} onChange={(e) => setForm((f) => ({ ...f, fields: f.fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))} placeholder={t("adm.pos.cfg.labelEs")} aria-label={t("adm.pos.cfg.labelEs")} />
              <input value={fl.label_en} onChange={(e) => setForm((f) => ({ ...f, fields: f.fields.map((x, j) => (j === i ? { ...x, label_en: e.target.value } : x)) }))} placeholder={t("adm.pos.cfg.labelEn")} aria-label={t("adm.pos.cfg.labelEn")} />
              <label className="pos-check"><input type="checkbox" checked={fl.required} onChange={(e) => setForm((f) => ({ ...f, fields: f.fields.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)) }))} /> {t("adm.pos.cfg.required")}</label>
            </div>
          ))}
          {form.fields.length < 6 && <button type="button" className="btn-xs" onClick={() => setForm((f) => ({ ...f, fields: [...f.fields, { label: "", label_en: "", required: false }] }))}><Icon name="plus" size={12} /> {t("adm.pos.cfg.addField")}</button>}
        </div>
        <button className="btn-sm primary" disabled={busy}>{t("adm.pos.cfg.addMethod")}</button>
      </form>
    </div>
  );
}

function Limits() {
  const { t } = useLang();
  const { toast } = useFeedback();
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetchPosSettings().then((r) => setS(r.settings)).catch((e) => toast({ tone: "error", title: t(e.message) })); }, [t, toast]);
  if (!s) return null;
  const save = async () => {
    setBusy(true);
    try { const r = await savePosSettings({ discount_limits: s.discount_limits, optical_thresholds: s.optical_thresholds }); setS(r.settings); toast({ tone: "success", title: t("adm.pos.cfg.saved") }); }
    catch (e) { toast({ tone: "error", title: t(e.message) }); } finally { setBusy(false); }
  };
  const setL = (k) => (e) => setS((x) => ({ ...x, discount_limits: { ...x.discount_limits, [k]: e.target.value } }));
  const setT = (k) => (e) => setS((x) => ({ ...x, optical_thresholds: { ...x.optical_thresholds, [k]: e.target.value } }));
  return (
    <div className="adm-card">
      <h3>{t("adm.pos.cfg.limits")}</h3>
      <p className="adm-sub">{t("adm.pos.cfg.limitsSub")}</p>
      <div className="pos-form">
        {["seller", "manager", "supervisor"].map((r) => (
          <label key={r}>{t(`adm.team.role.${r}`)} (%)<input type="number" min="0" max="50" step="0.5" value={s.discount_limits[r]} onChange={setL(r)} /></label>
        ))}
      </div>
      <h3>{t("adm.pos.cfg.thresholds")}</h3>
      <p className="adm-sub">{t("adm.pos.cfg.thresholdsSub")}</p>
      <div className="pos-form">
        {["se", "cyl", "add", "axis", "axisMinCyl"].map((k) => (
          <label key={k}>{t(`adm.pos.cfg.th.${k}`)}<input type="number" min="0" step={k === "axis" ? "1" : "0.25"} value={s.optical_thresholds[k]} onChange={setT(k)} /></label>
        ))}
      </div>
      <button type="button" className="btn-sm primary" disabled={busy} onClick={save}><Icon name="save" size={14} /> {t("adm.pos.cfg.save")}</button>
    </div>
  );
}

function Claims({ stores }) {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const [status, setStatus] = useState("pending");
  const [data, setData] = useState({ claims: [], owed: 0 });
  const load = () => listClaims({ status }).then(setData).catch((e) => toast({ tone: "error", title: t(e.message) }));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);
  const mark = async (c, st) => { try { await setClaim(c.id, st); load(); } catch (e) { toast({ tone: "error", title: t(e.message) }); } };
  const code = (id) => stores.find((s) => s.id === id)?.code || "…";
  return (
    <div className="adm-card">
      <div className="adm-head-row">
        <h3>{t("adm.pos.claims.title")}</h3>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("adm.pos.sales.status")} title={t("adm.pos.sales.status")}>
          {["pending", "submitted", "paid", "rejected"].map((s) => <option key={s} value={s}>{t(`adm.pos.claims.status.${s}`)}</option>)}
        </select>
      </div>
      <p className="adm-sub">{t("adm.pos.claims.owed", { v: money(data.owed, "usd", lang) })}</p>
      <table className="adm-table responsive">
        <thead><tr><th>{t("adm.pos.store")}</th><th>{t("adm.pos.claims.payer")}</th><th>{t("adm.pos.claims.member")}</th><th>{t("adm.pos.claims.covered")}</th><th /></tr></thead>
        <tbody>
          {data.claims.map((c) => (
            <tr key={c.id}>
              <td data-label={t("adm.pos.store")}>{code(c.establishment_id)}</td>
              <td data-label={t("adm.pos.claims.payer")}>{c.payer_name}</td>
              <td data-label={t("adm.pos.claims.member")}>{c.member_id || "—"}{c.authorization_no ? ` · ${c.authorization_no}` : ""}</td>
              <td data-label={t("adm.pos.claims.covered")}>{money(c.covered, "usd", lang)}</td>
              <td>
                {(c.status === "pending" || c.status === "submitted") && (
                  <span className="pos-actions">
                    {c.status === "pending" && <button type="button" className="btn-xs" onClick={() => mark(c, "submitted")}>{t("adm.pos.claims.submit")}</button>}
                    <button type="button" className="btn-xs primary" onClick={() => mark(c, "paid")}>{t("adm.pos.claims.paid")}</button>
                    <button type="button" className="btn-xs warn" onClick={() => mark(c, "rejected")}>{t("adm.pos.claims.reject")}</button>
                  </span>
                )}
              </td>
            </tr>
          ))}
          {data.claims.length === 0 && <tr><td colSpan="5" className="full"><div className="adm-nodata">{t("adm.pos.claims.empty")}</div></td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default function PosConfig() {
  const { t } = useLang();
  const [ctx, setCtx] = useState(null);
  const [n, setN] = useState(0);
  useEffect(() => { posContext().then(setCtx).catch(() => setCtx(null)); }, [n]);
  if (!ctx) return <div className="adm-section"><div className="adm-src-note loading">{t("adm.ord.loading")}</div></div>;
  const admin = ctx.is_admin;
  const manager = ctx.role === "manager";
  const payments = admin || (ctx.privileges || []).includes("payments.manage");
  return (
    <div className="adm-section pos">
      <div className="adm-head-row"><h2>{t("adm.tab.posconfig")}</h2></div>
      {(admin || manager) && <Terminals ctx={ctx} onChanged={() => setN((x) => x + 1)} />}
      {/* Las tiendas donde se acepta solo las cambia quien las ve todas: con el
          privilegio solo se ven las propias y se quitaría sin querer de las demás. */}
      {payments && <Methods stores={ctx.stores} canEditStores={admin} />}
      {admin && <Limits />}
      {(admin || manager) && <Claims stores={ctx.stores} />}
    </div>
  );
}

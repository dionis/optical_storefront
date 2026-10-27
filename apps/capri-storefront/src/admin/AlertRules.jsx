// Dónde se usa: pestaña «Alertas» de /admin (dueño, superadmin y supervisor).
// Cada regla dice qué evento avisa, de qué tiendas, a qué direcciones de email
// (las que escribe quien la crea o edita: no hay destinatarios ocultos) y con
// qué frecuencia (solo dueño o superadmin). Debajo, el historial de envíos (HU-44).
import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { adminFetch } from "./adminApi.js";
import { fetchTeam } from "./adminTeam.js";
import { posContext } from "./posApi.js";

const EVENTS = ["sale.created", "discount.applied", "discount.requested", "sale.below_min", "sale.voided", "cash.diff", "store.idle", "digest"];
const MODES = ["immediate", "every_n_hours", "daily", "weekly"];
const EMPTY = { name: "", event: "sale.created", recipients: "", establishment_ids: [], conditions: {}, mode: "immediate", schedule: {}, locale: "es", is_active: true };
const errKey = (e) => (e?.reason ? `adm.err.pos.${e.reason}` : "adm.err.pos.generic");

function RuleForm({ initial, stores, canSchedule, suggestions, onSave, onCancel }) {
  const { t } = useLang();
  const [f, setF] = useState(() => ({ ...EMPTY, ...initial, recipients: (initial?.recipients || []).join(", "), establishment_ids: initial?.establishment_ids || [], conditions: initial?.conditions || {}, schedule: initial?.schedule || {} }));
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const cond = (k, v) => setF((x) => ({ ...x, conditions: { ...x.conditions, [k]: v } }));
  const sch = (k, v) => setF((x) => ({ ...x, schedule: { ...x.schedule, [k]: v } }));
  const addRecipient = (email) => setF((x) => ({ ...x, recipients: x.recipients.split(/[,;\s]+/).filter(Boolean).includes(email) ? x.recipients : [x.recipients, email].filter(Boolean).join(", ") }));
  const submit = (e) => {
    e.preventDefault();
    onSave({ ...f, recipients: f.recipients.split(/[,;\s]+/).filter(Boolean) });
  };
  return (
    <form className="adm-card alr-form" onSubmit={submit}>
      <div className="pos-form">
        <label>{t("adm.alerts.name")}<input required value={f.name} onChange={(e) => set("name", e.target.value)} /></label>
        <label>{t("adm.alerts.event")}
          <select value={f.event} onChange={(e) => set("event", e.target.value)}>
            {EVENTS.map((ev) => <option key={ev} value={ev}>{t(`adm.alerts.ev.${ev}`)}</option>)}
          </select>
        </label>
        {f.event === "sale.created" && <label>{t("adm.alerts.minTotal")}<input type="number" min="0" step="1" value={f.conditions.min_total ?? ""} onChange={(e) => cond("min_total", e.target.value)} /></label>}
        {f.event === "discount.applied" && <label>{t("adm.alerts.minPct")}<input type="number" min="0" max="100" step="1" value={f.conditions.min_discount_pct ?? ""} onChange={(e) => cond("min_discount_pct", e.target.value)} /></label>}
        {f.event === "store.idle" && <label>{t("adm.alerts.idleAfter")}<input type="time" value={f.conditions.idle_after ?? "14:00"} onChange={(e) => cond("idle_after", e.target.value)} /></label>}
        <label>{t("adm.alerts.locale")}
          <select value={f.locale} onChange={(e) => set("locale", e.target.value)}><option value="es">Español</option><option value="en">English</option></select>
        </label>
      </div>
      <label className="alr-recipients">{t("adm.alerts.recipients")}
        <textarea rows={2} required value={f.recipients} onChange={(e) => set("recipients", e.target.value)} placeholder="dueno@ejemplo.com, encargado@ejemplo.com" />
      </label>
      {suggestions.length > 0 && (
        <div className="alr-suggest">
          <small className="muted">{t("adm.alerts.suggest")}</small>
          {suggestions.map((s) => <button type="button" key={s.email} className="btn-xs" onClick={() => addRecipient(s.email)}>{s.label}</button>)}
        </div>
      )}
      <fieldset className="alr-stores">
        <legend>{t("adm.alerts.stores")}</legend>
        {stores.map((s) => (
          <label key={s.id}><input type="checkbox" checked={f.establishment_ids.includes(s.id)} onChange={() => set("establishment_ids", f.establishment_ids.includes(s.id) ? f.establishment_ids.filter((x) => x !== s.id) : [...f.establishment_ids, s.id])} /> {s.code}</label>
        ))}
        <small className="muted">{t("adm.alerts.storesHint")}</small>
        {["sale.created", "digest"].includes(f.event) && (
          <label><input type="checkbox" checked={Boolean(f.conditions.include_web)} onChange={(e) => cond("include_web", e.target.checked)} /> {t("adm.alerts.includeWeb")}</label>
        )}
      </fieldset>
      {canSchedule && f.event !== "discount.requested" && (
        <div className="pos-form">
          <label>{t("adm.alerts.mode")}
            <select value={f.mode} onChange={(e) => set("mode", e.target.value)}>
              {MODES.filter((m) => !(["digest", "store.idle"].includes(f.event) && m === "immediate")).map((m) => <option key={m} value={m}>{t(`adm.alerts.mode.${m}`)}</option>)}
            </select>
          </label>
          {f.mode === "every_n_hours" && <label>{t("adm.alerts.hours")}<input type="number" min="1" max="12" value={f.schedule.hours ?? 3} onChange={(e) => sch("hours", Number(e.target.value))} /></label>}
          {(f.mode === "daily" || f.mode === "weekly") && <label>{t("adm.alerts.at")}<input type="time" value={f.schedule.at ?? "20:00"} onChange={(e) => sch("at", e.target.value)} /></label>}
          {f.mode === "weekly" && (
            <label>{t("adm.alerts.weekday")}
              <select value={f.schedule.weekday ?? 1} onChange={(e) => sch("weekday", Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => <option key={d} value={d}>{t(`adm.dow.${d}`)}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      {!canSchedule && <small className="muted">{t("adm.alerts.noSchedule")}</small>}
      <label className="pos-check"><input type="checkbox" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} /> {t("adm.alerts.active")}</label>
      <div className="pos-actions">
        <button className="btn-sm primary"><Icon name="save" size={14} /> {t("adm.alerts.save")}</button>
        <button type="button" className="btn-sm" onClick={onCancel}>{t("adm.alerts.cancel")}</button>
      </div>
    </form>
  );
}

export default function AlertRules() {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const [rules, setRules] = useState([]);
  const [canSchedule, setCanSchedule] = useState(false);
  const [stores, setStores] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [editing, setEditing] = useState(null); // "new" | rule id
  const [deliveries, setDeliveries] = useState([]);
  const [state, setState] = useState("loading");

  const load = () => {
    setState("loading");
    Promise.all([adminFetch("/admin/sales-alerts/rules"), adminFetch("/admin/sales-alerts/deliveries")])
      .then(([r, d]) => { setRules(r.rules || []); setCanSchedule(Boolean(r.can_schedule)); setDeliveries(d.deliveries || []); setState("ok"); })
      .catch(() => setState("error"));
  };
  useEffect(() => {
    load();
    posContext().then((c) => setStores(c.stores || [])).catch(() => {});
    // Sugerencias: el email de avisos de cada persona del equipo (o su login); se guarda la dirección, no la persona.
    fetchTeam()
      .then((r) => setSuggestions((r.team || []).map((m) => ({ email: m.email, label: m.seller_code || [m.first_name, m.last_name].filter(Boolean).join(" ") || m.email }))))
      .catch(() => setSuggestions([]));
  }, []);

  const save = async (rule) => {
    try {
      await adminFetch(editing === "new" ? "/admin/sales-alerts/rules" : `/admin/sales-alerts/rules/${encodeURIComponent(editing)}`, { method: "POST", body: rule });
      toast({ tone: "success", title: t("adm.alerts.saved") });
      setEditing(null);
      load();
    } catch (e) { toast({ tone: "error", title: t(errKey(e)) }); }
  };
  const ruleName = (id) => rules.find((r) => r.id === id)?.name || "…";
  const freq = (r) => r.mode === "immediate" ? t("adm.alerts.mode.immediate")
    : r.mode === "every_n_hours" ? t("adm.alerts.everyN", { n: r.schedule?.hours ?? 1 })
    : r.mode === "daily" ? t("adm.alerts.dailyAt", { at: r.schedule?.at ?? "20:00" })
    : t("adm.alerts.weeklyAt", { day: t(`adm.dow.${r.schedule?.weekday ?? 1}`), at: r.schedule?.at ?? "20:00" });

  return (
    <div className="adm-section pos">
      <div className="adm-head-row">
        <h2>{t("adm.tab.alerts")}</h2>
        <button type="button" className="btn-sm primary" onClick={() => setEditing("new")}><Icon name="plus" size={14} /> {t("adm.alerts.new")}</button>
      </div>
      <p className="adm-sub">{t("adm.alerts.sub")}</p>
      {state === "error" && <div className="adm-demo-banner">{t("adm.err.pos.generic")}</div>}
      {editing === "new" && <RuleForm stores={stores} canSchedule={canSchedule} suggestions={suggestions} onSave={save} onCancel={() => setEditing(null)} />}
      <div className="adm-card">
        <table className="adm-table responsive">
          <thead><tr><th>{t("adm.alerts.name")}</th><th>{t("adm.alerts.event")}</th><th>{t("adm.alerts.recipients")}</th><th>{t("adm.alerts.mode")}</th><th /></tr></thead>
          <tbody>
            {rules.map((r) => (
              editing === r.id ? (
                <tr key={r.id}><td colSpan="5" className="full"><RuleForm initial={r} stores={stores} canSchedule={canSchedule} suggestions={suggestions} onSave={save} onCancel={() => setEditing(null)} /></td></tr>
              ) : (
                <tr key={r.id} className={r.is_active ? "" : "muted"}>
                  <td data-label={t("adm.alerts.name")}><b>{r.name}</b>{r.establishment_ids?.length ? <small className="muted"> · {r.establishment_ids.map((id) => stores.find((s) => s.id === id)?.code || "…").join(", ")}</small> : null}</td>
                  <td data-label={t("adm.alerts.event")}>{t(`adm.alerts.ev.${r.event}`)}</td>
                  <td data-label={t("adm.alerts.recipients")}><small>{r.recipients.join(", ")}</small></td>
                  <td data-label={t("adm.alerts.mode")}>{freq(r)}</td>
                  <td><button type="button" className="btn-xs" onClick={() => setEditing(r.id)}><Icon name="edit" size={12} /> {t("adm.alerts.edit")}</button></td>
                </tr>
              )
            ))}
            {state === "ok" && rules.length === 0 && <tr><td colSpan="5" className="full"><div className="adm-nodata">{t("adm.alerts.empty")}</div></td></tr>}
          </tbody>
        </table>
      </div>
      <div className="adm-card">
        <h3>{t("adm.alerts.history")}</h3>
        <table className="adm-table responsive">
          <thead><tr><th>{t("adm.audit.when")}</th><th>{t("adm.alerts.name")}</th><th>{t("adm.alerts.to")}</th><th>{t("adm.pos.sales.status")}</th></tr></thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.id}>
                <td data-label={t("adm.audit.when")}>{new Date(d.sent_at || d.created_at).toLocaleString(lang === "en" ? "en-US" : "es-US", { dateStyle: "short", timeStyle: "short" })}</td>
                <td data-label={t("adm.alerts.name")}>{ruleName(d.rule_id)} <small className="muted">· {t(`adm.alerts.ev.${d.event}`)}{d.payload?.number ? ` ${d.payload.number}` : ""}</small></td>
                <td data-label={t("adm.alerts.to")}>{d.recipient_email}</td>
                <td data-label={t("adm.pos.sales.status")}><span className={`pos-appr ${d.status === "sent" ? "approved" : d.status === "failed" ? "rejected" : "pending"}`} title={d.error || undefined}>{t(`adm.alerts.st.${d.status}`)}</span></td>
              </tr>
            ))}
            {state === "ok" && deliveries.length === 0 && <tr><td colSpan="4" className="full"><div className="adm-nodata">{t("adm.alerts.noHistory")}</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

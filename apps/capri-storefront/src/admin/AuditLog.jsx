// Dónde se usa: pestaña «Auditoría» de /admin (dueño y superadmin): quién cambió
// precios, roles, privilegios, descuentos, anulaciones… (HU-72). Solo lectura.
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { adminFetch } from "./adminApi.js";
import { fetchTeam } from "./adminTeam.js";
import { fetchStores } from "./adminStores.js";
import { isDemoLogin } from "./adminAuth.js";
import Icon from "./icons.jsx";

const fmtWhen = (v, lang) =>
  new Date(v).toLocaleString(lang === "en" ? "en-US" : "es-ES", { dateStyle: "short", timeStyle: "short" });

/** Valores crudos (números, códigos, ids) en una línea; nunca prosa del servidor. */
const compact = (v) => {
  if (v === null || v === undefined) return "—";
  if (typeof v !== "object") return String(v);
  return Object.entries(v)
    .map(([k, x]) => `${k}: ${x === null ? "—" : typeof x === "object" ? JSON.stringify(x) : x}`)
    .join(" · ");
};

export default function AuditLog() {
  const { t, lang } = useLang();
  const demo = isDemoLogin();
  const [events, setEvents] = useState([]);
  const [actions, setActions] = useState([]);
  const [action, setAction] = useState("");
  const [state, setState] = useState(demo ? "demo" : "loading");
  const [people, setPeople] = useState({});
  const [stores, setStores] = useState({});

  useEffect(() => {
    if (demo) return;
    fetchTeam().then((r) => setPeople(Object.fromEntries((r.team || []).map((m) => [m.id, m])))).catch(() => {});
    fetchStores().then((r) => setStores(Object.fromEntries((r.establishments || []).map((s) => [s.id, s.code])))).catch(() => {});
  }, [demo]);

  useEffect(() => {
    if (demo) return undefined;
    let on = true;
    setState("loading");
    adminFetch(`/admin/audit${action ? `?action=${encodeURIComponent(action)}` : ""}`)
      .then((r) => { if (on) { setEvents(r.events || []); setActions(r.actions || []); setState("ok"); } })
      .catch(() => on && setState("error"));
    return () => { on = false; };
  }, [action, demo]);

  const who = useMemo(() => (id) => {
    const m = people[id];
    if (!m) return id ? "…" : t("adm.audit.system");
    return m.seller_code || [m.first_name, m.last_name].filter(Boolean).join(" ") || m.email;
  }, [people, t]);

  return (
    <div className="adm-section">
      <div className="adm-head-row">
        <h2>{t("adm.tab.audit")}</h2>
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label={t("adm.audit.filter")} title={t("adm.audit.filter")}>
          <option value="">{t("adm.audit.all")}</option>
          {actions.map((a) => <option key={a} value={a}>{t(`adm.audit.action.${a}`)}</option>)}
        </select>
      </div>
      <p className="adm-sub">{t("adm.audit.sub")}</p>
      {demo && <div className="adm-demo-banner">{t("adm.team.demoNote")}</div>}
      {state === "error" && <div className="adm-demo-banner">{t("adm.err.audit.loadFailed")}</div>}
      <div className="adm-card">
        {state === "loading" && <div className="adm-src-note loading">{t("adm.ord.loading")}</div>}
        <table className="adm-table responsive">
          <thead>
            <tr>
              <th>{t("adm.audit.when")}</th>
              <th>{t("adm.audit.who")}</th>
              <th>{t("adm.audit.what")}</th>
              <th>{t("adm.audit.store")}</th>
              <th>{t("adm.audit.before")}</th>
              <th>{t("adm.audit.after")}</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td data-label={t("adm.audit.when")}>{fmtWhen(e.created_at, lang)}</td>
                <td data-label={t("adm.audit.who")}>{who(e.actor_user_id)}</td>
                <td data-label={t("adm.audit.what")}>
                  <b>{t(`adm.audit.action.${e.action}`)}</b>
                  {e.entity_id && <small className="muted"> · {people[e.entity_id]?.email || e.entity_id}</small>}
                </td>
                <td data-label={t("adm.audit.store")}>{e.establishment_id ? stores[e.establishment_id] || "…" : "—"}</td>
                <td data-label={t("adm.audit.before")}><code className="adm-audit-val">{compact(e.before)}</code></td>
                <td data-label={t("adm.audit.after")}><code className="adm-audit-val">{compact(e.after)}</code></td>
              </tr>
            ))}
            {state === "ok" && events.length === 0 && (
              <tr><td colSpan="6" className="full"><div className="adm-empty"><Icon name="history" size={32} /><b>{t("adm.audit.empty")}</b></div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

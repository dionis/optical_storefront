// Dónde se usa: pestaña «Auditoría» de /admin (dueño y superadmin): quién cambió
// precios, roles, privilegios, descuentos, anulaciones… (HU-72). Solo lectura.
// La tienda la fija el filtro global del panel (StoreFilter → ?store=) y los
// eventos se agrupan en un acordeón por tipo de acción, con su conteo.
import { useEffect, useMemo, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { adminFetch } from "./adminApi.js";
import { fetchTeam } from "./adminTeam.js";
import { fetchStores } from "./adminStores.js";
import { isDemoLogin } from "./adminAuth.js";
import Icon from "./icons.jsx";
import Accordion, { AccordionGroup } from "./Accordion.jsx";
import StoreFilter, { useStoreFilter } from "./StoreFilter.jsx";
import "./screens.css";

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

/** Props: `me` (GET /admin/team/me) para el filtro de tienda. */
export default function AuditLog({ me }) {
  const { t, lang } = useLang();
  const demo = isDemoLogin();
  const [events, setEvents] = useState([]);
  const [actions, setActions] = useState([]);
  const [action, setAction] = useState("");
  const [state, setState] = useState(demo ? "demo" : "loading");
  const [people, setPeople] = useState({});
  const [stores, setStores] = useState({});
  const { storeId, isAll, isWeb } = useStoreFilter(me);
  // La tienda online no genera eventos de tienda: con ella elegida se enseñan todos.
  const storeParam = isAll || isWeb ? "" : storeId;

  useEffect(() => {
    if (demo) return;
    fetchTeam().then((r) => setPeople(Object.fromEntries((r.team || []).map((m) => [m.id, m])))).catch(() => {});
    fetchStores().then((r) => setStores(Object.fromEntries((r.establishments || []).map((s) => [s.id, s.code])))).catch(() => {});
  }, [demo]);

  useEffect(() => {
    if (demo) return undefined;
    let on = true;
    setState("loading");
    const q = new URLSearchParams();
    if (action) q.set("action", action);
    if (storeParam) q.set("store", storeParam);
    const qs = q.toString();
    adminFetch(`/admin/audit${qs ? `?${qs}` : ""}`)
      .then((r) => { if (on) { setEvents(r.events || []); setActions(r.actions || []); setState("ok"); } })
      .catch(() => on && setState("error"));
    return () => { on = false; };
  }, [action, storeParam, demo]);

  const who = useMemo(() => (id) => {
    const m = people[id];
    if (!m) return id ? "…" : t("adm.audit.system");
    return m.seller_code || [m.first_name, m.last_name].filter(Boolean).join(" ") || m.email;
  }, [people, t]);

  // Un grupo por acción, el más reciente primero (los eventos ya vienen ordenados por fecha).
  const groups = useMemo(() => {
    const map = new Map();
    for (const e of events) {
      if (!map.has(e.action)) map.set(e.action, []);
      map.get(e.action).push(e);
    }
    return [...map.entries()];
  }, [events]);

  const table = (list) => (
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
        {list.map((e) => (
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
      </tbody>
    </table>
  );

  return (
    <div className="adm-section">
      <div className="adm-head-row">
        <h2>{t("adm.tab.audit")}</h2>
        <div className="scr-tools">
          <StoreFilter me={me} />
          <select value={action} onChange={(e) => setAction(e.target.value)} aria-label={t("adm.audit.filter")} title={t("adm.audit.filter")}>
            <option value="">{t("adm.audit.all")}</option>
            {actions.map((a) => <option key={a} value={a}>{t(`adm.audit.action.${a}`)}</option>)}
          </select>
        </div>
      </div>
      <p className="adm-sub">{t("adm.audit.sub")}</p>
      {demo && <div className="adm-demo-banner">{t("adm.team.demoNote")}</div>}
      {state === "error" && <div className="adm-demo-banner">{t("adm.err.audit.loadFailed")}</div>}
      {state === "loading" && <div className="adm-src-note loading">{t("adm.ord.loading")}</div>}
      {state === "ok" && events.length === 0 && (
        <div className="adm-card"><div className="adm-empty"><Icon name="history" size={32} /><b>{t("adm.audit.empty")}</b></div></div>
      )}
      <AccordionGroup>
        {groups.map(([a, list], i) => (
          <Accordion key={a} id={`audit-${a}`} icon="history" title={t(`adm.audit.action.${a}`)} badge={list.length} defaultOpen={i === 0 || groups.length === 1} bodyClassName="scr-acc-table"
            summary={[{ label: t("adm.scr.events"), value: list.length, strong: true }, { label: t("adm.audit.when"), value: fmtWhen(list[0].created_at, lang), tone: "muted" }]}>
            {table(list)}
          </Accordion>
        ))}
      </AccordionGroup>
    </div>
  );
}

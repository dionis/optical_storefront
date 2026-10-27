// Dónde se usa: pestaña «Aprobaciones» de /admin (dueño y superadmin). Los
// descuentos fuera de límite o bajo el precio mínimo esperan aquí; el email del
// aviso trae ?tab=approvals&approval=<id> para decidir desde el móvil (HU-26).
import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { money } from "./adminOrders.js";
import { fetchStores } from "./adminStores.js";
import { fetchTeam } from "./adminTeam.js";
import { decideApproval, listApprovals } from "./posApi.js";

export default function PosApprovals({ params = {} }) {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const [status, setStatus] = useState("pending");
  const [rows, setRows] = useState([]);
  const [state, setState] = useState("loading");
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState("");
  const [stores, setStores] = useState({});
  const [people, setPeople] = useState({});
  const focus = params.approval || (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("approval") : null);

  useEffect(() => {
    fetchStores().then((r) => setStores(Object.fromEntries((r.establishments || []).map((s) => [s.id, s])))).catch(() => {});
    fetchTeam().then((r) => setPeople(Object.fromEntries((r.team || []).map((m) => [m.id, m])))).catch(() => {});
  }, []);
  const load = () => {
    setState("loading");
    listApprovals(status).then((r) => { setRows(r.approvals || []); setState("ok"); }).catch(() => setState("error"));
  };
  useEffect(load, [status]);

  const decide = async (a, decision) => {
    setBusy(a.id);
    try {
      await decideApproval(a.id, decision, notes[a.id] || null);
      toast({ tone: "success", title: t(decision === "approved" ? "adm.pos.approvals.approvedToast" : "adm.pos.approvals.rejectedToast") });
      load();
    } catch (e) { toast({ tone: "error", title: t(e.message) }); } finally { setBusy(""); }
  };
  const who = (id) => people[id]?.seller_code || [people[id]?.first_name, people[id]?.last_name].filter(Boolean).join(" ") || people[id]?.email || "…";
  const m = (v) => money(v, "usd", lang);

  return (
    <div className="adm-section pos">
      <div className="adm-head-row">
        <h2>{t("adm.tab.approvals")}</h2>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("adm.pos.sales.status")} title={t("adm.pos.sales.status")}>
          {["pending", "approved", "rejected", "used", "expired"].map((s) => <option key={s} value={s}>{t(`adm.pos.approval.status.${s}`)}</option>)}
        </select>
      </div>
      <p className="adm-sub">{t("adm.pos.approvals.sub")}</p>
      {state === "error" && <div className="adm-demo-banner">{t("adm.err.pos.generic")}</div>}
      {state === "loading" && <div className="adm-src-note loading">{t("adm.ord.loading")}</div>}
      <div className="pos-approvals">
        {rows.map((a) => (
          <div key={a.id} className={`adm-card pos-appr-card ${a.id === focus ? "focus" : ""}`}>
            <div className="pos-appr-top">
              <b>{stores[a.establishment_id]?.code || "…"} · {stores[a.establishment_id]?.name || ""}</b>
              <span className={`pos-appr ${a.status}`}>{t(`adm.pos.approval.status.${a.status}`)}</span>
            </div>
            <div className="pos-appr-big">{a.discount_pct} %</div>
            <dl className="pos-totals">
              <dt>{t("adm.pos.approvals.seller")}</dt><dd>{who(a.requested_by)}</dd>
              <dt>{t("adm.pos.approvals.limit")}</dt><dd>{a.limit_pct == null ? t("adm.pos.price.noLimit") : `${a.limit_pct} %`}</dd>
              <dt>{t("adm.pos.price.listTotal")}</dt><dd>{m(a.list)}</dd>
              <dt>{t("adm.pos.approvals.total")}</dt><dd><b>{m(a.total)}</b></dd>
            </dl>
            {a.below_minimum && <div className="adm-demo-banner">{t("adm.pos.approval.belowMin")}</div>}
            <ul className="pos-appr-lines">{a.lines.map((l, i) => <li key={i}>{l.title || t("adm.pos.own.tag")} · {m(l.list)}</li>)}</ul>
            {a.reason && <p><i>“{a.reason}”</i></p>}
            <small className="muted">{new Date(a.created_at).toLocaleString(lang === "en" ? "en-US" : "es-US")} · {t("adm.pos.approvals.expires", { date: new Date(a.expires_at).toLocaleString(lang === "en" ? "en-US" : "es-US") })}</small>
            {a.status === "pending" && (
              <div className="pos-appr-actions">
                <input value={notes[a.id] || ""} onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))} placeholder={t("adm.pos.approvals.note")} aria-label={t("adm.pos.approvals.note")} />
                <button type="button" className="btn-sm primary" disabled={busy === a.id} onClick={() => decide(a, "approved")}><Icon name="check" size={14} /> {t("adm.pos.approvals.approve")}</button>
                <button type="button" className="btn-sm warn" disabled={busy === a.id} onClick={() => decide(a, "rejected")}><Icon name="close" size={14} /> {t("adm.pos.approvals.reject")}</button>
              </div>
            )}
            {a.decision_note && <small className="muted">{t("adm.pos.approvals.decisionNote")}: {a.decision_note}</small>}
          </div>
        ))}
        {state === "ok" && rows.length === 0 && <div className="adm-empty"><Icon name="checkCircle" size={32} /><b>{t("adm.pos.approvals.empty")}</b></div>}
      </div>
    </div>
  );
}

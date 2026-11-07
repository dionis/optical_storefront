// Dónde se usa: pestaña «Aprobaciones» de /admin (dueño y superadmin). Los
// descuentos fuera de límite o bajo el precio mínimo esperan aquí; el email del
// aviso trae ?tab=approvals&approval=<id> para decidir desde el móvil (HU-26).
// Dos acordeones: las pendientes de decidir (abierto) y las ya decididas. La
// tienda la fija el filtro global del panel (StoreFilter) y se aplica aquí
// sobre `establishment_id`; el servidor ya acota por rol.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import Icon from "./icons.jsx";
import { money } from "./adminOrders.js";
import { fetchStores } from "./adminStores.js";
import { fetchTeam } from "./adminTeam.js";
import { decideApproval, listApprovals } from "./posApi.js";
import Accordion, { AccordionGroup } from "./Accordion.jsx";
import StoreFilter, { useStoreFilter } from "./StoreFilter.jsx";
import "./screens.css";

const DECIDED = ["approved", "rejected", "used", "expired"];

/** Props: `params` (navegación, `approval` a resaltar) y `me` (GET /admin/team/me) para el filtro de tienda. */
export default function PosApprovals({ params = {}, me }) {
  const { t, lang } = useLang();
  const { toast } = useFeedback();
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState([]);
  const [state, setState] = useState("loading");
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState("");
  const [stores, setStores] = useState({});
  const [people, setPeople] = useState({});
  const { storeId, isAll, isWeb } = useStoreFilter(me);
  const focus = params.approval || (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("approval") : null);

  useEffect(() => {
    fetchStores().then((r) => setStores(Object.fromEntries((r.establishments || []).map((s) => [s.id, s])))).catch(() => {});
    fetchTeam().then((r) => setPeople(Object.fromEntries((r.team || []).map((m) => [m.id, m])))).catch(() => {});
  }, []);
  // Las pendientes siempre completas; de las decididas, las últimas (el servidor devuelve las más recientes).
  // Solo la última petición pinta: al cambiar de estado deprisa (o releer tras decidir), la respuesta lenta de la anterior se descarta.
  const loadSeq = useRef(0);
  const load = () => {
    const seq = ++loadSeq.current;
    setState("loading");
    Promise.all([listApprovals("pending"), listApprovals(status || undefined)])
      .then(([p, d]) => {
        if (seq !== loadSeq.current) return;
        const seen = new Set();
        const all = [...(p.approvals || []), ...(d.approvals || [])].filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
        setRows(all); setState("ok");
      })
      .catch(() => { if (seq === loadSeq.current) setState("error"); });
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

  // La tienda online no pide descuentos: con ella elegida se enseñan todas.
  const visible = useMemo(() => (isAll || isWeb ? rows : rows.filter((a) => a.establishment_id === storeId)), [rows, storeId, isAll, isWeb]);
  const pending = visible.filter((a) => a.status === "pending");
  const decided = visible.filter((a) => a.status !== "pending" && (!status || a.status === status));
  const oldest = pending.length ? pending.reduce((o, a) => (a.created_at < o.created_at ? a : o)) : null;
  const sum = (list) => list.reduce((s, a) => s + (Number(a.total) || 0), 0);
  const fmtWhen = (v) => new Date(v).toLocaleString(lang === "en" ? "en-US" : "es-US");

  const card = (a) => (
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
      <small className="muted">{fmtWhen(a.created_at)} · {t("adm.pos.approvals.expires", { date: fmtWhen(a.expires_at) })}</small>
      {a.status === "pending" && (
        <div className="pos-appr-actions">
          <input value={notes[a.id] || ""} onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))} placeholder={t("adm.pos.approvals.note")} aria-label={t("adm.pos.approvals.note")} />
          <button type="button" className="btn-sm primary" disabled={busy === a.id} onClick={() => decide(a, "approved")}><Icon name="check" size={14} /> {t("adm.pos.approvals.approve")}</button>
          <button type="button" className="btn-sm warn" disabled={busy === a.id} onClick={() => decide(a, "rejected")}><Icon name="close" size={14} /> {t("adm.pos.approvals.reject")}</button>
        </div>
      )}
      {a.decision_note && <small className="muted">{t("adm.pos.approvals.decisionNote")}: {a.decision_note}</small>}
    </div>
  );

  const statusSelect = (
    <select className="scr-inline-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("adm.pos.sales.status")} title={t("adm.pos.sales.status")}>
      <option value="">{t("adm.scr.decidedAll")}</option>
      {DECIDED.map((s) => <option key={s} value={s}>{t(`adm.pos.approval.status.${s}`)}</option>)}
    </select>
  );

  return (
    <div className="adm-section pos">
      <div className="adm-head-row">
        <h2>{t("adm.tab.approvals")}</h2>
        <StoreFilter me={me} />
      </div>
      <p className="adm-sub">{t("adm.pos.approvals.sub")}</p>
      {state === "error" && <div className="adm-demo-banner">{t("adm.err.pos.generic")}</div>}
      {state === "loading" && <div className="adm-src-note loading">{t("adm.ord.loading")}</div>}
      <AccordionGroup>
        <Accordion id="appr-pending" icon="hand" title={t("adm.scr.pending")} badge={pending.length} defaultOpen open={focus && pending.some((a) => a.id === focus) ? true : undefined} bodyClassName="scr-acc-cards"
          summary={[
            { label: t("adm.scr.count"), value: pending.length, tone: pending.length ? "warn" : "muted" },
            { label: t("adm.scr.total"), value: m(sum(pending)), strong: pending.length > 0 },
            oldest ? { label: t("adm.scr.oldest"), value: fmtWhen(oldest.created_at), tone: "muted" } : null,
          ]}>
          <div className="pos-approvals">
            {pending.map(card)}
            {state === "ok" && pending.length === 0 && <div className="adm-empty"><Icon name="checkCircle" size={32} /><b>{t("adm.pos.approvals.empty")}</b></div>}
          </div>
        </Accordion>
        <Accordion id="appr-decided" icon="history" title={t("adm.scr.decided")} badge={decided.length} right={statusSelect} open={focus && decided.some((a) => a.id === focus) ? true : undefined} bodyClassName="scr-acc-cards"
          summary={DECIDED.map((s) => { const n = visible.filter((a) => a.status === s).length; return n ? { label: t(`adm.pos.approval.status.${s}`), value: n, tone: s === "approved" || s === "used" ? "good" : s === "rejected" ? "bad" : "muted" } : null; })}>
          <div className="pos-approvals">
            {decided.map(card)}
            {state === "ok" && decided.length === 0 && <div className="adm-nodata">{t("adm.pos.approvals.empty")}</div>}
          </div>
        </Accordion>
      </AccordionGroup>
    </div>
  );
}

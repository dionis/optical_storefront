// Dónde se usa: pestaña Equipo de /admin — alta de administradores con contraseña temporal de un solo primer uso; el super admin no puede eliminarse.
import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { isDemoLogin } from "./adminAuth.js";
import { shortDate } from "./adminOrders.js";
import { fetchTeam, createAdmin, deleteAdmin } from "./adminTeam.js";

/**
 * EQUIPO — administradores del panel.
 *  · El SUPER ADMIN (el dueño, el usuario más antiguo) lleva sello y NO tiene
 *    botón de borrar: el sistema jamás se queda sin su administrador raíz.
 *  · Crear un admin pide email + contraseña TEMPORAL abierta: el nuevo admin
 *    entra con ella UNA vez y el panel le exige poner la suya antes de ver
 *    nada (candado must_change_password, ver AdminPage).
 *  · Nadie puede borrarse a sí mismo (lo veta también el backend).
 */
export default function Team() {
  const { t, lang } = useLang();
  const { toast, confirm } = useFeedback();
  const demo = isDemoLogin();
  const [team, setTeam] = useState([]);
  const [meId, setMeId] = useState(null);
  const [state, setState] = useState(demo ? "demo" : "loading");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", firstName: "", lastName: "" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const load = () => {
    if (demo) return;
    setState("loading");
    fetchTeam()
      .then((r) => { setTeam(r.team || []); setMeId(r.me || null); setState("ok"); })
      .catch(() => setState("error"));
  };
  useEffect(load, [demo]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const r = await createAdmin(form);
      setTeam(r.team || []);
      setForm({ email: "", password: "", firstName: "", lastName: "" });
      toast({ tone: "success", title: t("adm.team.created"), message: t("adm.team.createdSub") });
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
    } finally { setBusy(false); }
  };

  const remove = async (m) => {
    const ok = await confirm({
      tone: "danger",
      title: t("adm.team.deleteConfirm", { email: m.email }),
      message: t("adm.team.deleteBody"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await deleteAdmin(m.id);
      setTeam(r.team || []);
      toast({ tone: "success", title: t("adm.team.deleted", { email: m.email }) });
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
    } finally { setBusy(false); }
  };

  return (
    <div className="adm-section">
      <div className="adm-head-row"><h2>{t("adm.team.title")}</h2></div>
      {demo && <div className="adm-demo-banner">{t("adm.team.demoNote")}</div>}
      {state === "error" && <div className="adm-demo-banner">{t("adm.err.team.loadFailed")}</div>}

      {/* Alta de un nuevo administrador */}
      <div className="adm-card">
        <h3>{t("adm.team.newTitle")}</h3>
        <p className="adm-sub">{t("adm.team.newSub")}</p>
        <form className="adm-team-form" onSubmit={submit}>
          <input type="email" required placeholder={t("adm.team.email")} value={form.email} onChange={set("email")} autoComplete="off" />
          <input type="text" required minLength={8} placeholder={t("adm.team.tempPass")} value={form.password} onChange={set("password")} autoComplete="off" />
          <input placeholder={t("adm.team.firstName")} value={form.firstName} onChange={set("firstName")} />
          <input placeholder={t("adm.team.lastName")} value={form.lastName} onChange={set("lastName")} />
          <button className="btn-sm primary" disabled={demo || busy}>{busy ? "…" : t("adm.team.create")}</button>
        </form>
      </div>

      {/* Lista del equipo */}
      <div className="adm-card">
        <h3>{t("adm.team.listTitle", { n: team.length })}</h3>
        {state === "loading" && <div className="adm-src-note loading">{t("adm.ord.loading")}</div>}
        <div className="adm-team-rows">
          {team.map((m) => (
            <div key={m.id} className={`adm-team-row ${m.is_super ? "super" : ""}`}>
              <span className="adm-team-avatar">{(m.first_name || m.email)[0].toUpperCase()}</span>
              <span className="adm-team-main">
                <b>{[m.first_name, m.last_name].filter(Boolean).join(" ") || m.email}</b>
                <small className="muted">{m.email} · {shortDate(m.created_at, lang)}</small>
              </span>
              {m.is_super && <span className="adm-team-tag super">★ {t("adm.team.super")}</span>}
              {m.id === meId && <span className="adm-team-tag me">{t("adm.team.you")}</span>}
              {m.must_change_password && <span className="adm-team-tag temp">{t("adm.team.tempTag")}</span>}
              {!m.is_super && m.id !== meId && (
                <button className="btn-xs warn" disabled={busy || demo} onClick={() => remove(m)}>
                  {t("adm.team.delete")}
                </button>
              )}
            </div>
          ))}
          {state === "ok" && team.length === 0 && <div className="adm-nodata">{t("adm.chart.noData")}</div>}
        </div>
        <p className="adm-sub adm-team-note">{t("adm.team.superNote")}</p>
      </div>
    </div>
  );
}

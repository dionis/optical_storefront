// Dónde se usa: pestaña Equipo de /admin — alta de usuarios con contraseña temporal de un solo primer uso y su rol; el dueño no puede eliminarse ni cambiar de rol.
import { useEffect, useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { isDemoLogin } from "./adminAuth.js";
import { shortDate } from "./adminOrders.js";
import { fetchTeam, createAdmin, deleteAdmin, setRole, setStores, ASSIGNABLE_ROLES, roleKey } from "./adminTeam.js";
import { fetchStores } from "./adminStores.js";

const isAdminRole = (role) => role === "owner" || role === "superadmin";

/**
 * Tiendas de una persona: "Todas" o una lista. Un desplegable con casillas; se
 * guarda al cerrar, no en cada clic, para no reescribir sus filas por casilla.
 */
function StorePicker({ member, stores, disabled, onSave }) {
  const { t } = useLang();
  const current = member.establishment_ids || [];
  const [picked, setPicked] = useState(current);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!open) setPicked(member.establishment_ids || []); }, [member.establishment_ids, open]);

  const active = stores.filter((s) => s.is_active || current.includes(s.id));
  const label = current.length === 0
    ? t("adm.team.storesAll")
    : current.map((id) => stores.find((s) => s.id === id)?.code || "?").join(", ");
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const close = () => {
    setOpen(false);
    const same = picked.length === current.length && picked.every((id) => current.includes(id));
    if (!same) onSave(picked);
  };

  return (
    <details className="adm-team-stores" open={open} onToggle={(e) => (e.currentTarget.open ? setOpen(true) : close())}>
      <summary className="adm-team-role" aria-label={t("adm.team.stores")} title={t("adm.team.stores")}>
        <Icon name="store" size={12} /> {label}
      </summary>
      <div className="adm-team-stores-menu">
        {active.length === 0 && <small className="muted">{t("adm.team.storesNone")}</small>}
        {active.map((s) => (
          <label key={s.id}>
            <input type="checkbox" disabled={disabled} checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
            <b>{s.code}</b> {s.name}
          </label>
        ))}
        <small className="muted">{t("adm.team.storesHint")}</small>
      </div>
    </details>
  );
}

/**
 * EQUIPO — personas que usan el panel y su rol.
 *  · El DUEÑO (el usuario más antiguo) lleva sello y NO tiene botón de borrar
 *    ni selector de rol: el sistema jamás se queda sin su administrador raíz.
 *  · Crear un usuario pide email + contraseña TEMPORAL abierta + rol: entra con
 *    ella UNA vez y el panel le exige poner la suya antes de ver nada (candado
 *    must_change_password, ver AdminPage).
 *  · Solo el dueño nombra o quita superadmins; nadie cambia su propio rol ni se
 *    borra a sí mismo. El panel solo ofrece lo que el backend aceptaría, pero la
 *    regla vive allí (lib/staff-roles.ts) y es la que manda.
 */
export default function Team() {
  const { t, lang } = useLang();
  const { toast, confirm } = useFeedback();
  const demo = isDemoLogin();
  const [team, setTeam] = useState([]);
  const [meId, setMeId] = useState(null);
  const [state, setState] = useState(demo ? "demo" : "loading");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", firstName: "", lastName: "", role: "" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const myRole = team.find((m) => m.id === meId)?.role ?? null;
  const iAmOwner = myRole === "owner";
  // Roles que puedo dar: el superadmin solo puede darlo el dueño.
  const grantable = ASSIGNABLE_ROLES.filter((r) => iAmOwner || r !== "superadmin");
  const newRole = form.role || grantable[0];
  const canEditRole = (m) => !m.is_super && m.id !== meId && (iAmOwner || m.role !== "superadmin");

  const [stores, setStoreList] = useState([]);

  const load = () => {
    if (demo) return;
    setState("loading");
    fetchTeam()
      .then((r) => { setTeam(r.team || []); setMeId(r.me || null); setState("ok"); })
      .catch(() => setState("error"));
    // Sin tiendas (o sin backend de tiendas aún) el selector simplemente no aparece.
    fetchStores().then((r) => setStoreList(r.establishments || [])).catch(() => setStoreList([]));
  };
  useEffect(load, [demo]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const r = await createAdmin({ ...form, role: newRole });
      setTeam(r.team || []);
      setForm({ email: "", password: "", firstName: "", lastName: "", role: "" });
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

  const changeStores = async (m, ids) => {
    setBusy(true);
    try {
      const r = await setStores(m.id, ids);
      setTeam(r.team || []);
      toast({ tone: "success", title: t("adm.team.storesSaved", { email: m.email }) });
    } catch (err) {
      toast({ tone: "error", title: t(err.message) });
    } finally { setBusy(false); }
  };

  const changeRole = async (m, role) => {
    if (role === m.role) return;
    setBusy(true);
    try {
      const r = await setRole(m.id, role);
      setTeam(r.team || []);
      toast({ tone: "success", title: t("adm.team.roleChanged", { email: m.email, role: t(roleKey(role)) }) });
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
          <select aria-label={t("adm.team.role")} title={t("adm.team.role")} value={newRole} onChange={set("role")}>
            {grantable.map((r) => <option key={r} value={r}>{t(roleKey(r))}</option>)}
          </select>
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
              {m.is_super && <span className="adm-team-tag super"><Icon name="sparkles" size={12} /> {t("adm.team.super")}</span>}
              {m.id === meId && <span className="adm-team-tag me">{t("adm.team.you")}</span>}
              {m.must_change_password && <span className="adm-team-tag temp">{t("adm.team.tempTag")}</span>}
              {m.role_legacy && <span className="adm-team-tag legacy" title={t("adm.team.roleLegacy")}>{t("adm.team.roleLegacyTag")}</span>}
              {canEditRole(m) ? (
                <select className="adm-team-role" aria-label={t("adm.team.role")} title={t("adm.team.role")}
                  value={m.role ?? ""} disabled={busy || demo} onChange={(e) => changeRole(m, e.target.value)}>
                  {m.role == null && <option value="" disabled>{t(roleKey(null))}</option>}
                  {grantable.map((r) => <option key={r} value={r}>{t(roleKey(r))}</option>)}
                </select>
              ) : (
                !m.is_super && <span className="adm-team-role-label">{t(roleKey(m.role))}</span>
              )}
              {m.role && !isAdminRole(m.role) && stores.length > 0 && (
                <StorePicker member={m} stores={stores} disabled={busy || demo} onSave={(ids) => changeStores(m, ids)} />
              )}
              {!m.is_super && m.id !== meId && (iAmOwner || m.role !== "superadmin") && (
                <button className="btn-xs warn" disabled={busy || demo} onClick={() => remove(m)}>
                  {t("adm.team.delete")}
                </button>
              )}
            </div>
          ))}
          {state === "ok" && team.length === 0 && <div className="adm-nodata">{t("adm.chart.noData")}</div>}
        </div>
        <p className="adm-sub adm-team-note">{t("adm.team.superNote")}</p>
        <p className="adm-sub">{t("adm.team.roleNote")}</p>
      </div>
    </div>
  );
}

// Dónde se usa: /admin — envoltorio del panel corporativo: login (fondo navy de marca), gate de primera contraseña y montaje del dashboard.
import { TENANT } from "../config/tenant.js";
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { authenticate, verifyOtp, getSession, logout } from "../admin/adminAuth.js";
import { isDemoLogin } from "../admin/adminAuth.js";
import { fetchMe, changeOwnPassword, roleKey } from "../admin/adminTeam.js";
import { fetchBackendFeatures } from "../admin/backendFeatures.js";
import { useLang } from "../i18n/LanguageContext.jsx";
import AdminDashboard from "../admin/AdminDashboard.jsx";
import "../admin/admin.css";

function Login({ onOk }) {
  const { t } = useLang();
  // adminAuth returns dictionary keys, never prose — it has no language hook of
  // its own. Anything that is not a key falls through unchanged.
  const errText = (key) => (key ? t(key) : "");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [otp, setOtp] = useState("");
  const [stage, setStage] = useState("creds"); // 'creds' | 'otp'
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submitCreds = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await authenticate(user, pass);
    setBusy(false);
    if (r.ok && r.twofa) setStage("otp");       // 2FA active → ask for the code
    else if (r.ok) onOk();
    else setErr(r.error || "adm.err.generic");
  };
  const submitOtp = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await verifyOtp(otp);
    setBusy(false);
    if (r.ok) onOk(); else setErr(r.error || "adm.err.badCode");
  };

  return (
    <div className="adm-login">
      {stage === "creds" ? (
        <form className="adm-login-card" onSubmit={submitCreds}>
          <img src={TENANT.logo} alt={TENANT.name} className="adm-login-logo" />
          <h1>{t("adm.title")}</h1>
          <p className="muted">{t("adm.login.sub")}</p>
          <label>{t("adm.login.email")}<input type="email" autoFocus value={user} placeholder={t("adm.login.emailPh")} onChange={(e) => setUser(e.target.value)} autoComplete="username" /></label>
          <label>{t("adm.login.pass")}<input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" /></label>
          {err && <div className="adm-login-err">{errText(err)}</div>}
          <button className="btn btn-primary big" disabled={busy}>{busy ? t("adm.login.checking") : t("adm.login.submit")}</button>
          <Link to="/" className="adm-back">{t("adm.login.back")}</Link>
        </form>
      ) : (
        <form className="adm-login-card" onSubmit={submitOtp}>
          <img src={TENANT.logo} alt={TENANT.name} className="adm-login-logo" />
          <h1>{t("adm.login.mfaTitle")}</h1>
          <p className="muted">{t("adm.login.mfaSub")}</p>
          <label>{t("adm.login.code")}<input inputMode="numeric" autoFocus value={otp} placeholder="••••••" onChange={(e) => setOtp(e.target.value)} autoComplete="one-time-code" /></label>
          {err && <div className="adm-login-err">{errText(err)}</div>}
          <button className="btn btn-primary big" disabled={busy}>{busy ? t("adm.login.checking") : t("adm.login.verify")}</button>
          <button type="button" className="adm-back" onClick={() => { setStage("creds"); setErr(""); setOtp(""); }}>{t("adm.login.otherAccount")}</button>
        </form>
      )}
    </div>
  );
}

/**
 * CANDADO de primer acceso: un admin dado de alta con contraseña TEMPORAL
 * (metadata must_change_password en el backend) no ve el dashboard hasta
 * poner la suya. Exige la temporal como "contraseña actual" para que un
 * panel abierto en otro equipo no baste para apropiarse de la cuenta.
 */
function FirstPasswordGate({ onDone }) {
  const { t } = useLang();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (next.length < 8) { setErr("adm.err.team.weak_password"); return; }
    if (next !== again) { setErr("adm.team.gate.mismatch"); return; }
    setBusy(true);
    try {
      await changeOwnPassword({ currentPassword: current, newPassword: next });
      onDone();
    } catch (error) {
      setErr(error.message || "adm.err.team.passwordFailed");
    } finally { setBusy(false); }
  };

  return (
    <div className="adm-login">
      <form className="adm-login-card" onSubmit={submit}>
        <img src={TENANT.logo} alt={TENANT.name} className="adm-login-logo" />
        <h1>{t("adm.team.gate.title")}</h1>
        <p className="muted">{t("adm.team.gate.sub")}</p>
        <label>{t("adm.team.gate.current")}<input type="password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></label>
        <label>{t("adm.team.gate.new")}<input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></label>
        <label>{t("adm.team.gate.again")}<input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" /></label>
        {err && <div className="adm-login-err">{t(err)}</div>}
        <button className="btn btn-primary big" disabled={busy}>{busy ? t("adm.login.checking") : t("adm.team.gate.save")}</button>
      </form>
    </div>
  );
}

/**
 * Cuenta sin pantallas: su rol no es dueño ni superadmin. El backend ya le
 * niega todo el API de administración (lib/staff-guard.ts); esto solo evita
 * pintarle un panel que respondería con errores en cada pestaña. Cuando llegue
 * el punto de venta, aquí se montan sus pantallas.
 */
function RestrictedHome({ role, onLogout }) {
  const { t } = useLang();
  return (
    <div className="adm-login">
      <div className="adm-login-card">
        <img src={TENANT.logo} alt={TENANT.name} className="adm-login-logo" />
        <h1>{t("adm.restricted.title")}</h1>
        <p className="muted">{role ? t("adm.restricted.sub", { role: t(roleKey(role)) }) : t("adm.restricted.inactive")}</p>
        <button className="btn btn-primary big" onClick={onLogout}>{t("adm.restricted.logout")}</button>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [session, setSession] = useState(() => getSession());
  // null = comprobando · false = contraseña propia · true = temporal pendiente
  const [mustChange, setMustChange] = useState(null);
  // Rol del usuario; null mientras no se sepa o si la API aún no lo devuelve.
  const [me, setMe] = useState(null);
  // What the backend supports (admin/backendFeatures.js); null while asking, so the
  // panel never flashes tabs the backend cannot serve.
  const [features, setFeatures] = useState(null);

  useEffect(() => {
    if (!session) return undefined;
    let on = true;
    fetchBackendFeatures().then((f) => { if (on) setFeatures(f); });
    return () => { on = false; };
  }, [session]);

  useEffect(() => {
    if (!session) return undefined;
    if (isDemoLogin()) { setMustChange(false); return undefined; }
    let on = true;
    fetchMe()
      .then((r) => { if (on) { setMe(r || null); setMustChange(Boolean(r && r.must_change_password)); } })
      .catch(() => { if (on) setMustChange(false); }); // la API puede no estar desplegada aún
    return () => { on = false; };
  }, [session]);

  const signOut = () => { logout(); setSession(null); setMe(null); };

  if (!session) return <Login onOk={() => { setMustChange(null); setSession(getSession()); }} />;
  if (mustChange === null || features === null) return <div className="adm-login"><div className="adm-login-card"><p className="muted">…</p></div></div>;
  if (mustChange) return <FirstPasswordGate onDone={() => setMustChange(false)} />;
  // `is_admin` ausente = backend anterior a los roles: se comporta como antes.
  // Sin rol activo no hay nada que ver; con rol, el panel muestra solo sus pestañas.
  if (me && me.is_admin === false && !me.role) return <RestrictedHome role={me.role} onLogout={signOut} />;
  // El armazón (barra lateral, barra superior, idioma, sesión) vive en
  // AdminShell, montado por AdminDashboard; aquí solo se decide si hay sesión.
  return <AdminDashboard user={session.user} onLogout={signOut} me={me} features={features} />;
}

// Dónde se usa: /admin — envoltorio del panel corporativo: login (fondo navy de marca), gate de primera contraseña y montaje del dashboard.
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { authenticate, verifyOtp, getSession, logout } from "../admin/adminAuth.js";
import { isDemoLogin } from "../admin/adminAuth.js";
import { fetchMe, changeOwnPassword } from "../admin/adminTeam.js";
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
          <img src="/logo-oficial.png" alt="RUBI LENS" className="adm-login-logo" />
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
          <img src="/logo-oficial.png" alt="RUBI LENS" className="adm-login-logo" />
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
        <img src="/logo-oficial.png" alt="RUBI LENS" className="adm-login-logo" />
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

export default function AdminPage() {
  const { t, lang, toggle } = useLang();
  const [session, setSession] = useState(() => getSession());
  // null = comprobando · false = contraseña propia · true = temporal pendiente
  const [mustChange, setMustChange] = useState(null);

  useEffect(() => {
    if (!session) return undefined;
    if (isDemoLogin()) { setMustChange(false); return undefined; }
    let on = true;
    fetchMe()
      .then((me) => { if (on) setMustChange(Boolean(me && me.must_change_password)); })
      .catch(() => { if (on) setMustChange(false); }); // la API puede no estar desplegada aún
    return () => { on = false; };
  }, [session]);

  if (!session) return <Login onOk={() => { setMustChange(null); setSession(getSession()); }} />;
  if (mustChange === null) return <div className="adm-login"><div className="adm-login-card"><p className="muted">…</p></div></div>;
  if (mustChange) return <FirstPasswordGate onDone={() => setMustChange(false)} />;
  return (
    <div className="adm-shell">
      <header className="adm-topbar">
        <div className="adm-brand">
          <img src="/logo-oficial.png" alt="RUBI LENS" />
          <span>{t("adm.title")}</span>
          {/* Sello que DIFERENCIA el panel de la tienda al primer vistazo. */}
          <em className="adm-badge">ADMIN</em>
        </div>
        <div className="adm-user">
          <Link to="/" className="adm-link">{t("adm.viewStore")}</Link>
          <span className="adm-who">👤 {session.user}</span>
          {/* The panel is its own shell — the storefront header (and its language
              toggle) is not on screen here, so the switch has to live in this bar
              or the owner has no way to change language while working. */}
          <button className="btn-sm" onClick={toggle} title={t("lang.switch")}>
            {lang === "es" ? "EN" : "ES"}
          </button>
          <button className="btn-sm" onClick={() => { logout(); setSession(null); }}>{t("adm.logout")}</button>
        </div>
      </header>
      <AdminDashboard />
    </div>
  );
}

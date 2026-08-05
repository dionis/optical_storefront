import { useState } from "react";
import { Link } from "react-router-dom";
import { authenticate, verifyOtp, getSession, logout } from "../admin/adminAuth.js";
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
          <img src="/logo.svg" alt="RUBI_LENS" className="adm-login-logo" />
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
          <img src="/logo.svg" alt="RUBI_LENS" className="adm-login-logo" />
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

export default function AdminPage() {
  const { t, lang, toggle } = useLang();
  const [session, setSession] = useState(() => getSession());
  if (!session) return <Login onOk={() => setSession(getSession())} />;
  return (
    <div className="adm-shell">
      <header className="adm-topbar">
        <div className="adm-brand"><img src="/logo.svg" alt="RUBI_LENS" /><span>{t("adm.title")}</span></div>
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

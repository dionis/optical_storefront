// Dónde se usa: /admin — envoltorio del panel corporativo: login (fondo navy de marca), gate de primera contraseña y montaje del dashboard.
import { TENANT } from "../config/tenant.js";
import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { authenticate, verifyOtp, getSession, logout, requestPasswordReset, completePasswordReset } from "../admin/adminAuth.js";
import { SESSION_EVENT } from "../admin/adminApi.js";
import { isDemoLogin } from "../admin/adminAuth.js";
import { fetchMe, changeOwnPassword, roleKey } from "../admin/adminTeam.js";
import { fetchBackendFeatures } from "../admin/backendFeatures.js";
import { useLang } from "../i18n/LanguageContext.jsx";
import AdminDashboard from "../admin/AdminDashboard.jsx";
import "../admin/admin.css";
import "./admin-auth.css";
import PasswordInput from "../components/PasswordInput.jsx";

// Mismo mínimo que el candado de primera contraseña y que el servidor
// (POST /admin/team/password). No hay regla de contraseña en fieldRules.js.
const PASSWORD_MIN = 8;

function Login({ onOk }) {
  const { t } = useLang();
  // adminAuth returns dictionary keys, never prose — it has no language hook of
  // its own. Anything that is not a key falls through unchanged.
  const errText = (key) => (key ? t(key) : "");
  // The email's reset link lands here as /admin?reset=<token>&email=… (built
  // by the backend subscriber). Read ONCE into state and scrubbed from the URL
  // right away (effect below), so the address bar, the history and a shared
  // screenshot of the «new password» form never carry the token; before, it
  // stayed in the URL until the form was left (QA roles 5-nov-2026).
  const [params, setParams] = useSearchParams();
  const [resetToken] = useState(() => params.get("reset") || "");
  const [resetEmail] = useState(() => params.get("email") || "");
  // The owner's activation mail (src/lib/tenant-bootstrap.ts) lands here as
  // /admin?activate=<email>: the "forgot my password" screen, worded as a first
  // sign-in. It carries no token — the 15-minute link comes by mail on request.
  const [activateEmail] = useState(() => params.get("activate") || "");
  const [user, setUser] = useState(resetEmail || activateEmail);
  const [pass, setPass] = useState("");
  const [otp, setOtp] = useState("");
  // 'creds' | 'otp' | 'forgot' | 'sent' | 'reset'
  const [stage, setStage] = useState(resetToken ? "reset" : activateEmail ? "forgot" : "creds");
  const [activating, setActivating] = useState(Boolean(activateEmail && !resetToken));
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [newPass, setNewPass] = useState("");
  const [again, setAgain] = useState("");

  const clearResetQuery = () => {
    if (!params.has("reset") && !params.has("email") && !params.has("activate")) return;
    const next = new URLSearchParams(params);
    next.delete("reset");
    next.delete("email");
    next.delete("activate");
    setParams(next, { replace: true });
  };
  const goLogin = () => { clearResetQuery(); setActivating(false); setStage("creds"); setErr(""); setPass(""); };
  useEffect(() => { if (resetToken || activateEmail) clearResetQuery(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submitCreds = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(""); setNote("");
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
  const submitForgot = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await requestPasswordReset(user);
    setBusy(false);
    // Same screen whether or not the account exists — never say which.
    if (r.ok) setStage("sent"); else setErr(r.error || "adm.err.generic");
  };
  const submitReset = async (e) => {
    e.preventDefault();
    setErr("");
    if (newPass.length < PASSWORD_MIN) { setErr("adm.err.team.weak_password"); return; }
    if (newPass !== again) { setErr("adm.team.gate.mismatch"); return; }
    setBusy(true);
    const r = await completePasswordReset({ token: resetToken, email: resetEmail, password: newPass });
    setBusy(false);
    if (r.ok) {
      setNewPass(""); setAgain("");
      setNote("adm.auth.resetOk");
      goLogin();
    } else {
      setErr(r.error || "adm.err.generic");
    }
  };

  const logo = <img src={TENANT.logo} alt={TENANT.name} className="adm-login-logo" />;

  return (
    <div className="adm-login">
      {stage === "creds" ? (
        <form className="adm-login-card" onSubmit={submitCreds}>
          {logo}
          <h1>{t("adm.title")}</h1>
          <p className="muted">{t("adm.login.sub")}</p>
          <label>{t("adm.login.email")}<input type="email" autoFocus value={user} placeholder={t("adm.login.emailPh")} onChange={(e) => setUser(e.target.value)} autoComplete="username" /></label>
          <label>{t("adm.login.pass")}<PasswordInput value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" /></label>
          {note && <div className="adm-login-ok" role="status">{t(note)}</div>}
          {err && <div className="adm-login-err">{errText(err)}</div>}
          <button className="btn btn-primary big" disabled={busy}>{busy ? t("adm.login.checking") : t("adm.login.submit")}</button>
          <div className="adm-login-links">
            <button type="button" className="adm-back" onClick={() => { setStage("forgot"); setErr(""); setNote(""); }}>{t("adm.auth.forgot")}</button>
            <Link to="/" className="adm-back">{t("adm.login.back")}</Link>
          </div>
        </form>
      ) : stage === "forgot" ? (
        <form className="adm-login-card" onSubmit={submitForgot}>
          {logo}
          <h1>{t(activating ? "adm.auth.activateTitle" : "adm.auth.forgotTitle")}</h1>
          <p className="muted">{t(activating ? "adm.auth.activateSub" : "adm.auth.forgotSub")}</p>
          <label>{t("adm.login.email")}<input type="email" autoFocus required value={user} placeholder={t("adm.login.emailPh")} onChange={(e) => setUser(e.target.value)} autoComplete="username" /></label>
          {err && <div className="adm-login-err">{errText(err)}</div>}
          <button className="btn btn-primary big" disabled={busy}>{busy ? t("adm.auth.sending") : t("adm.auth.send")}</button>
          <button type="button" className="adm-back" onClick={goLogin}>{t("adm.auth.backToLogin")}</button>
        </form>
      ) : stage === "sent" ? (
        <div className="adm-login-card">
          {logo}
          <h1>{t("adm.auth.sentTitle")}</h1>
          <p className="adm-login-sent" role="status">{t("adm.auth.sent")}</p>
          <button type="button" className="btn btn-primary big" onClick={goLogin}>{t("adm.auth.backToLogin")}</button>
        </div>
      ) : stage === "reset" ? (
        <form className="adm-login-card" onSubmit={submitReset}>
          {logo}
          <h1>{t("adm.auth.resetTitle")}</h1>
          <p className="muted">{t("adm.auth.resetSub", { email: resetEmail })}</p>
          {/* Hidden username so password managers file the new password under the right account. */}
          <input type="email" value={resetEmail} readOnly autoComplete="username" hidden />
          <label>{t("adm.auth.newPass")}<PasswordInput autoFocus value={newPass} minLength={PASSWORD_MIN} onChange={(e) => setNewPass(e.target.value)} autoComplete="new-password" /></label>
          <label>{t("adm.auth.again")}<PasswordInput value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" /></label>
          {err && <div className="adm-login-err">{errText(err)}</div>}
          <button className="btn btn-primary big" disabled={busy}>{busy ? t("adm.auth.saving") : t("adm.auth.save")}</button>
          <div className="adm-login-links">
            {(err === "adm.auth.linkExpired" || err === "adm.auth.badLink") && (
              <button type="button" className="adm-back" onClick={() => { clearResetQuery(); setStage("forgot"); setErr(""); }}>{t("adm.auth.requestNew")}</button>
            )}
            <button type="button" className="adm-back" onClick={goLogin}>{t("adm.auth.backToLogin")}</button>
          </div>
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
        <label>{t("adm.team.gate.current")}<PasswordInput autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></label>
        <label>{t("adm.team.gate.new")}<PasswordInput value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></label>
        <label>{t("adm.team.gate.again")}<PasswordInput value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" /></label>
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
      // A 401 (token revoked or expired) means there is no one to paint a panel
      // for: back to the login. Any other failure keeps the old behaviour (the
      // roles API may not be deployed yet) — without `me` the shell is the full
      // one, which is why the 401 must not fall through here.
      .catch((e) => { if (!on) return; if (e && e.status === 401) { setSession(null); setMe(null); } else setMustChange(false); });
    return () => { on = false; };
  }, [session]);

  // adminApi announces when the session stops being usable: "cleared" after a
  // 401 (storage already empty) and "inactive" after a 403 `inactive`. The
  // "cleared" case waits a moment and re-reads the storage, because a password
  // change of one's own clears the old token and signs in again at once
  // (adminTeam.changeOwnPassword): only a tab left WITHOUT a session goes back
  // to the login. "inactive" re-asks who I am, and the role null that comes
  // back paints the «access deactivated» card instead of a dashboard.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    let timer = null;
    const onSession = (e) => {
      const kind = e?.detail?.kind;
      if (kind === "cleared") {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; if (!getSession()) { setSession(null); setMe(null); } }, 1500);
      } else if (kind === "inactive") {
        fetchMe().then((r) => setMe(r || null)).catch(() => {});
      }
    };
    window.addEventListener(SESSION_EVENT, onSession);
    return () => { window.removeEventListener(SESSION_EVENT, onSession); if (timer) clearTimeout(timer); };
  }, []);

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

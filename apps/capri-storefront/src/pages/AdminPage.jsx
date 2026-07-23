import { useState } from "react";
import { Link } from "react-router-dom";
import { authenticate, verifyOtp, getSession, logout } from "../admin/adminAuth.js";
import AdminDashboard from "../admin/AdminDashboard.jsx";
import "../admin/admin.css";

function Login({ onOk }) {
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
    else setErr(r.error || "Error");
  };
  const submitOtp = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await verifyOtp(otp);
    setBusy(false);
    if (r.ok) onOk(); else setErr(r.error || "Código inválido");
  };

  return (
    <div className="adm-login">
      {stage === "creds" ? (
        <form className="adm-login-card" onSubmit={submitCreds}>
          <img src="/logo.svg" alt="RUBI_LENS" className="adm-login-logo" />
          <h1>Panel corporativo</h1>
          <p className="muted">Acceso restringido — solo personal autorizado.</p>
          <label>Correo electrónico<input type="email" autoFocus value={user} placeholder="tucorreo@ejemplo.com" onChange={(e) => setUser(e.target.value)} autoComplete="username" /></label>
          <label>Contraseña<input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" /></label>
          {err && <div className="adm-login-err">{err}</div>}
          <button className="btn btn-primary big" disabled={busy}>{busy ? "Verificando…" : "Entrar"}</button>
          <Link to="/" className="adm-back">← Volver a la tienda</Link>
        </form>
      ) : (
        <form className="adm-login-card" onSubmit={submitOtp}>
          <img src="/logo.svg" alt="RUBI_LENS" className="adm-login-logo" />
          <h1>Verificación en 2 pasos</h1>
          <p className="muted">Introduce el código de un solo uso enviado a tu dispositivo.</p>
          <label>Código<input inputMode="numeric" autoFocus value={otp} placeholder="••••••" onChange={(e) => setOtp(e.target.value)} autoComplete="one-time-code" /></label>
          {err && <div className="adm-login-err">{err}</div>}
          <button className="btn btn-primary big" disabled={busy}>{busy ? "Verificando…" : "Verificar"}</button>
          <button type="button" className="adm-back" onClick={() => { setStage("creds"); setErr(""); setOtp(""); }}>← Usar otra cuenta</button>
        </form>
      )}
    </div>
  );
}

export default function AdminPage() {
  const [session, setSession] = useState(() => getSession());
  if (!session) return <Login onOk={() => setSession(getSession())} />;
  return (
    <div className="adm-shell">
      <header className="adm-topbar">
        <div className="adm-brand"><img src="/logo.svg" alt="RUBI_LENS" /><span>Panel corporativo</span></div>
        <div className="adm-user">
          <Link to="/" className="adm-link">Ver tienda</Link>
          <span className="adm-who">👤 {session.user}</span>
          <button className="btn-sm" onClick={() => { logout(); setSession(null); }}>Salir</button>
        </div>
      </header>
      <AdminDashboard />
    </div>
  );
}

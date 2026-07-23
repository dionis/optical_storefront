import { useState } from "react";
import { Link } from "react-router-dom";
import { authenticate, getSession, logout, ADMIN_USERNAME } from "../admin/adminAuth.js";
import AdminDashboard from "../admin/AdminDashboard.jsx";
import "../admin/admin.css";

function Login({ onOk }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await authenticate(user, pass);
    setBusy(false);
    if (r.ok) onOk(); else setErr(r.error || "Error");
  };
  return (
    <div className="adm-login">
      <form className="adm-login-card" onSubmit={submit}>
        <img src="/logo.svg" alt="RUBI_LENS" className="adm-login-logo" />
        <h1>Panel corporativo</h1>
        <p className="muted">Acceso restringido — solo personal autorizado.</p>
        <label>Usuario<input autoFocus value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" /></label>
        <label>Contraseña<input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" /></label>
        {err && <div className="adm-login-err">{err}</div>}
        <button className="btn btn-primary big" disabled={busy}>{busy ? "Verificando…" : "Entrar"}</button>
        <Link to="/" className="adm-back">← Volver a la tienda</Link>
      </form>
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
          <span className="adm-who">👤 {ADMIN_USERNAME}</span>
          <button className="btn-sm" onClick={() => { logout(); setSession(null); }}>Salir</button>
        </div>
      </header>
      <AdminDashboard />
    </div>
  );
}

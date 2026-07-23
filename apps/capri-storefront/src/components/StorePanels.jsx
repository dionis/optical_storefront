import { useState } from "react";
import { Link } from "react-router-dom";
import { useCart } from "./CartContext.jsx";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useUser, login, register, logout } from "./userAuth.js";

export function SidePanel({ open, onClose, title, children }) {
  return (
    <>
      {open && <div className="panel-backdrop" onClick={onClose} />}
      <aside className={`side-panel ${open ? "open" : ""}`} role="dialog" aria-label={title}>
        <div className="side-panel-head">
          <h3>{title}</h3>
          <button className="side-close" onClick={onClose} aria-label="×">×</button>
        </div>
        <div className="side-panel-body">{children}</div>
      </aside>
    </>
  );
}

export function CartPanel({ open, onClose }) {
  const { items, removeItem, total, clearCart, checkout } = useCart();
  const { t } = useLang();
  return (
    <SidePanel open={open} onClose={onClose} title={t("cart.title")}>
      {items.length === 0 ? (
        <p className="panel-empty">{t("cart.empty")}</p>
      ) : (
        <>
          <ul className="panel-list">
            {items.map((i) => (
              <li key={i.id} className="panel-item">
                <div className="panel-item-info">
                  <b>{i.name}{i.isCase ? " · " + t("nav.cases") : ""}</b>
                  <small>{[i.color, i.usage, i.index].filter(Boolean).join(" · ")}</small>
                </div>
                <span className="panel-item-price">${(i.total || 0).toFixed(2)}</span>
                <button className="panel-x" onClick={() => removeItem(i.id)} aria-label={t("common.remove")}>×</button>
              </li>
            ))}
          </ul>
          <div className="panel-total"><span>{t("cart.total")}</span><b>${total.toFixed(2)}</b></div>
          <button className="btn btn-primary big" onClick={() => { checkout(); alert(t("cart.done")); onClose(); }}>{t("cart.checkout")}</button>
          <button className="panel-clear" onClick={clearCart}>{t("cart.clear")}</button>
        </>
      )}
    </SidePanel>
  );
}

export function AuthPanel({ open, onClose }) {
  const { t } = useLang();
  const user = useUser();
  const [mode, setMode] = useState("login"); // 'login' | 'register'
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");

  const submit = (e) => {
    e.preventDefault();
    setErr("");
    const r = (mode === "login" ? login : register)(email, pass);
    if (r.ok) { setEmail(""); setPass(""); } else setErr(r.error || "Error");
  };

  return (
    <SidePanel open={open} onClose={onClose} title={user ? t("auth.account") : t("auth.title")}>
      {user ? (
        <div className="auth-signed">
          <div className="auth-avatar">{(user.email[0] || "?").toUpperCase()}</div>
          <p className="auth-hi">{t("auth.hi")},<br /><b>{user.email}</b></p>
          <button className="btn btn-outline big" onClick={() => { logout(); }}>{t("auth.logout")}</button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-tabs">
            <button type="button" className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>{t("auth.login")}</button>
            <button type="button" className={mode === "register" ? "on" : ""} onClick={() => setMode("register")}>{t("auth.register")}</button>
          </div>
          <label>{t("auth.email")}<input type="email" value={email} placeholder="tucorreo@ejemplo.com" autoComplete="email" onChange={(e) => setEmail(e.target.value)} /></label>
          <label>{t("auth.password")}<input type="password" value={pass} autoComplete={mode === "login" ? "current-password" : "new-password"} onChange={(e) => setPass(e.target.value)} /></label>
          {err && <div className="auth-err">{err}</div>}
          <button className="btn btn-primary big" type="submit">{mode === "login" ? t("auth.login") : t("auth.register")}</button>
          <p className="auth-note">{t("auth.note")}</p>
        </form>
      )}
    </SidePanel>
  );
}

export function FavPanel({ open, onClose }) {
  const { favorites, toggleFav, addItem } = useCart();
  const { t } = useLang();
  return (
    <SidePanel open={open} onClose={onClose} title={t("fav.title")}>
      {favorites.length === 0 ? (
        <p className="panel-empty">{t("fav.empty")}</p>
      ) : (
        <ul className="panel-list">
          {favorites.map((f) => (
            <li key={f.slug} className="fav-item">
              <img src={f.image} alt={f.name} onError={(e)=>{e.currentTarget.style.opacity=.25;}} />
              <div className="fav-item-info">
                <Link to={`/producto/${f.slug}`} onClick={onClose}><b>{f.name}</b></Link>
                <small>{f.brand} · ${Number(f.price).toFixed(2)}</small>
                <div className="fav-actions">
                  <button onClick={() => addItem({ sku: f.slug, name: f.name, total: f.price })}>{t("common.addCart")}</button>
                  <button className="link-red" onClick={() => toggleFav(f)}>{t("common.remove")}</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SidePanel>
  );
}

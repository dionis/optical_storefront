import { useState } from "react";
import { Link } from "react-router-dom";
import { useCart } from "./CartContext.jsx";
import { useFeedback } from "./Feedback.jsx";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useUser, login, register, logout } from "./userAuth.js";

const money = (n) => "$" + (Number(n) || 0).toFixed(2);

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
  // Server-side Medusa cart: line items, totals and the checkout flow live on the
  // backend. The panel only lists what the cart returns and routes to /checkout
  // (MedusaCheckout) — contact, shipping and payment happen there.
  const { items, removeItem, total, clearCart, busy, priceChanges, ackPriceChanges } = useCart();
  const { t } = useLang();

  return (
    <SidePanel open={open} onClose={onClose} title={t("cart.title")}>
      {items.length === 0 ? (
        <p className="panel-empty">{t("cart.empty")}</p>
      ) : (
        <>
          {/* El carrito se re-cotiza solo al cargar. Si un precio cambió respecto
              al que el cliente vio al agregarlo, se avisa aquí — no se le pide
              que decida nada, sólo que se entere antes de pagar. */}
          {priceChanges.length > 0 && (
            <div className="panel-repriced" role="status">
              <b>{t("cart.repriced")}</b>
              <ul>
                {priceChanges.map((r) => (
                  <li key={r.item_id}>{r.title} · <s>{money(r.from)}</s> → <b>{money(r.to)}</b></li>
                ))}
              </ul>
              <button className="panel-repriced-x" onClick={ackPriceChanges}>{t("common.gotIt")}</button>
            </div>
          )}
          <ul className="panel-list">
            {items.map((i) => (
              <li key={i.id} className="panel-item">
                {i.thumbnail && <img className="panel-item-thumb" src={i.thumbnail} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                <div className="panel-item-info">
                  <b>{i.title}</b>
                  <small>{[i.metadata?.lens_summary, i.quantity > 1 ? `× ${i.quantity}` : null].filter(Boolean).join(" · ")}</small>
                </div>
                <span className="panel-item-price">{money(i.total)}</span>
                <button className="panel-x" onClick={() => removeItem(i.id)} disabled={busy} aria-label={t("common.remove")}>×</button>
              </li>
            ))}
          </ul>

          <div className="panel-total"><span>{t("cart.total")}</span><b>{money(total)}</b></div>

          <Link to="/checkout" className="btn btn-primary big" onClick={onClose}>{t("cart.checkout")}</Link>
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
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState("");

  const submit = (e) => {
    e.preventDefault();
    setErr("");
    const r = (mode === "login" ? login : register)(email, phone);
    if (r.ok) { setEmail(""); setPhone(""); } else setErr(r.error || "Error");
  };

  return (
    <SidePanel open={open} onClose={onClose} title={user ? t("auth.account") : t("auth.title")}>
      {user ? (
        <div className="auth-signed">
          <div className="auth-avatar">{(user.email[0] || "?").toUpperCase()}</div>
          <p className="auth-hi">{t("auth.hi")},<br /><b>{user.email}</b></p>
          <Link to="/cuenta" className="btn btn-primary big" onClick={onClose}>{t("acc.title")}</Link>
          <button className="btn btn-outline big" onClick={() => { logout(); }}>{t("auth.logout")}</button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-tabs">
            <button type="button" className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>{t("auth.login")}</button>
            <button type="button" className={mode === "register" ? "on" : ""} onClick={() => setMode("register")}>{t("auth.register")}</button>
          </div>
          <label>{t("auth.email")}<input type="email" value={email} placeholder={t("auth.emailPh")} autoComplete="email" onChange={(e) => setEmail(e.target.value)} /></label>
          <label>{t("auth.phone")}<input type="tel" value={phone} placeholder="+1 281 555 0100" autoComplete="tel" onChange={(e) => setPhone(e.target.value)} /></label>
          {err && <div className="auth-err">{err}</div>}
          <button className="btn btn-primary big" type="submit">{mode === "login" ? t("auth.login") : t("auth.register")}</button>
          <p className="auth-note">{t("auth.note")}</p>
        </form>
      )}
    </SidePanel>
  );
}

export function FavPanel({ open, onClose }) {
  const { favorites, toggleFav, addVariant, busy } = useCart();
  const { toast } = useFeedback();
  const { t } = useLang();
  const addFav = async (f) => {
    if (!f.variantId) { toast({ tone: "info", message: t("cart.noVariant") }); return; }
    try { await addVariant(f.variantId); toast({ tone: "success", message: t("common.addCart") }); }
    catch { toast({ tone: "error", message: t("cart.addError") }); }
  };
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
                <small>{f.brand} · {money(f.price)}</small>
                <div className="fav-actions">
                  <button disabled={busy} onClick={() => addFav(f)}>{t("common.addCart")}</button>
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

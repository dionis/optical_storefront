import { useState } from "react";
import { Link } from "react-router-dom";
import { useCart } from "./CartContext.jsx";
import { useCatalog } from "../data/catalogStore.js";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useUser, login, register, logout, setProfile } from "./userAuth.js";
import ShippingEstimator from "./ShippingEstimator.jsx";
import { notifyOrder, orderMailto } from "../data/orderNotify.js";

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
  const { items, removeItem, total, clearCart, checkout } = useCart();
  const { t, lang } = useLang();
  const user = useUser();
  const [ship, setShip] = useState({ method: "pickup", cost: 0 });
  const [err, setErr] = useState("");        // guarda una CLAVE i18n (se renderiza con t())
  const [done, setDone] = useState(null);    // orden confirmada → muestra el comprobante
  const [f, setF] = useState({});
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const isShip = ship.method === "ship";
  const grand = total + (ship.cost || 0);
  const email = user ? user.email : (f.email || "");
  const phone = user ? user.phone : (f.phone || "");

  const doCheckout = () => {
    setErr("");
    if (!f.name || !f.surname) return setErr("co.errName");
    if (!user) { const r = login(email, phone); if (!r.ok) return setErr(r.error); } // r.error = clave i18n
    if (isShip && (!f.dAddress || !f.dCity || !f.dPhone)) return setErr("co.errDelivery");
    try { setProfile({ name: `${f.name} ${f.surname}`.trim() }); } catch {}
    const order = checkout(ship.cost || 0, ship.method, {
      customer: { name: f.name, surname: f.surname, email, phone },
      delivery: isShip ? { recipient: f.dName || `${f.name} ${f.surname}`.trim(), phone: f.dPhone, email: f.dEmail || email, address: f.dAddress, city: f.dCity, zone: ship.zoneName || ship.zoneId, carrier: ship.carrier } : null,
    });
    if (!order) return; // carrito vacío (no debería pasar aquí)
    try { notifyOrder(order, lang); } catch {} // aviso email/SMS (best-effort, ver orderNotify.js)
    setDone(order);      // el admin ya la ve en vivo en su panel; al cliente le mostramos el comprobante
  };

  const closeAll = () => { setDone(null); setF({}); setErr(""); onClose(); };

  return (
    <SidePanel open={open} onClose={done ? closeAll : onClose} title={t("cart.title")}>
      {done ? (
        // ── Comprobante de compra (lo ve el cliente al instante) ──
        <div className="co-done">
          <div className="co-done-emoji">✅</div>
          <h3>{t("cart.done.title")}</h3>
          <p className="muted">{t("cart.done.msg")}</p>
          <div className="co-done-order"><b>{done.id}</b><span>{money(done.total)}</span></div>
          <a className="btn btn-outline big" href={orderMailto(done, lang)}>✉️ {t("cart.done.email")}</a>
          <Link to="/cuenta" className="btn btn-primary big" onClick={closeAll}>{t("cart.done.track")}</Link>
          <button className="panel-clear" onClick={closeAll}>{t("cart.done.close")}</button>
        </div>
      ) : items.length === 0 ? (
        <p className="panel-empty">{t("cart.empty")}</p>
      ) : (
        <>
          <ul className="panel-list">
            {items.map((i) => (
              <li key={i.id} className="panel-item">
                <div className="panel-item-info">
                  <b>{i.name}{i.isCase ? " · " + t("nav.cases") : ""}</b>
                  <small>{[i.color, i.usage, i.index, ...((i.specs || []).map((s) => s.label))].filter(Boolean).join(" · ")}</small>
                </div>
                <span className="panel-item-price">${(i.total || 0).toFixed(2)}</span>
                <button className="panel-x" onClick={() => removeItem(i.id)} aria-label={t("common.remove")}>×</button>
              </li>
            ))}
          </ul>

          <ShippingEstimator subtotal={total} onChange={(s) => setShip(s)} />

          <div className="co-form">
            <div className="co-h">👤 {t("co.buyer")}</div>
            <div className="co-fields">
              <div className="co-two">
                <input placeholder={t("co.name")} value={f.name || ""} onChange={set("name")} autoComplete="given-name" />
                <input placeholder={t("co.surname")} value={f.surname || ""} onChange={set("surname")} autoComplete="family-name" />
              </div>
              {!user && <>
                <input type="email" placeholder={t("auth.email")} value={f.email || ""} onChange={set("email")} autoComplete="email" />
                <input type="tel" placeholder={t("auth.phone")} value={f.phone || ""} onChange={set("phone")} autoComplete="tel" />
              </>}
              {user && <div className="co-note">✓ {user.email} · {user.phone}</div>}
            </div>

            {isShip && (
              <>
                <div className="co-h">🚚 {t("co.delivery")}</div>
                <div className="co-fields">
                  <input placeholder={t("co.dAddress")} value={f.dAddress || ""} onChange={set("dAddress")} autoComplete="street-address" />
                  <input placeholder={t("co.dCity")} value={f.dCity || ""} onChange={set("dCity")} />
                  <div className="co-two">
                    <input placeholder={t("co.dName")} value={f.dName || ""} onChange={set("dName")} />
                    <input type="tel" placeholder={t("co.dPhone")} value={f.dPhone || ""} onChange={set("dPhone")} />
                  </div>
                  <input type="email" placeholder={t("co.dEmail")} value={f.dEmail || ""} onChange={set("dEmail")} />
                </div>
              </>
            )}
          </div>

          <div className="panel-total"><span>{t("cart.total")}</span><b>${grand.toFixed(2)}</b></div>
          {ship.cost > 0 && <div className="co-note">🚚 {t("cart.incShip")}: ${ship.cost.toFixed(2)}</div>}
          {err && <div className="auth-err" style={{ margin: "8px 0" }}>{t(err)}</div>}

          <button className="btn btn-primary big" onClick={doCheckout}>
            {isShip ? "🚚 " : "🏬 "}{t("cart.checkout")} · ${grand.toFixed(2)}
          </button>
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
    if (r.ok) { setEmail(""); setPhone(""); } else setErr(r.error || "auth.err.generic"); // clave i18n
  };

  return (
    <SidePanel open={open} onClose={onClose} title={user ? t("auth.account") : t("auth.title")}>
      {user ? (
        <div className="auth-signed">
          <div className="auth-avatar">{(user.email?.[0] || "?").toUpperCase()}</div>
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
          <label>{t("auth.email")}<input type="email" value={email} placeholder="tucorreo@ejemplo.com" autoComplete="email" onChange={(e) => setEmail(e.target.value)} /></label>
          <label>{t("auth.phone")}<input type="tel" value={phone} placeholder="+1 281 555 0100" autoComplete="tel" onChange={(e) => setPhone(e.target.value)} /></label>
          {err && <div className="auth-err">{t(err)}</div>}
          <button className="btn btn-primary big" type="submit">{mode === "login" ? t("auth.login") : t("auth.register")}</button>
          <p className="auth-note">{t("auth.note")}</p>
        </form>
      )}
    </SidePanel>
  );
}

export function FavPanel({ open, onClose }) {
  const { favorites, toggleFav, addItem } = useCart();
  const { productBySlug } = useCatalog();
  const { t } = useLang();
  return (
    <SidePanel open={open} onClose={onClose} title={t("fav.title")}>
      {favorites.length === 0 ? (
        <p className="panel-empty">{t("fav.empty")}</p>
      ) : (
        <ul className="panel-list">
          {favorites.map((f) => {
            // Precio EN VIVO del catálogo (coincide con la tienda si cambió el precio).
            const live = productBySlug[f.slug];
            const price = live ? live.price : f.price;
            return (
              <li key={f.slug} className="fav-item">
                <img src={f.image} alt={f.name} onError={(e)=>{e.currentTarget.style.opacity=.25;}} />
                <div className="fav-item-info">
                  <Link to={`/producto/${f.slug}`} onClick={onClose}><b>{f.name}</b></Link>
                  <small>{f.brand} · {money(price)}</small>
                  <div className="fav-actions">
                    <button onClick={() => addItem({ sku: f.slug, name: f.name, total: price, brand: f.brand })}>{t("common.addCart")}</button>
                    <button className="link-red" onClick={() => toggleFav(f)}>{t("common.remove")}</button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SidePanel>
  );
}

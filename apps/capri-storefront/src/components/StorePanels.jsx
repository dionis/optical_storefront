import { useState } from "react";
import { Link } from "react-router-dom";
import { useCart } from "./CartContext.jsx";
import { useCatalog } from "../data/catalogStore.js";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useUser, login, register, logout, setProfile, addPrescriptions } from "./userAuth.js";
import { shipping } from "../admin/priceStore.js";
import { L } from "../data/lensPricing.js";
import { notifyOrder, orderMailto } from "../data/orderNotify.js";

const money = (n) => "$" + (Number(n) || 0).toFixed(2);

// ── Tarjeta: utilidades SOLO para validar en el navegador. NUNCA guardamos el
// número completo (PAN); del pago real se encarga el backend con Stripe. Aquí
// únicamente conservamos marca + últimos 4 para el comprobante. ──
const digits = (s) => String(s || "").replace(/\D/g, "");
function luhnOk(num) {
  const d = digits(num);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = +d[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}
function cardBrand(num) {
  const d = digits(num);
  if (/^4/.test(d)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(d)) return "Mastercard";
  if (/^3[47]/.test(d)) return "Amex";
  if (/^6(011|5)/.test(d)) return "Discover";
  return "Tarjeta";
}
const expOk = (s) => {
  const m = String(s || "").match(/^(\d{2})\s*\/\s*(\d{2})$/);
  if (!m) return false;
  const mm = +m[1], yy = +m[2];
  if (mm < 1 || mm > 12) return false;
  const now = new Date();
  const exp = new Date(2000 + yy, mm); // primer día del mes siguiente
  return exp > now;
};

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
  const store = shipping().pickup || {};        // dirección de la tienda (config del admin)
  const [deliver, setDeliver] = useState(false); // false = recoger en tienda, true = a domicilio
  const [pay, setPay] = useState("person");       // "person" (efectivo/tarjeta al recibir) | "card"
  const [mkt, setMkt] = useState(true);           // consentimiento de marketing (datos para promociones)
  const [err, setErr] = useState("");        // guarda una CLAVE i18n (se renderiza con t())
  const [done, setDone] = useState(null);    // orden confirmada → muestra el comprobante
  const [f, setF] = useState({});
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const grand = total; // el costo de envío lo gestiona el admin, no se cobra al cliente aquí
  const email = user ? user.email : (f.email || "");
  const phone = user ? user.phone : (f.phone || "");

  const doCheckout = () => {
    setErr("");
    if (!f.name || !f.surname) return setErr("co.errName");
    if (!user) { const r = login(email, phone); if (!r.ok) return setErr(r.error); } // r.error = clave i18n
    if (deliver && (!f.dAddress || !f.dCity || !f.dPhone)) return setErr("co.errDelivery");

    // Pago con tarjeta: validamos en el navegador SIN guardar el número completo.
    let payment = { method: "person" };
    if (pay === "card") {
      if (!f.cardName || !luhnOk(f.cardNum)) return setErr("co.errCard");
      if (!expOk(f.cardExp)) return setErr("co.errCardExp");
      if (digits(f.cardCvc).length < 3) return setErr("co.errCardCvc");
      const d = digits(f.cardNum);
      payment = { method: "card", brand: cardBrand(f.cardNum), last4: d.slice(-4), pending: true };
    }

    try { setProfile({ name: `${f.name} ${f.surname}`.trim(), marketingOptIn: !!mkt }); } catch {}

    const order = checkout(0, deliver ? "ship" : "pickup", {
      customer: { name: f.name, surname: f.surname, email, phone, marketingOptIn: !!mkt },
      delivery: deliver
        ? { recipient: f.dName || `${f.name} ${f.surname}`.trim(), phone: f.dPhone, email: f.dEmail || email, address: f.dAddress, city: f.dCity }
        : null,
      pickup: deliver ? null : { name: store.name, address: store.address, city: store.city, hours: store.hours, mapsUrl: store.mapsUrl },
      payment,
    });
    if (!order) return; // carrito vacío (no debería pasar aquí)

    // Guardamos las recetas de los artículos en el perfil del cliente (dato de salud).
    try {
      const rxs = (order.items || []).filter((it) => it.rx).map((it) => ({ ...it.rx, product: it.name, orderId: order.id }));
      if (mkt || rxs.length) addPrescriptions(rxs);
    } catch {}

    try { notifyOrder(order, lang); } catch {} // aviso email/SMS (best-effort, ver orderNotify.js)
    setDone(order);      // el admin ya la ve en vivo en su panel; al cliente le mostramos el comprobante
  };

  const closeAll = () => { setDone(null); setF({}); setErr(""); onClose(); };

  // Resumen de receta legible para el comprobante.
  const rxLine = (rx) => {
    if (!rx) return null;
    const eye = (e) => `${e.sph || "0.00"}${e.cyl && e.cyl !== "0" ? " / " + e.cyl : ""}${e.axis ? " x" + e.axis + "°" : ""}`;
    const pd = rx.twoPd ? `${rx.pd_od || "—"}/${rx.pd_os || "—"}` : (rx.pd || "—");
    return `OD ${eye(rx.od)} · OS ${eye(rx.os)}${rx.add ? " · ADD +" + rx.add : ""} · DP ${pd}`;
  };

  return (
    <SidePanel open={open} onClose={done ? closeAll : onClose} title={t("cart.title")}>
      {done ? (
        // ── Comprobante de compra (lo ve el cliente al instante) ──
        <div className="co-done">
          <div className="co-done-emoji">✅</div>
          <h3>{t("cart.done.title")}</h3>
          <p className="muted">{t("cart.done.msg")}</p>
          <div className="co-done-order"><b>{done.id}</b><span>{money(done.total)}</span></div>

          {/* Detalle de cada artículo: tipo de gafas + receta guardada */}
          <div className="co-bill">
            {(done.items || []).map((it, k) => (
              <div className="co-bill-row" key={k}>
                <div className="co-bill-h"><b>{it.name}</b>{it.color ? <span> · {it.color}</span> : null}</div>
                {it.glassesLabel && <div className="co-bill-type">🕶️ {L(it.glassesLabel, lang)}</div>}
                {(it.specs || []).map((s, j) => <div className="co-bill-spec" key={j}>{s.label}<b>{money(s.price)}</b></div>)}
                {it.rx && <div className="co-bill-rx">📋 {t("co.rxSaved")}: {rxLine(it.rx)}</div>}
              </div>
            ))}
          </div>

          {/* Entrega: tienda (recogida) o domicilio */}
          <div className="co-addr">
            {done.delivery ? (
              <>
                <div className="co-addr-h">🚚 {t("co.deliverTo")}</div>
                <div>{done.delivery.recipient}</div>
                <div>{done.delivery.address}{done.delivery.city ? ", " + done.delivery.city : ""}</div>
                <div className="muted">{done.delivery.phone}</div>
              </>
            ) : (
              <>
                <div className="co-addr-h">🏬 {t("co.pickupAt")}</div>
                <div>{done.pickup?.name || store.name}</div>
                <div>{done.pickup?.address || store.address}</div>
                {(done.pickup?.hours || store.hours) && <div className="muted">🕒 {done.pickup?.hours || store.hours}</div>}
                {(done.pickup?.mapsUrl || store.mapsUrl) && <a className="co-maps" href={done.pickup?.mapsUrl || store.mapsUrl} target="_blank" rel="noreferrer">📍 {t("ship.directions")}</a>}
              </>
            )}
          </div>

          {done.payment?.method === "card" && (
            <div className="co-pay-done">💳 {done.payment.brand} ···· {done.payment.last4} — {t("co.payPending")}</div>
          )}

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
                  <small>{[i.color, i.glassesLabel ? L(i.glassesLabel, lang) : null, ...((i.specs || []).map((s) => s.label))].filter(Boolean).join(" · ")}</small>
                </div>
                <span className="panel-item-price">${(i.total || 0).toFixed(2)}</span>
                <button className="panel-x" onClick={() => removeItem(i.id)} aria-label={t("common.remove")}>×</button>
              </li>
            ))}
          </ul>

          {/* ── Entrega: SOLO recoger en tienda vs a domicilio (sin zonas/transportistas) ── */}
          <div className="co-form">
            <div className="co-h">📦 {t("co.howReceive")}</div>
            <div className="co-deliv" role="radiogroup" aria-label={t("co.howReceive")}>
              <button type="button" role="radio" aria-checked={!deliver} className={"co-deliv-opt" + (!deliver ? " on" : "")} onClick={() => setDeliver(false)}>
                <span className="co-deliv-ic">🏬</span>
                <span className="co-deliv-tx"><b>{t("co.pickup")}</b><small>{store.name} · {store.city}</small></span>
              </button>
              <button type="button" role="radio" aria-checked={deliver} className={"co-deliv-opt" + (deliver ? " on" : "")} onClick={() => setDeliver(true)}>
                <span className="co-deliv-ic">🚚</span>
                <span className="co-deliv-tx"><b>{t("co.home")}</b><small>{t("co.homeSub")}</small></span>
              </button>
            </div>

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

            {deliver && (
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

            {/* ── Pago ── */}
            <div className="co-h">💳 {t("co.payment")}</div>
            <div className="co-deliv" role="radiogroup" aria-label={t("co.payment")}>
              <button type="button" role="radio" aria-checked={pay === "person"} className={"co-deliv-opt" + (pay === "person" ? " on" : "")} onClick={() => setPay("person")}>
                <span className="co-deliv-ic">💵</span>
                <span className="co-deliv-tx"><b>{t("co.payPerson")}</b><small>{deliver ? t("co.payOnDelivery") : t("co.payInStore")}</small></span>
              </button>
              <button type="button" role="radio" aria-checked={pay === "card"} className={"co-deliv-opt" + (pay === "card" ? " on" : "")} onClick={() => setPay("card")}>
                <span className="co-deliv-ic">💳</span>
                <span className="co-deliv-tx"><b>{t("co.payCard")}</b><small>{t("co.payCardSub")}</small></span>
              </button>
            </div>

            {pay === "card" && (
              <div className="co-fields co-card">
                <input placeholder={t("co.cardName")} value={f.cardName || ""} onChange={set("cardName")} autoComplete="cc-name" />
                <input placeholder={t("co.cardNum")} value={f.cardNum || ""} onChange={set("cardNum")} inputMode="numeric" autoComplete="cc-number" maxLength={23} />
                <div className="co-two">
                  <input placeholder="MM/AA" value={f.cardExp || ""} onChange={set("cardExp")} inputMode="numeric" autoComplete="cc-exp" maxLength={7} />
                  <input placeholder="CVC" value={f.cardCvc || ""} onChange={set("cardCvc")} inputMode="numeric" autoComplete="cc-csc" maxLength={4} />
                </div>
                <div className="co-secure">🔒 {t("co.cardSecure")}</div>
              </div>
            )}

            {/* ── Marketing ── */}
            <label className="co-consent">
              <input type="checkbox" checked={mkt} onChange={(e) => setMkt(e.target.checked)} />
              <span>{t("co.marketing")}</span>
            </label>
          </div>

          <div className="panel-total"><span>{t("cart.total")}</span><b>${grand.toFixed(2)}</b></div>
          {err && <div className="auth-err" style={{ margin: "8px 0" }}>{t(err)}</div>}

          <button className="btn btn-primary big" onClick={doCheckout}>
            {deliver ? "🚚 " : "🏬 "}{t("cart.checkout")} · ${grand.toFixed(2)}
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

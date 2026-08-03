import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useUser, logout } from "../components/userAuth.js";
import { useCart } from "../components/CartContext.jsx";
import { listByUser, updateReview, removeReview } from "../components/reviewsStore.js";
import TrackingTimeline from "../components/TrackingTimeline.jsx";
import { fetchMyOrders, getSession } from "../data/orderAccess.js";
import { useLang } from "../i18n/LanguageContext.jsx";

const money = (n) => "$" + (Number(n) || 0).toFixed(2);

/**
 * Real orders for the account tabs.
 *
 * The account login is a client-side demo gate (any email + phone), so it proves
 * nothing to the backend and cannot be used to fetch orders. The order-access
 * session from /my-orders is the real credential; when it is absent both tabs
 * point there rather than showing seeded demo rows as if they were purchases.
 */
function useRealOrders() {
  const [state, setState] = useState({ loading: true, orders: null, session: getSession() });

  useEffect(() => {
    const session = getSession();
    if (!session) {
      setState({ loading: false, orders: null, session: null });
      return;
    }
    let alive = true;
    fetchMyOrders()
      .then((data) => {
        if (alive) setState({ loading: false, orders: data ? data.orders : null, session });
      })
      .catch(() => {
        if (alive) setState({ loading: false, orders: null, session: null });
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}

/** Shown in place of the order lists when there is no tracking session yet. */
function NeedsTrackingSession() {
  const { t } = useLang();
  return (
    <div className="acc-soon-box">
      <div className="acc-soon-emoji">📦</div>
      <h3>{t("acc.orders.linkTitle")}</h3>
      <p className="muted">{t("acc.orders.linkBody")}</p>
      <Link to="/my-orders" className="btn btn-primary">{t("acc.orders.linkCta")}</Link>
    </div>
  );
}

function Stars({ value, onSelect }) {
  return (
    <span className="stars-input">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" className={n <= value ? "on" : ""} onClick={onSelect ? () => onSelect(n) : undefined}>★</button>
      ))}
    </span>
  );
}

function Favorites() {
  const { favorites, toggleFav, addVariant, busy } = useCart();
  const { t } = useLang();
  const addFav = async (f) => {
    if (!f.variantId) { alert(t("cart.noVariant")); return; }
    try { await addVariant(f.variantId); } catch { alert(t("cart.addError")); }
  };
  if (!favorites.length) return <p className="muted acc-empty">{t("acc.fav.empty")}</p>;
  return (
    <div className="acc-grid">
      {favorites.map((f) => (
        <div className="acc-fav" key={f.slug}>
          <img src={f.image} alt={f.name} onError={(e) => { e.currentTarget.style.opacity = .25; }} />
          <div className="acc-fav-info">
            <Link to={`/producto/${f.slug}`}><b>{f.name}</b></Link>
            <small>{f.brand} · {money(f.price)}</small>
            <div className="acc-fav-actions">
              <button disabled={busy} onClick={() => addFav(f)}>{t("common.addCart")}</button>
              <button className="link-red" onClick={() => toggleFav(f)}>{t("common.remove")}</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Orders() {
  const { t, lang } = useLang();
  const { loading, orders, session } = useRealOrders();

  if (loading) return <p className="muted acc-empty">…</p>;
  if (!session) return <NeedsTrackingSession />;
  if (!orders || !orders.length) return <p className="muted acc-empty">{t("acc.orders.empty")}</p>;

  return (
    <div className="acc-orders">
      {orders.map((o) => (
        <div className="acc-order" key={o.id}>
          <div className="acc-order-head">
            <b>#{o.display_id ?? o.id}</b>
            <span className="muted">
              {o.created_at ? new Date(o.created_at).toLocaleDateString(lang === "en" ? "en-US" : "es") : ""}
            </span>
            <span className="acc-status">{t("track." + (o.terminal || o.stage))}</span>
          </div>
          <ul>
            {(o.items || []).map((it) => (
              <li key={it.id}><span>{it.title}</span><b>{money(it.total)}</b></li>
            ))}
          </ul>
          <div className="acc-order-foot">
            <span>{t("cart.total")}: <b>{money(o.total)}</b></span>
            <Link className="btn-sm" to="/my-orders">{t("acc.track")}</Link>
          </div>
        </div>
      ))}
    </div>
  );
}

function Reviews({ email }) {
  const { t } = useLang();
  const [items, setItems] = useState(() => listByUser(email));
  const [editing, setEditing] = useState(null); // {slug,id}
  const [draft, setDraft] = useState({ rating: 5, text: "" });
  const refresh = () => setItems(listByUser(email));

  if (!items.length) return <p className="muted acc-empty">{t("acc.rev.empty")}</p>;
  return (
    <div className="acc-reviews">
      {items.map((r) => {
        const on = editing && editing.id === r.id;
        return (
          <div className="acc-review" key={r.id}>
            <div className="acc-review-head">
              <Link to={`/producto/${r.slug}`}><b>{r.product || r.slug}</b></Link>
              <span className="muted">{r.date}</span>
            </div>
            {on ? (
              <>
                <Stars value={draft.rating} onSelect={(v) => setDraft((d) => ({ ...d, rating: v }))} />
                <textarea rows={3} value={draft.text} onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))} />
                <div className="acc-review-actions">
                  <button className="btn-sm" onClick={() => { updateReview(r.slug, r.id, { rating: draft.rating, text: draft.text.trim() }); setEditing(null); refresh(); }}>{t("acc.save")}</button>
                  <button className="btn-sm" onClick={() => setEditing(null)}>{t("acc.cancel")}</button>
                </div>
              </>
            ) : (
              <>
                <Stars value={r.rating} />
                <p>{r.text}</p>
                {r.photos && r.photos.length > 0 && <div className="rev-thumbs">{r.photos.map((p, j) => <img key={j} src={p} alt="" />)}</div>}
                <div className="acc-review-actions">
                  <button className="btn-sm" onClick={() => { setEditing({ slug: r.slug, id: r.id }); setDraft({ rating: r.rating, text: r.text }); }}>{t("acc.edit")}</button>
                  <button className="btn-sm danger" onClick={() => { removeReview(r.slug, r.id); refresh(); }}>{t("acc.delete")}</button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Tracking() {
  const { t, lang } = useLang();
  const { loading, orders, session } = useRealOrders();

  if (loading) return <p className="muted acc-empty">…</p>;
  if (!session) return <NeedsTrackingSession />;
  if (!orders || !orders.length) {
    return (
      <div className="acc-soon-box">
        <div className="acc-soon-emoji">🚚</div>
        <h3>{t("acc.track")}</h3>
        <p className="muted">{t("acc.track.desc")}</p>
      </div>
    );
  }
  return (
    <div className="acc-orders">
      {orders.map((o) => (
        <div className="acc-order" key={o.id}>
          <div className="acc-order-head">
            <b>#{o.display_id ?? o.id}</b>
            <span className="muted">
              {o.created_at ? new Date(o.created_at).toLocaleDateString(lang === "en" ? "en-US" : "es") : ""}
            </span>
          </div>
          <TrackingTimeline
            status={o.stage}
            terminal={o.terminal}
            hasPrescription={o.has_prescription}
          />
        </div>
      ))}
    </div>
  );
}

const TABS = [["fav", "acc.tab.fav"], ["orders", "acc.tab.orders"], ["reviews", "acc.tab.reviews"], ["track", "acc.tab.track"]];

export default function AccountPage() {
  const user = useUser();
  const { t } = useLang();
  const [tab, setTab] = useState("fav");

  if (!user) {
    return (
      <div className="section acc-login-needed">
        <h1>{t("acc.title")}</h1>
        <p className="muted">{t("acc.needLogin")}</p>
        <p><Link to="/" className="btn btn-primary">{t("acc.goStore")}</Link></p>
      </div>
    );
  }

  return (
    <div className="section account">
      <div className="acc-header">
        <div className="acc-avatar">{(user.email[0] || "?").toUpperCase()}</div>
        <div>
          <h1>{t("acc.title")}</h1>
          <p className="muted">{user.email}</p>
        </div>
        <button className="btn-sm" onClick={logout}>{t("auth.logout")}</button>
      </div>
      <nav className="acc-tabs">
        {TABS.map(([k, label]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t(label)}</button>)}
      </nav>
      <div className="acc-panel">
        {tab === "fav" && <Favorites />}
        {tab === "orders" && <Orders />}
        {tab === "reviews" && <Reviews email={user.email} />}
        {tab === "track" && <Tracking />}
      </div>
    </div>
  );
}

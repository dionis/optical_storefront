import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useUser, logout } from "../components/userAuth.js";
import { useCart } from "../components/CartContext.jsx";
import { listOwnReviews, updateOwnReview, removeOwnReview } from "../components/reviewsStore.js";
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

/**
 * The reviews this browser wrote. Backed by the server now, with the edit
 * tokens kept locally — see components/reviewsStore.js for why authorship is
 * proved by a token rather than by the signed-in email.
 */
function Reviews() {
  const { t } = useLang();
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("loading");
  const [editing, setEditing] = useState(null); // review id
  const [draft, setDraft] = useState({ rating: 5, text: "" });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setItems(await listOwnReviews());
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async (id) => {
    if (!draft.text.trim() || busy) return;
    setBusy(true);
    try {
      await updateOwnReview(id, { rating: draft.rating, body: draft.text.trim() });
      setEditing(null);
      await refresh();
    } catch { /* the row stays as it was */ }
    setBusy(false);
  };

  const remove = async (id) => {
    if (busy) return;
    setBusy(true);
    try { await removeOwnReview(id); await refresh(); } catch { /* keep it listed */ }
    setBusy(false);
  };

  if (status === "loading") return <p className="muted acc-empty">…</p>;
  if (!items.length) return <p className="muted acc-empty">{t("acc.rev.empty")}</p>;

  return (
    <div className="acc-reviews">
      {items.map((r) => {
        const on = editing === r.id;
        return (
          <div className="acc-review" key={r.id}>
            <div className="acc-review-head">
              <Link to={`/producto/${r.product_handle}`}><b>{r.product_handle}</b></Link>
              <span className="muted">{(r.created_at || "").slice(0, 10)}</span>
            </div>
            {on ? (
              <>
                <Stars value={draft.rating} onSelect={(v) => setDraft((d) => ({ ...d, rating: v }))} />
                <textarea rows={3} value={draft.text} onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))} />
                <div className="acc-review-actions">
                  <button className="btn-sm" disabled={busy} onClick={() => save(r.id)}>{t("acc.save")}</button>
                  <button className="btn-sm" onClick={() => setEditing(null)}>{t("acc.cancel")}</button>
                </div>
              </>
            ) : (
              <>
                <Stars value={r.rating} />
                <p>{r.body}</p>
                {r.photo_urls && r.photo_urls.length > 0 && (
                  <div className="rev-thumbs">{r.photo_urls.map((u) => <img key={u} src={u} alt="" />)}</div>
                )}
                <div className="acc-review-actions">
                  <button className="btn-sm" onClick={() => { setEditing(r.id); setDraft({ rating: r.rating, text: r.body }); }}>{t("acc.edit")}</button>
                  <button className="btn-sm danger" disabled={busy} onClick={() => remove(r.id)}>{t("acc.delete")}</button>
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
        {tab === "reviews" && <Reviews />}
        {tab === "track" && <Tracking />}
      </div>
    </div>
  );
}

// Order tracking for guests: one page listing every order the shopper made,
// reached with a passwordless emailed link and remembered afterwards so they
// never have to dig through their inbox again.
//
// Three states: no session (ask for the email), redeeming a link from the URL,
// and the order list. Order data comes from /store/my-orders — it carries stage
// and totals only, never prescription values.
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import TrackingTimeline from "../components/TrackingTimeline.jsx";
import {
  clearSession,
  fetchMyOrders,
  getSession,
  redeemMagicToken,
  requestMagicLink,
  sendSupportMessage,
} from "../data/orderAccess.js";

// Same codes the checkout summary uses (DESIGN_LBL in MedusaCheckout).
const DESIGN_LBL = {
  "frame-only": { es: "Solo montura", en: "Frame only" },
  sv: { es: "Visión Sencilla", en: "Single Vision" },
  bifocal: { es: "Bifocal", en: "Bifocal" },
  "prog-mid": { es: "Progresivo", en: "Progressive" },
  "prog-high": { es: "Progresivo gama alta", en: "Progressive premium" },
};

const REASONS = ["delay", "wrong", "cancel", "other"];

/** Support form shown inline under one order. */
function SupportForm({ order, onDone }) {
  const { t, lang } = useLang();
  const L = (k) => t(`orders.${k}`);
  const [reason, setReason] = useState("delay");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await sendSupportMessage({
        orderId: order.id,
        reason,
        message: message.trim(),
        locale: lang,
      });
      onDone();
    } catch (e2) {
      setErr(e2.message || L("supportError"));
    }
    setBusy(false);
  };

  return (
    <form className="mo-support" onSubmit={submit}>
      <div className="mo-support-h">{L("supportTitle")}</div>
      <div className="mo-reasons">
        {REASONS.map((r) => (
          <label key={r} className={`mo-reason ${reason === r ? "sel" : ""}`}>
            <input
              type="radio"
              name={`reason-${order.id}`}
              checked={reason === r}
              onChange={() => setReason(r)}
            />
            <span>{L(`reason.${r}`)}</span>
          </label>
        ))}
      </div>
      <textarea
        rows={4}
        maxLength={2000}
        placeholder={L("supportPlaceholder")}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      {err && <div className="auth-err">{err}</div>}
      <div className="mo-support-actions">
        <button type="button" className="btn btn-outline" onClick={onDone} disabled={busy}>
          {L("cancel")}
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || !message.trim()}>
          {busy ? <><span className="btn-spin" aria-hidden="true" /> {L("sending")}</> : L("send")}
        </button>
      </div>
    </form>
  );
}

function OrderCard({ order }) {
  const { t, lang } = useLang();
  const L = (k) => t(`orders.${k}`);
  const money = (n) => "$" + Number(n || 0).toFixed(2);
  const [openSupport, setOpenSupport] = useState(false);
  const [sent, setSent] = useState(false);

  const date = order.created_at
    ? new Date(order.created_at).toLocaleDateString(lang === "en" ? "en-US" : "es")
    : "";

  return (
    <article className="mo-order">
      <header className="mo-order-head">
        <div>
          <b>#{order.display_id ?? order.id}</b>
          <span className="muted"> · {date}</span>
        </div>
        <span className="mo-total">{money(order.total)}</span>
      </header>

      <TrackingTimeline
        status={order.stage}
        terminal={order.terminal}
        hasPrescription={order.has_prescription}
      />

      {order.tracking_number && (
        <div className="mo-tracking">
          {L("trackingNumber")}: <b>{order.tracking_number}</b>
        </div>
      )}

      <ul className="mo-items">
        {(order.items || []).map((it) => {
          const dl = DESIGN_LBL[it.lens?.design_code];
          const parts = [
            dl ? dl[lang] || dl.es : it.lens?.design_code,
            it.lens?.material_code,
            it.lens?.photo_code,
            it.lens?.ar_code,
          ].filter(Boolean);
          return (
            <li key={it.id} className="mo-item">
              {it.thumbnail && <img src={it.thumbnail} alt="" loading="lazy" />}
              <div className="mo-item-info">
                <b>
                  {it.title}
                  {it.quantity > 1 ? ` × ${it.quantity}` : ""}
                </b>
                {parts.length > 0 && <small>{parts.join(" · ")}</small>}
                {it.has_prescription && <small className="mo-rx">✓ {L("withRx")}</small>}
              </div>
              <span className="mo-item-price">{money(it.total)}</span>
            </li>
          );
        })}
      </ul>

      {sent ? (
        <div className="mo-sent">✅ {L("supportSent")}</div>
      ) : openSupport ? (
        <SupportForm
          order={order}
          onDone={() => {
            setOpenSupport(false);
            setSent(true);
          }}
        />
      ) : (
        <button className="btn btn-outline mo-support-open" onClick={() => setOpenSupport(true)}>
          {L("supportOpen")}
        </button>
      )}
    </article>
  );
}

export default function MyOrders() {
  const { t, lang } = useLang();
  const L = (k) => t(`orders.${k}`);
  const [params, setParams] = useSearchParams();

  const [session, setSession] = useState(() => getSession());
  const [orders, setOrders] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Email form
  const [email, setEmail] = useState("");
  const [requested, setRequested] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const data = await fetchMyOrders();
      setOrders(data ? data.orders : null);
      if (!data) setSession(null);
    } catch (e) {
      if (e.status === 401) {
        setSession(null);
        setOrders(null);
      } else {
        setErr(e.message || L("loadError"));
      }
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redeem a magic link on arrival, then strip the token from the URL so a
  // shared or bookmarked address does not carry a credential around.
  useEffect(() => {
    const token = params.get("token");
    if (!token) return;
    (async () => {
      setLoading(true);
      try {
        const s = await redeemMagicToken(token);
        setSession(s);
        setParams({}, { replace: true });
        await load();
      } catch (e) {
        setErr(e.message || L("linkExpired"));
        setParams({}, { replace: true });
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (session && orders === null && !loading) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const askLink = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setErr("");
    try {
      await requestMagicLink(email.trim(), lang);
      setRequested(true);
    } catch (e2) {
      setErr(e2.message || L("requestError"));
    }
    setSending(false);
  };

  const signOut = () => {
    clearSession();
    setSession(null);
    setOrders(null);
    setRequested(false);
  };

  // ── Not identified yet: ask for the email ──
  if (!session) {
    return (
      <div className="section mo-wrap">
        <h1>{L("title")}</h1>
        {requested ? (
          <div className="mo-sent-box">
            <div className="mo-sent-emoji">📬</div>
            <h2>{L("checkInbox")}</h2>
            {/* Deliberately does not claim the address has orders — the backend
                answers identically either way so we cannot promise delivery. */}
            <p className="muted">{L("checkInboxBody")}</p>
            <button className="btn btn-outline" onClick={() => setRequested(false)}>
              {L("useAnotherEmail")}
            </button>
          </div>
        ) : (
          <form className="mo-login" onSubmit={askLink}>
            <p className="muted">{L("loginIntro")}</p>
            <input
              type="email"
              required
              placeholder={L("emailPlaceholder")}
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
            />
            {err && <div className="auth-err">{err}</div>}
            <button className="btn btn-primary big" disabled={sending || !email.trim()}>
              {sending ? (
                <><span className="btn-spin" aria-hidden="true" /> {L("sending")}</>
              ) : (
                L("sendLink")
              )}
            </button>
            <small className="muted">{L("noPassword")}</small>
          </form>
        )}
      </div>
    );
  }

  // ── Identified ──
  return (
    <div className="section mo-wrap">
      <div className="mo-head">
        <h1>{L("title")}</h1>
        <div className="mo-session">
          <span className="muted">{session.email}</span>
          <button className="mo-signout" onClick={signOut}>{L("signOut")}</button>
        </div>
      </div>

      {err && <div className="auth-err">{err}</div>}

      {loading && orders === null ? (
        <p className="muted">…</p>
      ) : !orders || orders.length === 0 ? (
        <div className="mo-sent-box">
          <div className="mo-sent-emoji">🕶️</div>
          <h2>{L("emptyTitle")}</h2>
          <p className="muted">{L("emptyBody")}</p>
          <Link to="/catalogo" className="btn btn-primary">{L("toCatalog")}</Link>
        </div>
      ) : (
        <div className="mo-list">
          {orders.map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </div>
      )}
    </div>
  );
}

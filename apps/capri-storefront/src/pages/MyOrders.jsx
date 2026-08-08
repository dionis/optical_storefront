// Order tracking for guests: one page listing every order the shopper made,
// reached with a passwordless emailed link and remembered afterwards so they
// never have to dig through their inbox again.
//
// Three states: no session (ask for the email), redeeming a link from the URL,
// and the order list. Order data comes from /store/my-orders, which returns the
// shopper's own order in full — stage, totals, lens configuration, frame sheet
// and the prescription it was cut to (see that route's header on what is
// deliberately left out of the payload).
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import TrackingTimeline from "../components/TrackingTimeline.jsx";
import OrderGlassesDetails from "../components/OrderGlassesDetails.jsx";
import { resolveImage } from "../data/imageUrl.js";
import { lensSummary } from "../data/lensLabels.js";
import {
  cancelOrder,
  clearSession,
  fetchMyOrders,
  getSession,
  redeemMagicToken,
  requestMagicLink,
  sendSupportMessage,
} from "../data/orderAccess.js";

const REASONS = ["delay", "wrong", "cancel", "other"];

/**
 * Which sentence the cancel dialog uses for the money. The backend decides —
 * `refund_outcome` reflects what the payment provider will actually be asked to
 * do — so this only maps its answer to copy. Promising a refund on an order that
 * was never captured would be a lie the shopper waits ten days to discover.
 */
const MONEY_COPY = {
  refund: "orders.cancelMoneyRefund",
  release_hold: "orders.cancelMoneyHold",
  nothing: "orders.cancelMoneyNothing",
};

/** Why the shopper says they are cancelling — mirrors CANCEL_REASONS server-side. */
const CANCEL_REASONS = ["late_delivery", "not_needed", "wrong_item", "other"];

/**
 * Refusals that are about *timing* rather than state. These are the ones the
 * shopper can do something about — wait — so they get the full explanation with
 * dates instead of a bare "you can't".
 */
const TIMING_REASONS = new Set(["lab_window", "not_shipped", "shipping_window"]);

/**
 * The store's cancellation policy, with both clocks where this order stands.
 *
 * The backend sends numbers and ISO instants, never sentences, so the wording
 * and the date format follow the language the shopper picked — a page that
 * explained the wait in Spanish to someone reading English would be the one
 * string on screen ignoring the toggle.
 */
function CancelPolicy({ window: w }) {
  const { t, lang } = useLang();
  const L = (k) => t(`orders.${k}`);
  if (!w) return null;

  const when = (iso) =>
    iso
      ? new Date(iso).toLocaleString(lang === "en" ? "en-US" : "es", {
          dateStyle: "long",
          timeStyle: "short",
        })
      : "—";

  const labLine = w.lab_done
    ? t("orders.cancelWhyLabDone", { days: w.lab_business_days })
    : t("orders.cancelWhyLab", {
        days: w.lab_business_days,
        remaining: w.lab_days_remaining,
        date: when(w.lab_ready_at),
      });

  const shipLine = !w.shipped_at
    ? t("orders.cancelWhyNotShipped", { hours: w.shipping_grace_hours })
    : w.shipping_done
      ? t("orders.cancelWhyShippedDone", {
          hours: w.shipping_grace_hours,
          date: when(w.shipped_at),
        })
      : t("orders.cancelWhyShipping", {
          date: when(w.shipped_at),
          hours: w.shipping_hours_remaining,
          until: when(w.shipping_ready_at),
        });

  return (
    <div className="mo-cancel-policy">
      <div className="mo-cancel-policy-h">{L("cancelWhyTitle")}</div>
      <ul>
        <li className={w.lab_done ? "done" : ""}>
          <span aria-hidden="true">{w.lab_done ? "✓" : "⏳"}</span> {labLine}
        </li>
        <li className={w.shipping_done ? "done" : ""}>
          <span aria-hidden="true">{w.shipping_done ? "✓" : "⏳"}</span> {shipLine}
        </li>
      </ul>
      {/* Only worth saying once the ship date is known — until then there is no
          instant to name, and inventing one would be a promise we cannot keep. */}
      {w.eligible_at && !(w.lab_done && w.shipping_done) && (
        <p className="mo-cancel-policy-from">
          {t("orders.cancelWhyFrom", { date: when(w.eligible_at) })}
        </p>
      )}
      <p className="mo-cancel-policy-help">{L("cancelWhyHelp")}</p>
    </div>
  );
}

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

/**
 * Confirmation step for cancelling. Deliberately not a window.confirm().
 *
 * The reason is asked for here rather than inferred: it is what the store owner
 * reads in the cancellation email, and "the customer cancelled" without a why is
 * a mail nobody can act on. It is a fixed list — free text belongs in the
 * support thread, which is a conversation, not a form field.
 */
function CancelPanel({ order, onCancelled, onDismiss }) {
  const { t, lang } = useLang();
  const L = (k) => t(`orders.${k}`);
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [blockedWindow, setBlockedWindow] = useState(null);

  const confirm = async () => {
    setBusy(true);
    setErr("");
    setBlockedWindow(null);
    try {
      const result = await cancelOrder({
        orderId: order.id,
        locale: lang,
        reason,
        note: note.trim(),
      });
      onCancelled(result?.status === "pending_return" ? "pending_return" : "canceled");
    } catch (e) {
      // The backend answers 409 with a `reason` when the order moved on since
      // the list was fetched — say which, rather than a generic failure. When
      // the refusal is about timing it also sends both clocks, so the shopper
      // gets the same explanation the card shows instead of a dead end.
      const key = e.reason ? `orders.cancelBlocked.${e.reason}` : "";
      const specific = key ? t(key) : "";
      setErr(specific && specific !== key ? specific : e.message || L("cancelError"));
      if (e.window && TIMING_REASONS.has(e.reason)) setBlockedWindow(e.window);
      setBusy(false);
    }
  };

  return (
    <div className="mo-cancel" role="group" aria-label={L("cancelTitle")}>
      <div className="mo-cancel-h">{L("cancelTitle")}</div>
      <p className="mo-cancel-body">{L("cancelBody")}</p>
      {order.lab_started && <p className="mo-cancel-warn">⚠️ {L("cancelWarnLab")}</p>}

      <div className="mo-cancel-reason">
        <div className="mo-cancel-reason-h">{L("cancelReasonTitle")}</div>
        <div className="mo-reasons">
          {CANCEL_REASONS.map((r) => (
            <label key={r} className={`mo-reason ${reason === r ? "sel" : ""}`}>
              <input
                type="radio"
                name={`cancel-reason-${order.id}`}
                checked={reason === r}
                onChange={() => setReason(r)}
              />
              <span>{L(`cancelReason.${r}`)}</span>
            </label>
          ))}
        </div>
        <textarea
          rows={2}
          maxLength={500}
          aria-label={L("cancelNoteLabel")}
          placeholder={L("cancelNotePlaceholder")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <p className="mo-cancel-money">
        {t(MONEY_COPY[order.refund_outcome] || MONEY_COPY.nothing)}
      </p>
      {err && <div className="auth-err">{err}</div>}
      {blockedWindow && <CancelPolicy window={blockedWindow} />}
      <div className="mo-support-actions">
        <button type="button" className="btn btn-outline" onClick={onDismiss} disabled={busy}>
          {L("cancelKeep")}
        </button>
        <button type="button" className="btn btn-danger" onClick={confirm} disabled={busy}>
          {busy ? (
            <><span className="btn-spin" aria-hidden="true" /> {L("canceling")}</>
          ) : (
            L("cancelConfirm")
          )}
        </button>
      </div>
    </div>
  );
}

/** One labelled row in the details drawer. */
function DetailRow({ label, value }) {
  return (
    <div className="mo-drow">
      <span className="mo-dlabel">{label}</span>
      <span className="mo-dvalue">{value}</span>
    </div>
  );
}

function OrderCard({ order, onChanged }) {
  const { t, lang } = useLang();
  const L = (k) => t(`orders.${k}`);
  const money = (n) => "$" + Number(n || 0).toFixed(2);
  const [openSupport, setOpenSupport] = useState(false);
  const [sent, setSent] = useState(false);
  const [openDetails, setOpenDetails] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  // null while nothing happened, then "canceled" or "pending_return" — the two
  // land in very different places and must not share a confirmation.
  const [cancelled, setCancelled] = useState(null);

  const date = order.created_at
    ? new Date(order.created_at).toLocaleDateString(lang === "en" ? "en-US" : "es")
    : "";

  const addr = order.shipping_address;
  const addrLine = addr
    ? [addr.name, addr.address_1, addr.address_2, addr.city, addr.province, addr.postal_code]
        .filter(Boolean)
        .join(", ")
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
          const summary = lensSummary(it.lens, lang);
          const src = resolveImage(it.thumbnail);
          return (
            <li key={it.id} className="mo-item">
              {/* Always render the frame, even without an image, so the rows
                  line up instead of jumping between two layouts. */}
              {src ? (
                <img src={src} alt={it.title} loading="lazy" />
              ) : (
                <span className="mo-item-noimg" aria-hidden="true">
                  🕶️
                </span>
              )}
              <div className="mo-item-info">
                <b>
                  {it.title}
                  {it.quantity > 1 ? ` × ${it.quantity}` : ""}
                </b>
                {summary && <small>{summary}</small>}
                {it.has_prescription && <small className="mo-rx">✓ {L("withRx")}</small>}
              </div>
              <span className="mo-item-price">{money(it.total)}</span>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="mo-details-toggle"
        aria-expanded={openDetails}
        onClick={() => setOpenDetails((v) => !v)}
      >
        {openDetails ? L("hideDetails") : L("showDetails")}
        <span aria-hidden="true">{openDetails ? " ▲" : " ▼"}</span>
      </button>

      {openDetails && (
        <div className="mo-details">
          {/* Full record of what was bought: lens configuration, the frame's
              technical sheet and the prescription it was cut to. */}
          {(order.items || []).map((it) => (
            <OrderGlassesDetails key={it.id} item={it} money={money} />
          ))}

          <section className="mo-dblock">
            <DetailRow label={L("placedOn")} value={date} />
            {order.shipping_method && (
              <DetailRow label={L("shippingMethod")} value={order.shipping_method} />
            )}
            {addrLine && <DetailRow label={L("shipTo")} value={addrLine} />}
          </section>

          <section className="mo-dblock mo-totals">
            <DetailRow label={L("subtotal")} value={money(order.item_total)} />
            <DetailRow label={L("shipping")} value={money(order.shipping_total)} />
            {Number(order.discount_total) > 0 && (
              <DetailRow label={L("discount")} value={"−" + money(order.discount_total)} />
            )}
            {Number(order.tax_total) > 0 && (
              <DetailRow label={L("taxes")} value={money(order.tax_total)} />
            )}
            <div className="mo-drow mo-dtotal">
              <span className="mo-dlabel">{L("totalLabel")}</span>
              <span className="mo-dvalue">{money(order.total)}</span>
            </div>
          </section>
        </div>
      )}

      {cancelled ? (
        <div className="mo-sent">
          ✅ {cancelled === "pending_return" ? L("cancelPendingDone") : L("cancelDone")}
        </div>
      ) : confirmingCancel ? (
        <CancelPanel
          order={order}
          onDismiss={() => setConfirmingCancel(false)}
          onCancelled={(status) => {
            setConfirmingCancel(false);
            setCancelled(status);
            // Refetch so the timeline and the buttons reflect the new state
            // rather than this component's local memory of it.
            onChanged();
          }}
        />
      ) : sent ? (
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
        <>
          {/* Why the cancel button is not here yet. Hiding it without a word is
              what sends people to the support form, which is the thing this
              page exists to spare them. */}
          {!order.cancelable && TIMING_REASONS.has(order.cancel_blocked_by) && (
            <CancelPolicy window={order.cancel_window} />
          )}
          <div className="mo-actions">
            <button className="btn btn-outline mo-support-open" onClick={() => setOpenSupport(true)}>
              {L("supportOpen")}
            </button>
            {order.cancelable && (
              <button
                className="btn btn-ghost-danger"
                onClick={() => setConfirmingCancel(true)}
              >
                {L("cancelOrder")}
              </button>
            )}
          </div>
        </>
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
            <OrderCard key={o.id} order={o} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

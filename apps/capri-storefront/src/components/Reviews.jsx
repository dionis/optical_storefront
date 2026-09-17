import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import { getUser } from "./userAuth.js";
import { fetchReviews, createReview, uploadReviewPhotos } from "../data/reviews.js";

/* Small inline field icons, so the form reads at a glance and carries no extra
   asset request. currentColor lets CSS tint them (muted, or brand on focus). */
const IconUser = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="8" r="4" /><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
  </svg>
);
const IconPhone = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6.5 3h3l1.5 4.5-2 1.2a12 12 0 0 0 5.1 5.1l1.2-2 4.5 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.5 5.2 2 2 0 0 1 6.5 3z" />
  </svg>
);
const IconMail = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
  </svg>
);
const IconPen = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);

/* Rating input. Stars are transparent (outline only) until filled, and the
   whole run previews on hover so the tap target is obvious on the way to it. */
function Stars({ value, onSelect, hover, onHover }) {
  const shown = hover || value;
  const interactive = Boolean(onSelect);
  return (
    <span className={"stars-input" + (interactive ? " editable" : "")}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={n <= shown ? "on" : ""}
          onClick={onSelect ? () => onSelect(n) : undefined}
          onMouseEnter={onHover ? () => onHover(n) : undefined}
          onMouseLeave={onHover ? () => onHover(0) : undefined}
          tabIndex={interactive ? 0 : -1}
          aria-label={`${n}★`}
        >
          ★
        </button>
      ))}
    </span>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Reviews({ product }) {
  const { t, lang } = useLang();
  const [state, setState] = useState({ reviews: [], count: 0, average: null, status: "loading" });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [text, setText] = useState("");
  // Kept as Files (not data URIs): they are uploaded on submit and the preview
  // is a temporary object URL, so a 4 MB photo never sits in React state twice.
  const [photos, setPhotos] = useState([]);

  // The confirmation dialog and the marketing opt-ins it collects.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [wantsEmail, setWantsEmail] = useState(false);
  const [wantsSms, setWantsSms] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [thanks, setThanks] = useState(false);

  const handle = product.slug;

  const load = useCallback(async () => {
    try {
      const res = await fetchReviews(handle);
      setState({ ...res, status: "ready" });
    } catch {
      // The product page must still render without its reviews.
      setState({ reviews: [], count: 0, average: null, status: "error" });
    }
  }, [handle]);

  useEffect(() => { load(); }, [load]);

  // Body scroll lock + ESC to close, only while the confirmation dialog is open.
  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setConfirmOpen(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [confirmOpen]);

  // Step 1: the form's own submit only validates and opens the confirmation
  // dialog — nothing is published until the customer confirms there.
  const openConfirm = (e) => {
    e.preventDefault();
    setErr("");
    if (!rating) { setErr(t("rev.errRating")); return; }
    if (!name.trim()) { setErr(t("rev.errName")); return; }
    if (!EMAIL_RE.test(email.trim())) { setErr(t("rev.errEmail")); return; }
    if (!text.trim()) { setErr(t("rev.errText")); return; }
    setConfirmOpen(true);
  };

  // Step 2: run from inside the dialog. Persists the review together with the
  // marketing preferences the customer just chose.
  const publish = async () => {
    if (submitting) return;
    if (wantsSms && !phone.trim()) { setErr(t("rev.errPhone")); setConfirmOpen(false); return; }
    setErr(""); setSubmitting(true);
    const u = getUser();
    try {
      // Photos first. If they fail we surface it and stop, rather than posting a
      // review that silently lost the pictures the customer chose.
      const photoUrls = photos.length ? await uploadReviewPhotos(photos.map((p) => p.file)) : [];
      await createReview({
        handle,
        rating,
        body: text.trim(),
        authorName: name.trim(),
        authorEmail: email.trim() || (u && u.email) || null,
        authorPhone: phone.trim() || null,
        wantsEmail,
        wantsSms,
        locale: lang,
        photoUrls,
      });
      photos.forEach((p) => URL.revokeObjectURL(p.url));
      setPhotos([]);
      setName(""); setPhone(""); setEmail(""); setText(""); setRating(0);
      setWantsEmail(false); setWantsSms(false);
      setConfirmOpen(false);
      setThanks(true); setTimeout(() => setThanks(false), 2800);
      // Re-read rather than splice locally: the server owns the average, and
      // guessing it here is how the two drift apart.
      await load();
    } catch (e2) {
      setConfirmOpen(false);
      setErr(e2?.message ? String(e2.message) : t("rev.error"));
    }
    setSubmitting(false);
  };

  // Only real reviews count. With none, we say so instead of printing a rating
  // nobody gave — the number shown here used to be generated by the scraper.
  const hasReviews = state.count > 0 && state.average != null;

  return (
    <section className="section reviews">
      {hasReviews ? (
        <h2 className="section-title case-cross-title">{t("rev.title")}</h2>
      ) : (
        <h2 className="section-title case-cross-title rev-befirst">{t("rev.beFirst")}</h2>
      )}

      {hasReviews && (
        <div className="rev-summary">
          <div className="rev-avg">
            <b>{state.average.toFixed(1)}</b>
            <Stars value={Math.round(state.average)} />
            <small>{state.count} {t("rev.based")}</small>
          </div>
        </div>
      )}

      <form className="rev-form" onSubmit={openConfirm} noValidate>
        <h3>{t("rev.write")}</h3>

        <div className="rev-row">
          <label>{t("rev.your")}:
            <Stars value={rating} onSelect={setRating} hover={hoverRating} onHover={setHoverRating} />
          </label>
        </div>

        <div className="rev-field">
          <span className="rev-field-ic"><IconUser /></span>
          <input className="rev-input" type="text" placeholder={t("rev.name")}
                 value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>

        <div className="rev-field">
          <span className="rev-field-ic"><IconPhone /></span>
          <input className="rev-input" type="tel" placeholder={t("rev.phone")}
                 value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
        </div>

        <div className="rev-field">
          <span className="rev-field-ic"><IconMail /></span>
          <input className="rev-input" type="email" placeholder={t("rev.email")}
                 value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>

        <div className="rev-field rev-field-area">
          <span className="rev-field-ic"><IconPen /></span>
          <textarea className="rev-input rev-text" placeholder={t("rev.text")}
                    value={text} onChange={(e) => setText(e.target.value)} rows={3} />
        </div>

        <div className="rev-photos">
          {photos.map((p, i) => (
            <span key={p.url} style={{ position: "relative" }}>
              <img src={p.url} alt="" className="rev-photo" />
              <button type="button" className="panel-x" style={{ position: "absolute", top: -6, right: -6 }}
                      onClick={() => setPhotos((ph) => { URL.revokeObjectURL(p.url); return ph.filter((_, j) => j !== i); })}>×</button>
            </span>
          ))}
          {photos.length < 3 && (
            <label className="rev-photo-add">📷 {t("rev.photo")}
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple
                     onChange={(e) => {
                       const picked = Array.from(e.target.files || []).map((file) => ({ file, url: URL.createObjectURL(file) }));
                       setPhotos((ph) => [...ph, ...picked].slice(0, 3));
                       e.target.value = "";
                     }} />
            </label>
          )}
        </div>

        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? <><span className="btn-spin" aria-hidden="true" /> {t("rev.sending")}</> : t("rev.submit")}
        </button>
        {err && <span className="rev-err">{err}</span>}
        {thanks && <span className="rev-thanks">✓ {t("rev.thanks")}</span>}
      </form>

      {hasReviews && (
        <div className="rev-list">
          {state.reviews.map((r) => (
            <div key={r.id} className="rev-item">
              <div className="rev-item-head">
                <b>{r.author_name}</b>
                <Stars value={r.rating} />
                <small className="muted">{r.created_at.slice(0, 10)}</small>
              </div>
              <p>{r.body}</p>
              {r.photo_urls && r.photo_urls.length > 0 && (
                <div className="rev-thumbs">{r.photo_urls.map((u) => <img key={u} src={u} alt="" />)}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {confirmOpen && createPortal(
        <div className="pdp-matmodal rev-confirm-overlay" onClick={() => setConfirmOpen(false)}>
          <div className="pdp-matmodal-card rev-confirm-card" onClick={(e) => e.stopPropagation()}>
            <button className="pdp-matmodal-x" type="button" aria-label="×" onClick={() => setConfirmOpen(false)}>×</button>
            <h3 className="rev-confirm-title">{t("rev.confirmTitle")}</h3>
            <p className="rev-confirm-text">{t("rev.confirmText")}</p>

            <label className="rev-opt">
              <input type="checkbox" checked={wantsEmail} onChange={(e) => setWantsEmail(e.target.checked)} />
              <span className="rev-opt-ic"><IconMail /></span>
              <span>{t("rev.optEmail")}</span>
            </label>
            <label className="rev-opt">
              <input type="checkbox" checked={wantsSms} onChange={(e) => setWantsSms(e.target.checked)} />
              <span className="rev-opt-ic"><IconPhone /></span>
              <span>{t("rev.optSms")}</span>
            </label>
            <p className="rev-opt-note">{t("rev.optNote")}</p>

            <div className="rev-confirm-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setConfirmOpen(false)} disabled={submitting}>
                {t("rev.cancel")}
              </button>
              <button className="btn btn-primary" type="button" onClick={publish} disabled={submitting}>
                {submitting ? <><span className="btn-spin" aria-hidden="true" /> {t("rev.sending")}</> : t("rev.confirmBtn")}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}

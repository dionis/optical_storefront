import { useState, useEffect } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { getUser } from "./userAuth.js";

function loadReviews(slug) {
  try { return JSON.parse(localStorage.getItem("oer_rev_" + slug)) || []; } catch { return []; }
}

function Stars({ value, onSelect }) {
  return (
    <span className="stars-input">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" className={n <= value ? "on" : ""}
                onClick={onSelect ? () => onSelect(n) : undefined} tabIndex={onSelect ? 0 : -1} aria-label={`${n}★`}>★</button>
      ))}
    </span>
  );
}

export default function Reviews({ product }) {
  const { t } = useLang();
  const [reviews, setReviews] = useState(() => loadReviews(product.slug));
  const [name, setName] = useState("");
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState([]);
  const [thanks, setThanks] = useState(false);

  useEffect(() => { setReviews(loadReviews(product.slug)); }, [product.slug]);

  // read + downscale uploaded photos to keep storage small (max ~700px, JPEG)
  const addPhotos = (files) => {
    Array.from(files).slice(0, 3).forEach((file) => {
      const rd = new FileReader();
      rd.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, 700 / Math.max(img.width, img.height));
          const c = document.createElement("canvas");
          c.width = img.width * scale; c.height = img.height * scale;
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          setPhotos((p) => [...p, c.toDataURL("image/jpeg", 0.75)].slice(0, 3));
        };
        img.src = rd.result;
      };
      rd.readAsDataURL(file);
    });
  };

  const submit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    const u = getUser();
    const r = {
      id: "rev-" + Date.now() + "-" + Math.round(Math.random() * 1e6),
      name: name.trim() || (u && u.email) || "Anónimo",
      user: (u && u.email) || null,          // ties the review to the logged-in customer
      product: product.name, slug: product.slug,
      rating, text: text.trim(), photos, date: new Date().toISOString().slice(0, 10),
    };
    const next = [r, ...reviews];
    setReviews(next);
    try { localStorage.setItem("oer_rev_" + product.slug, JSON.stringify(next)); } catch {}
    setName(""); setText(""); setRating(5); setPhotos([]);
    setThanks(true); setTimeout(() => setThanks(false), 2500);
  };

  const base = product.reviews || 0;
  const totalCount = base + reviews.length;
  const avg = totalCount
    ? ((product.rating * base + reviews.reduce((s, r) => s + r.rating, 0)) / totalCount).toFixed(1)
    : product.rating;

  return (
    <section className="section reviews">
      <h2 className="section-title">{t("rev.title")}</h2>
      <div className="rev-summary">
        <div className="rev-avg"><b>{avg}</b><Stars value={Math.round(avg)} /><small>{totalCount} {t("rev.based")}</small></div>
      </div>

      <form className="rev-form" onSubmit={submit}>
        <h3>{t("rev.write")}</h3>
        <div className="rev-row">
          <label>{t("rev.your")}: <Stars value={rating} onSelect={setRating} /></label>
        </div>
        <input className="rev-name" placeholder={t("rev.name")} value={name} onChange={(e) => setName(e.target.value)} />
        <textarea className="rev-text" placeholder={t("rev.text")} value={text} onChange={(e) => setText(e.target.value)} rows={3} />
        <div className="rev-photos">
          {photos.map((p, i) => (
            <span key={i} style={{ position: "relative" }}>
              <img src={p} alt="" className="rev-photo" />
              <button type="button" className="panel-x" style={{ position: "absolute", top: -6, right: -6 }} onClick={() => setPhotos((ph) => ph.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
          {photos.length < 3 && (
            <label className="rev-photo-add">📷 {t("rev.photo")}
              <input type="file" accept="image/*" multiple onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
            </label>
          )}
        </div>
        <button className="btn btn-primary" type="submit">{t("rev.submit")}</button>
        {thanks && <span className="rev-thanks">✓ {t("rev.thanks")}</span>}
      </form>

      <div className="rev-list">
        {reviews.length === 0 ? (
          <p className="muted">{t("rev.none")}</p>
        ) : reviews.map((r, i) => (
          <div key={i} className="rev-item">
            <div className="rev-item-head"><b>{r.name}</b><Stars value={r.rating} /><small className="muted">{r.date}</small></div>
            <p>{r.text}</p>
            {r.photos && r.photos.length > 0 && (
              <div className="rev-thumbs">{r.photos.map((p, j) => <img key={j} src={p} alt="" />)}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

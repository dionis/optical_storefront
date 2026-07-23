import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { CASE_BY_SLUG, recommendedCases } from "../data/cases.js";
import CaseCard from "../components/CaseCard.jsx";
import Reviews from "../components/Reviews.jsx";
import { useCart } from "../components/CartContext.jsx";
import { useLang } from "../i18n/LanguageContext.jsx";

export default function CaseDetail() {
  const { slug } = useParams();
  const item = CASE_BY_SLUG[slug];
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [added, setAdded] = useState(false);
  const { addItem, toggleFav, isFav } = useCart();
  const { t } = useLang();

  if (!item) {
    return <div className="section"><p>{t("notfound")} <Link to="/marca/case">{t("notfound.link")}</Link></p></div>;
  }

  const color = item.colors[active];
  const others = recommendedCases(item.sku, 3).filter((c) => c.slug !== item.slug).slice(0, 3);
  const multi = item.colors.length > 1;

  const add = () => {
    addItem({ sku: item.sku, name: item.name, color: multi ? color.name : undefined, total: item.price, isCase: true });
    setAdded(true);
    setTimeout(() => setAdded(false), 1600);
  };

  return (
    <div className="pdp">
      <div className="breadcrumb">
        <Link to="/">{t("pdp.home")}</Link> / <Link to="/marca/case">{t("nav.cases")}</Link> / <span>{item.name}</span>
      </div>

      <div className="pdp-grid">
        <div className="pdp-gallery">
          <div className={`pdp-main ${zoom ? "zoom" : ""}`} onClick={() => setZoom((z) => !z)}>
            <button className={`heart ${isFav(item.slug) ? "on" : ""}`}
                    onClick={(e) => { e.stopPropagation(); toggleFav({ slug: item.slug, name: item.name, price: item.price, image: color.image, brand: item.brand, isCase: true }); }}
                    aria-label={t("a11y.fav")}>{isFav(item.slug) ? "♥" : "♡"}</button>
            <img key={color.image} src={color.image} alt={`${item.name} ${color.name}`} className="fade-in"
                 onError={(e) => { e.currentTarget.style.opacity = 0.3; }} />
          </div>
          {multi && (
            <div className="pdp-thumbs">
              {item.colors.map((c, i) => (
                <button key={c.name} className={`pdp-thumb ${i === active ? "sel" : ""}`} onClick={() => setActive(i)}>
                  <img src={c.image} alt={c.name} onError={(e) => { e.currentTarget.style.opacity = 0.3; }} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="pdp-info">
          <div className="pdp-brand">{t("nav.cases")}</div>
          <h1 className="pdp-title">{item.name}</h1>
          <div className="pdp-meta">
            <span className="stars">★ {item.rating}</span>
            <span className="muted">· {item.reviews} {t("pdp.reviews")}</span>
          </div>
          <div className="pdp-price">${item.price.toFixed(2)}</div>

          {multi && (
            <div className="pdp-color-row">
              <span className="lbl">{t("pdp.color")}: <b>{color.name}</b></span>
              <div className="swatches lg">
                {item.colors.map((c, i) => (
                  <button key={c.name} className={`swatch ${i === active ? "sel" : ""}`} style={{ background: c.hex }}
                          title={c.name} onClick={() => setActive(i)} aria-label={c.name} />
                ))}
              </div>
            </div>
          )}

          <div className="pdp-actions">
            <button className={`btn btn-primary big ${added ? "done" : ""}`} onClick={add}>
              {added ? "✓ " + t("case.added") : `${t("common.addCart")} · $${item.price.toFixed(2)}`}
            </button>
          </div>

          <table className="specs">
            <tbody>
              <tr><td>{t("spec.brand")}</td><td>{t("nav.cases")}</td></tr>
              {item.material && <tr><td>{t("spec.material")}</td><td>{item.material}</td></tr>}
              <tr><td>{t("case.colorsN")}</td><td>{item.colors.length}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <Reviews product={item} />

      {others.length > 0 && (
        <section className="section">
          <h2 className="section-title">{t("case.more")}</h2>
          <div className="case-grid three">
            {others.map((c) => <CaseCard key={c.slug} item={c} compact />)}
          </div>
        </section>
      )}
    </div>
  );
}

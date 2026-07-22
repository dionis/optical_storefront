import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { PRODUCT_BY_SLUG, PRODUCTS } from "../data/products.js";
import { recommendedCases } from "../data/cases.js";
import ProductCard from "../components/ProductCard.jsx";
import CaseCard from "../components/CaseCard.jsx";
import { useCart } from "../components/CartContext.jsx";
import { useLang } from "../i18n/LanguageContext.jsx";

export default function ProductDetail() {
  const { slug } = useParams();
  const product = PRODUCT_BY_SLUG[slug];
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState(false);
  const { addItem } = useCart();
  const { t, tv } = useLang();
  const navigate = useNavigate();

  if (!product) {
    return <div className="section"><p>{t("notfound")} <Link to="/catalogo">{t("notfound.link")}</Link></p></div>;
  }

  const color = product.colors[active];
  const related = PRODUCTS.filter((p) => p.brand_slug === product.brand_slug && p.slug !== product.slug).slice(0, 4);
  const cases = recommendedCases(product.sku, 3);

  return (
    <div className="pdp">
      <div className="breadcrumb">
        <Link to="/">{t("pdp.home")}</Link> / <Link to={`/marca/${product.brand_slug}`}>{product.brand}</Link> / <span>{product.name}</span>
      </div>

      <div className="pdp-grid">
        <div className="pdp-gallery">
          <div className={`pdp-main ${zoom ? "zoom" : ""}`} onClick={() => setZoom((z) => !z)}>
            <img key={color.image} src={color.image} alt={`${product.name} ${color.name}`} className="fade-in"
                 onError={(e)=>{e.currentTarget.style.opacity=0.3;}} />
            <span className="pdp-ar">◈ {t("card.ar")}</span>
          </div>
          <div className="pdp-thumbs">
            {product.colors.map((c, i) => (
              <button key={c.name} className={`pdp-thumb ${i === active ? "sel" : ""}`} onClick={() => setActive(i)}>
                <img src={c.image} alt={c.name} onError={(e)=>{e.currentTarget.style.opacity=0.3;}} />
              </button>
            ))}
          </div>
        </div>

        <div className="pdp-info">
          <div className="pdp-brand">{product.brand}</div>
          <h1 className="pdp-title">{product.name}</h1>
          <div className="pdp-meta">
            <span className="stars">★ {product.rating}</span>
            <span className="muted">· {product.reviews} {t("pdp.reviews")}</span>
          </div>
          <div className="pdp-price">${product.price.toFixed(2)} <span className="muted small">{t("pdp.lensesFrom")}</span></div>

          <div className="pdp-color-row">
            <span className="lbl">{t("pdp.color")}: <b>{color.name}</b></span>
            <div className="swatches lg">
              {product.colors.map((c, i) => (
                <button key={c.name} className={`swatch ${i === active ? "sel" : ""}`} style={{ background: c.hex }}
                        title={c.name} onClick={() => setActive(i)} aria-label={c.name} />
              ))}
            </div>
          </div>

          <div className="pdp-actions">
            <button className="btn btn-primary big" onClick={() => navigate(`/recetas/${product.slug}?color=${active}`)}>
              {t("pdp.selectLens")}
            </button>
            <button className="btn btn-outline big" onClick={() => addItem({ sku: product.sku, name: product.name, color: color.name, total: product.price })}>
              {t("pdp.addFrame")} · ${product.price.toFixed(2)}
            </button>
          </div>

          <table className="specs">
            <tbody>
              <tr><td>{t("spec.brand")}</td><td>{product.brand}</td></tr>
              <tr><td>{t("spec.shape")}</td><td>{tv(product.attributes.shape) || "—"}</td></tr>
              <tr><td>{t("spec.material")}</td><td>{product.attributes.material.map(tv).join(", ")}</td></tr>
              <tr><td>{t("spec.gender")}</td><td>{tv(product.attributes.gender)}</td></tr>
              <tr><td>{t("spec.age")}</td><td>{tv(product.attributes.age)}</td></tr>
              <tr><td>{t("spec.eye")}</td><td>{product.attributes.eye_size}</td></tr>
              <tr><td>{t("spec.bridge")}</td><td>{product.attributes.bridge_size}</td></tr>
              <tr><td>{t("spec.temple")}</td><td>{product.attributes.temple_length}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Cross-sell: recommended cases */}
      <section className="section case-cross">
        <div className="case-cross-head">
          <h2 className="section-title">{t("case.recommend")}</h2>
          <span className="muted">{t("case.recommendSub")}</span>
        </div>
        <div className="case-grid three">
          {cases.map((c) => <CaseCard key={c.slug} item={c} compact />)}
        </div>
      </section>

      {related.length > 0 && (
        <section className="section">
          <h2 className="section-title">{t("pdp.moreOf")} {product.brand}</h2>
          <div className="product-grid">
            {related.map((p) => <ProductCard key={p.slug} product={p} />)}
          </div>
        </section>
      )}
    </div>
  );
}

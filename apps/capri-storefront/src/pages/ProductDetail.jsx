import { useState, useEffect, lazy, Suspense } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { trackView } from "../admin/analytics.js";
import { useCatalog, recommendedCases, matchProduct } from "../data/catalogStore.js";
import ProductCard from "../components/ProductCard.jsx";
import CaseCard from "../components/CaseCard.jsx";
import Reviews from "../components/Reviews.jsx";
// Carga diferida: el probador arrastra three.js y no debe pesar en la PDP.
const TryOn = lazy(() => import("../components/TryOn.jsx"));
import { useCart } from "../components/CartContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { useLang } from "../i18n/LanguageContext.jsx";
import { TRY_ON_ENABLED } from "../config/features.js";
import { frameMatEdu } from "../data/lensEducation.js";
import { IconMontura } from "../components/LensGraphics.jsx";
import GlassesLoader from "../components/GlassesLoader.jsx";
import { useReviewSummary } from "../components/ReviewSummaryContext.jsx";

export default function ProductDetail() {
  const { slug } = useParams();
  const { products: PRODUCTS, productBySlug, loading } = useCatalog();
  const product = matchProduct(slug, productBySlug, PRODUCTS);
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [tryOn, setTryOn] = useState(false);
  const { addVariant, toggleFav, isFav, busy } = useCart();
  const { toast } = useFeedback();
  const { t, tv, lang } = useLang();
  const navigate = useNavigate();
  // Hook order matters: this must run before the `if (!product)` early return,
  // or React sees a different hook count between renders and crashes.
  const review = useReviewSummary(slug);
  useEffect(() => { if (product) try { trackView(); } catch {} }, [slug]);

  // Add the frame at its base price via the server cart (no local total).
  const addFrame = async (variantId) => {
    if (!variantId) { toast({ tone: "info", message: t("cart.noVariant") }); return; }
    try { await addVariant(variantId); toast({ tone: "success", message: t("common.addCart") }); }
    catch { toast({ tone: "error", message: t("cart.addError") }); }
  };

  if (!product) {
    // Deep-link / refresh guard: the live catalog (and this slug) only exists once
    // the startup load settles. While it's in flight, show a loader instead of a
    // false "not found"; only reject once loading has finished and the slug is
    // genuinely absent.
    if (loading) {
      return (
        <div className="section">
          <GlassesLoader />
        </div>
      );
    }
    return <div className="section"><p>{t("notfound")} <Link to="/catalogo">{t("notfound.link")}</Link></p></div>;
  }

  const color = product.colors[active];
  const related = PRODUCTS.filter((p) => p.brand_slug === product.brand_slug && p.slug !== product.slug).slice(0, 4);
  const cases = recommendedCases(product.sku, 3);

  // Requisito 6: info comercial del marco al abrirlo.
  //  - número de serie (modelo) = SKU; colección/marca = brand.
  //  - material del marco + explicación de calidad (para qué sirve / para qué no)
  //    con la copia comercial bilingüe de FRAME_MATERIAL_EDU.
  const frameMaterials = product.attributes.material || [];
  // Primer material del marco que tenga copia educativa disponible.
  const eduMaterial = frameMaterials.find((m) => frameMatEdu(m, lang)) || frameMaterials[0];
  const frameEdu = eduMaterial ? frameMatEdu(eduMaterial, lang) : null;

  return (
    <div className="pdp">
      <div className="breadcrumb">
        <Link to="/">{t("pdp.home")}</Link> / <Link to={`/marca/${product.brand_slug}`}>{product.brand}</Link> / <span>{product.name}</span>
      </div>

      <div className="pdp-grid">
        <div className="pdp-gallery">
          <div className={`pdp-main zlx-float ${zoom ? "zoom" : ""}`} onClick={() => setZoom((z) => !z)}>
            <button className={`heart ${isFav(product.slug) ? "on" : ""}`}
                    onClick={(e) => { e.stopPropagation(); toggleFav({ slug: product.slug, name: product.name, price: product.price, image: color.image, brand: product.brand, variantId: (product.colors[0] || {}).variantId }); }}
                    aria-label={t("a11y.fav")}>{isFav(product.slug) ? "♥" : "♡"}</button>
            <img key={color.image} src={color.image} alt={`${product.name} ${color.name}`} className="fade-in"
                 onError={(e)=>{e.currentTarget.style.opacity=0.3;}} />
            {TRY_ON_ENABLED && (
              <button className="pdp-ar" onClick={(e) => { e.stopPropagation(); setTryOn(true); }}>◈ {t("card.ar")}</button>
            )}
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

          {/* Requisito 6: ficha comercial del marco al abrirlo. */}
          <div className="frame-id">
            <span className="frame-id-chip"><span className="frame-id-k">{t("frame.model")}</span> {product.sku}</span>
            <span className="frame-id-chip"><span className="frame-id-k">{t("frame.collection")}</span> {product.brand}</span>
            {frameMaterials.length > 0 && (
              <span className="frame-id-chip"><IconMontura className="frame-id-ic" size={16} aria-hidden="true" /><span className="frame-id-k">{t("frame.material")}</span> {frameMaterials.map(tv).join(" · ")}</span>
            )}
          </div>
          {/* Real reviews only. `product.rating`/`product.reviews` are numbers
              the scraper's filler generates for presentation; showing them here
              put a review score on frames nobody had ever reviewed. */}
          <div className="pdp-meta">
            {review ? (
              <>
                <span className="stars">★ {review.average.toFixed(1)}</span>
                <span className="muted">· {review.count} {t("pdp.reviews")}</span>
              </>
            ) : (
              <span className="muted">{t("rev.none")}</span>
            )}
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
            <button className="btn btn-outline big" disabled={busy || !color.variantId}
                    onClick={() => addFrame(color.variantId)}>
              {t("pdp.addFrame")} · ${product.price.toFixed(2)}
            </button>
          </div>
          {TRY_ON_ENABLED && (
            <button className="pdp-tryon-btn" onClick={() => setTryOn(true)}>📷 {t("tryon.cta")}</button>
          )}

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

          {/* Requisito 6: educación de calidad del material del marco. */}
          {frameEdu && (
            <div className="frame-quality">
              <div className="frame-quality-head">
                <IconMontura className="frame-quality-ic" size={20} aria-hidden="true" />
                <b>{t("frame.qualityTitle")}: {tv(eduMaterial)}</b>
              </div>
              {frameEdu.quality && <p className="frame-quality-lead">{frameEdu.quality}</p>}
              <ul className="frame-quality-list">
                <li className="good"><span aria-hidden>✓</span> <span><b>{t("frame.goodFor")}:</b> {frameEdu.good}</span></li>
                <li className="bad"><span aria-hidden>✕</span> <span><b>{t("frame.badFor")}:</b> {frameEdu.bad}</span></li>
              </ul>
            </div>
          )}
        </div>
      </div>

      <Reviews product={product} />

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

      {TRY_ON_ENABLED && tryOn && (
        <Suspense fallback={null}>
          <TryOn product={product} colorIdx={active} onClose={() => setTryOn(false)} />
        </Suspense>
      )}
    </div>
  );
}

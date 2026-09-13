import { useState } from "react";
import { Link } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useCart } from "./CartContext.jsx";
import { useFeedback } from "./Feedback.jsx";
import { TRY_ON_ENABLED } from "../config/features.js";
import { useReviewSummary } from "./ReviewSummaryContext.jsx";
// Probador: el switch elige la interfaz (prod / dev-respaldo / legacy). Ver TryOnSwitch.jsx.
import TryOn from "./TryOnSwitch.jsx";
// Abrir/cerrar vive fuera de este componente: sobrevive al remount que sufre esta
// card cuando el catálogo pasa de seed a Medusa a mitad de sesión (ver tryOnState.js).
import { openTryOn, closeTryOn, useTryOnOpenKey, productTryOnKey } from "../data/tryOnState.js";
// Indicador "360°": esta montura ya tiene las 4 vistas 3D generadas (galería).
import { viewsBySku } from "../data/frameMediaSample.js";

// Tarjeta de producto — rediseño "montura protagonista":
//  - La FOTO manda; sobre ella solo el corazón (y el sello 360° si aplica).
//  - Debajo: nombre + valoración, marca · forma, puntos de color, precio (azul
//    oscuro; rojo solo en oferta).
//  - Acción principal AZUL "Probármelos" (probador con cámara) y, más discreta,
//    "Añadir al carrito". Primero invitamos a verse la montura, luego a comprar.
export default function ProductCard({ product }) {
  const [active, setActive] = useState(0);
  const tryOnOpenKey = useTryOnOpenKey();
  const tryOn = tryOnOpenKey !== null && tryOnOpenKey === productTryOnKey(product);
  const [added, setAdded] = useState(false);
  const { t, tv } = useLang();
  const { toggleFav, isFav, addVariant, busy } = useCart();
  const { toast } = useFeedback();
  const color = product.colors[active];
  const fav = isFav(product.slug);
  // ¿Esta montura ya tiene las 4 vistas 3D generadas? → muestra el sello "360°".
  const hasViews = !!viewsBySku(product.sku);

  // Valoración: usamos las reseñas REALES de la tienda si existen; si no, el dato
  // del catálogo del proveedor. Solo se muestra cuando hay un nº de reseñas > 0,
  // para no inventar estrellas en monturas sin reseñas.
  const review = useReviewSummary(product.slug);
  const ratingVal = review ? review.average : (typeof product.rating === "number" ? product.rating : 0);
  const reviewCount = review ? review.count : (typeof product.reviews === "number" ? product.reviews : 0);
  const showRating = reviewCount > 0 && ratingVal > 0;

  // Oferta: precio anterior tachado + precio en rojo + etiqueta, solo si el
  // precio anterior es mayor que el actual.
  const hasSale = typeof product.originalPrice === "number" && product.originalPrice > product.price;

  // Solo-montura al carrito. Sin variantId no hay compra real: avisamos en vez
  // de simular un carrito local (el precio siempre sale del servidor).
  const addFrameOnly = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!color?.variantId) { toast({ tone: "info", message: t("cart.noVariant") }); return; }
    try {
      await addVariant(color.variantId);
      setAdded(true);
      setTimeout(() => setAdded(false), 1400);
      toast({ tone: "success", message: t("common.addCart") });
    } catch { toast({ tone: "error", message: t("cart.addError") }); }
  };

  const pickColor = (e, i) => { e.preventDefault(); e.stopPropagation(); setActive(i); };

  return (
    <div className="card">
      <div className="card-media">
        {/* Sello 360°: la montura ya tiene las 4 vistas 3D generadas. */}
        {hasViews && (
          <span className="card-badge-360" title={t("pdp.has3d")}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7" /><polyline points="21 3 21 9 15 9" /></svg>
            360°
          </span>
        )}
        {/* Única acción sobre la foto: favorito. Todo lo demás va debajo. */}
        <div className="card-actions">
          <button
            className={`card-ic card-ic-fav ${fav ? "on" : ""}`}
            onClick={() => toggleFav({ slug: product.slug, name: product.name, price: product.price, image: color.image, brand: product.brand, variantId: color.variantId })}
            aria-label={t("a11y.fav")} title={t("a11y.fav")}
          >
            {fav ? "♥" : "♡"}
          </button>
        </div>
        <Link to={`/recetas/${product.slug}?color=${active}`} className="card-img-link" aria-label={product.name}>
          <img src={color.image} alt={`${product.name} ${color.name}`} loading="lazy"
               onError={(e) => { e.currentTarget.style.opacity = 0.25; }} />
        </Link>
      </div>
      {TRY_ON_ENABLED && tryOn && (
        <TryOn product={product} colorIdx={active} onClose={closeTryOn} />
      )}

      <div className="card-body">
        <div className="card-row">
          <Link to={`/recetas/${product.slug}?color=${active}`} className="card-name">{product.name}</Link>
          {showRating && (
            <span className="card-rating" aria-label={`${ratingVal.toFixed(1)} / 5`}>
              <span className="card-star" aria-hidden="true">★</span>
              {ratingVal.toFixed(1)}
              <span className="card-reviews">({reviewCount})</span>
            </span>
          )}
        </div>
        <div className="card-sub">{product.brand} · {tv(product.attributes?.shape || "Montura")}</div>

        <div className="card-meta">
          <div className="card-colors">
            <span className="card-dots">
              {product.colors.slice(0, 4).map((c, i) => (
                <button key={c.name} type="button"
                        className={`card-dot ${i === active ? "sel" : ""}`} style={{ background: c.hex }}
                        title={c.name} onMouseEnter={() => setActive(i)} onClick={(e) => pickColor(e, i)}
                        aria-label={c.name} />
              ))}
            </span>
            <span className="card-colors-n">
              {product.colors.length} {product.colors.length === 1 ? t("card.color") : t("card.colors")}
            </span>
          </div>
          <span className="card-price-wrap">
            {hasSale && <span className="card-price-old">${product.originalPrice.toFixed(2)}</span>}
            <span className={`card-price ${hasSale ? "sale" : ""}`}>${product.price.toFixed(2)}</span>
          </span>
        </div>
        {hasSale && <span className="card-oferta">{t("card.sale")}</span>}

        {/* Acción principal: probador con cámara. Diferencia la tienda — primero
            invitamos a verse la montura, después a comprar. */}
        {TRY_ON_ENABLED && (
          <button type="button" className="card-tryon" onClick={() => openTryOn(product)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
            {t("card.tryOn")}
          </button>
        )}
        {/* Acción secundaria: añadir SOLO la montura al carrito. */}
        <button
          type="button"
          className={`card-add-cart ${added ? "done" : ""}`}
          disabled={busy || !color.variantId}
          onClick={addFrameOnly}
        >
          {added ? (
            <>✓ {t("case.added")}</>
          ) : (
            <>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" /></svg>
              {t("card.addToCart")}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useCart } from "./CartContext.jsx";
import { useFeedback } from "./Feedback.jsx";
import { TRY_ON_ENABLED } from "../config/features.js";
import { useReviewSummary } from "./ReviewSummaryContext.jsx";
// Probador: el switch elige la interfaz (prod / dev-respaldo / legacy). Ver TryOnSwitch.jsx.
import TryOn from "./TryOnSwitch.jsx";

// Requisito 11 (tarjetas estilo Amazon):
//  - "Añadir al carrito" añade SOLO LA MONTURA (addVariant, precio base servidor).
//  - Al hover aparece un icono "Comprar" que lleva al flujo completo de compra
//    (/recetas/:slug) — receta + material + tratamientos, no al carrito.
//  - Clic en el espejuelo = abrir el marco (PDP), donde también arranca el flujo.
export default function ProductCard({ product }) {
  const [active, setActive] = useState(0);
  const [tryOn, setTryOn] = useState(false);
  const [added, setAdded] = useState(false);
  const { t, tv } = useLang();
  const { toggleFav, isFav, addVariant, busy } = useCart();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const color = product.colors[active];
  const fav = isFav(product.slug);
  // null until somebody actually reviews this frame.
  const review = useReviewSummary(product.slug);

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

  // "Comprar" = flujo completo de compra (receta → material → tratamientos).
  const buyNow = (e) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(`/recetas/${product.slug}?color=${active}`);
  };

  return (
    <div className="card">
      <div className="card-media">
        <button
          className={`heart ${fav ? "on" : ""}`}
          onClick={() => toggleFav({ slug: product.slug, name: product.name, price: product.price, image: color.image, brand: product.brand, variantId: color.variantId })}
          aria-label={t("a11y.fav")}
        >
          {fav ? "♥" : "♡"}
        </button>
        <Link to={`/recetas/${product.slug}?color=${active}`} className="card-img-link" aria-label={product.name}>
          <img src={color.image} alt={`${product.name} ${color.name}`} loading="lazy"
               onError={(e) => { e.currentTarget.style.opacity = 0.25; }} />
        </Link>

        {/* Icono "Comprar" que aparece al hover: lleva al flujo completo. */}
        <button type="button" className="buy-pill" onClick={buyNow} aria-label={t("card.buy")}>
          <span aria-hidden>🛒</span> {t("card.buy")}
        </button>

        {TRY_ON_ENABLED && (
          <button type="button" className="ar-pill" onClick={() => setTryOn(true)}>
            <span aria-hidden>◈</span> {t("card.ar")}
          </button>
        )}
      </div>
      {TRY_ON_ENABLED && tryOn && (
        <TryOn product={product} colorIdx={active} onClose={() => setTryOn(false)} />
      )}

      <div className="card-body">
        <div className="card-row">
          <Link to={`/recetas/${product.slug}?color=${active}`} className="card-name">{product.name}</Link>
          <span className="card-price">${product.price.toFixed(2)}</span>
          {/* Only a rating real customers gave. This used to print
              `product.rating`, a number the scraper's filler invented for every
              frame — so all 549 showed a review score nobody had written. */}
          {review && <span className="card-rating">★ {review.average.toFixed(1)}</span>}
        </div>
        <div className="card-sub">{product.brand} · {tv(product.attributes.shape || "Montura")}</div>

        <div className="swatches">
          {product.colors.map((c, i) => (
            <button key={c.name} className={`swatch ${i === active ? "sel" : ""}`} style={{ background: c.hex }}
                    title={c.name} onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} aria-label={c.name} />
          ))}
        </div>

        {/* Añadir SOLO la montura al carrito (estilo Amazon). */}
        <button
          type="button"
          className={`card-add ${added ? "done" : ""}`}
          disabled={busy || !color.variantId}
          onClick={addFrameOnly}
        >
          {added ? "✓ " + t("case.added") : "+ " + t("card.addFrameOnly")}
        </button>
      </div>
    </div>
  );
}

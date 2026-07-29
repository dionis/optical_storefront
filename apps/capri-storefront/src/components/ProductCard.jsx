import { useState, lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { useLang } from "../i18n/LanguageContext.jsx";
import { useCart } from "./CartContext.jsx";
import { TRY_ON_ENABLED } from "../config/features.js";

// El probador arrastra three.js (~560 kB). Se carga sólo al abrirlo, no en
// cada listado de producto.
const TryOn = lazy(() => import("./TryOn.jsx"));

export default function ProductCard({ product }) {
  const [active, setActive] = useState(0);
  const [tryOn, setTryOn] = useState(false);
  const { t, tv } = useLang();
  const { toggleFav, isFav } = useCart();
  const color = product.colors[active];
  const fav = isFav(product.slug);

  return (
    <div className="card">
      <div className="card-media">
        <button
          className={`heart ${fav ? "on" : ""}`}
          onClick={() => toggleFav({ slug: product.slug, name: product.name, price: product.price, image: color.image, brand: product.brand })}
          aria-label={t("a11y.fav")}
        >
          {fav ? "♥" : "♡"}
        </button>
        <Link to={`/producto/${product.slug}`} className="card-img-link">
          <img src={color.image} alt={`${product.name} ${color.name}`} loading="lazy"
               onError={(e) => { e.currentTarget.style.opacity = 0.25; }} />
        </Link>
        {TRY_ON_ENABLED && (
          <button type="button" className="ar-pill" onClick={() => setTryOn(true)}>
            <span aria-hidden>◈</span> {t("card.ar")}
          </button>
        )}
      </div>
      {TRY_ON_ENABLED && tryOn && (
        <Suspense fallback={null}>
          <TryOn product={product} colorIdx={active} onClose={() => setTryOn(false)} />
        </Suspense>
      )}

      <div className="card-body">
        <div className="card-row">
          <Link to={`/producto/${product.slug}`} className="card-name">{product.name}</Link>
          <span className="card-price">${product.price.toFixed(2)}</span>
          <span className="card-rating">★ {product.rating}</span>
        </div>
        <div className="card-sub">{product.brand} · {tv(product.attributes.shape || "Montura")}</div>

        <div className="swatches">
          {product.colors.map((c, i) => (
            <button key={c.name} className={`swatch ${i === active ? "sel" : ""}`} style={{ background: c.hex }}
                    title={c.name} onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} aria-label={c.name} />
          ))}
        </div>
      </div>
    </div>
  );
}

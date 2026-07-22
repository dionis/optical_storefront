import { useState } from "react";
import { Link } from "react-router-dom";

export default function ProductCard({ product }) {
  const [active, setActive] = useState(0);
  const [fav, setFav] = useState(false);
  const color = product.colors[active];

  return (
    <div className="card">
      <div className="card-media">
        <button
          className={`heart ${fav ? "on" : ""}`}
          onClick={() => setFav((v) => !v)}
          aria-label="Añadir a favoritos"
        >
          {fav ? "♥" : "♡"}
        </button>
        <Link to={`/producto/${product.slug}`} className="card-img-link">
          <img
            src={color.image}
            alt={`${product.name} ${color.name}`}
            loading="lazy"
            onError={(e) => { e.currentTarget.style.opacity = 0.25; }}
          />
        </Link>
        <Link to={`/producto/${product.slug}`} className="ar-pill">
          <span aria-hidden>◈</span> Probador AR
        </Link>
      </div>

      <div className="card-body">
        <div className="card-row">
          <Link to={`/producto/${product.slug}`} className="card-name">{product.name}</Link>
          <span className="card-price">${product.price.toFixed(2)}</span>
          <span className="card-rating">★ {product.rating}</span>
        </div>
        <div className="card-sub">{product.brand} · {product.attributes.shape || "Montura"}</div>

        <div className="swatches">
          {product.colors.map((c, i) => (
            <button
              key={c.name}
              className={`swatch ${i === active ? "sel" : ""}`}
              style={{ background: c.hex }}
              title={c.name}
              onMouseEnter={() => setActive(i)}
              onClick={() => setActive(i)}
              aria-label={c.name}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

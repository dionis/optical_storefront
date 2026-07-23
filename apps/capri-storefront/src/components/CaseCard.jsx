import { useState } from "react";
import { Link } from "react-router-dom";
import { useCart } from "./CartContext.jsx";
import { useLang } from "../i18n/LanguageContext.jsx";

export default function CaseCard({ item, compact = false }) {
  const { addItem, toggleFav, isFav } = useCart();
  const { t } = useLang();
  const [active, setActive] = useState(0);
  const [added, setAdded] = useState(false);
  const color = item.colors[active];
  const to = `/estuche/${item.slug}`;

  const add = (e) => {
    e.preventDefault();
    addItem({ sku: item.sku, name: item.name, color: item.colors.length > 1 ? color.name : undefined, total: item.price, isCase: true });
    setAdded(true);
    setTimeout(() => setAdded(false), 1400);
  };

  const fav = (e) => {
    e.preventDefault();
    toggleFav({ slug: item.slug, name: item.name, price: item.price, image: color.image, brand: item.brand, isCase: true });
  };

  return (
    <Link to={to} className={`case-card ${compact ? "compact" : ""}`}>
      <div className="case-media">
        <button className={`heart ${isFav(item.slug) ? "on" : ""}`} onClick={fav} aria-label={t("a11y.fav")}>
          {isFav(item.slug) ? "♥" : "♡"}
        </button>
        <img key={color.image} src={color.image} alt={item.name} loading="lazy" className="fade-in"
             onError={(e) => { e.currentTarget.style.opacity = 0.25; }} />
      </div>
      <div className="case-body">
        <div className="case-name">{item.name}</div>
        {item.material && <div className="case-mat">{item.material}</div>}
        {item.colors.length > 1 && (
          <div className="swatches">
            {item.colors.map((c, i) => (
              <button key={c.name} className={`swatch ${i === active ? "sel" : ""}`} style={{ background: c.hex }}
                      title={c.name} onMouseEnter={(e) => { e.preventDefault(); setActive(i); }}
                      onClick={(e) => { e.preventDefault(); setActive(i); }} aria-label={c.name} />
            ))}
          </div>
        )}
        <div className="case-row">
          <span className="case-price">${item.price.toFixed(2)}</span>
          <button className={`case-add ${added ? "done" : ""}`} onClick={add}>
            {added ? "✓ " + t("case.added") : "+ " + t("case.add")}
          </button>
        </div>
      </div>
    </Link>
  );
}

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCart } from "./CartContext.jsx";
import { useFeedback } from "./Feedback.jsx";
import { useLang } from "../i18n/LanguageContext.jsx";

// Requisito 11 (tarjeta estilo Amazon): "Añadir al carrito" para el estuche y,
// al hover, un icono "Comprar" que lleva directo a comprar. Un estuche no tiene
// flujo de receta, así que "Comprar" = añadirlo y pasar al checkout.
export default function CaseCard({ item, compact = false }) {
  const { addVariant, toggleFav, isFav, busy } = useCart();
  const { toast } = useFeedback();
  const { t } = useLang();
  const navigate = useNavigate();
  const [active, setActive] = useState(0);
  const [added, setAdded] = useState(false);
  const color = item.colors[active];
  const to = `/estuche/${item.slug}`;

  const add = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!color?.variantId) { toast({ tone: "info", message: t("cart.noVariant") }); return; }
    try {
      await addVariant(color.variantId);
      setAdded(true);
      setTimeout(() => setAdded(false), 1400);
    } catch { toast({ tone: "error", message: t("cart.addError") }); }
  };

  // "Comprar" (hover): añade el estuche y pasa directo al checkout.
  const buyNow = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!color?.variantId) { toast({ tone: "info", message: t("cart.noVariant") }); return; }
    try {
      await addVariant(color.variantId);
      navigate("/checkout");
    } catch { toast({ tone: "error", message: t("cart.addError") }); }
  };

  const fav = (e) => {
    e.preventDefault();
    toggleFav({ slug: item.slug, name: item.name, price: item.price, image: color.image, brand: item.brand, isCase: true, variantId: color?.variantId });
  };

  return (
    <Link to={to} className={`case-card ${compact ? "compact" : ""}`}>
      <div className="case-media">
        <button className={`heart ${isFav(item.slug) ? "on" : ""}`} onClick={fav} aria-label={t("a11y.fav")}>
          {isFav(item.slug) ? "♥" : "♡"}
        </button>
        <img key={color.image} src={color.image} alt={item.name} loading="lazy" className="fade-in"
             onError={(e) => { e.currentTarget.style.opacity = 0.25; }} />
        <button type="button" className="buy-pill" onClick={buyNow} aria-label={t("card.buy")}>
          <span aria-hidden>🛒</span> {t("card.buy")}
        </button>
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

import { useState } from "react";
import { Link } from "react-router-dom";
import { useCart } from "./CartContext.jsx";
import { useFeedback } from "./Feedback.jsx";
import { useLang } from "../i18n/LanguageContext.jsx";
import { IconHeart } from "./UiIcons.jsx";

// Tarjeta de ESTUCHE con la MISMA estetica que la card de catalogo (.card), en
// cualquier tamano de ventana. Un estuche no tiene probador, asi que solo lleva
// "Anadir al carrito" (misma accion secundaria de la card de montura).
export default function CaseCard({ item }) {
  const { addVariant, toggleFav, isFav, busy } = useCart();
  const { toast } = useFeedback();
  const { t, lang } = useLang();
  const [active, setActive] = useState(0);
  const [added, setAdded] = useState(false);
  const color = item.colors[active];
  const fav = isFav(item.slug);
  const to = `/estuche/${item.slug}`;
  const kind = item.material || (lang === "en" ? "Case" : "Estuche");

  const add = async (e) => {
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

  const pick = (e, i) => { e.preventDefault(); e.stopPropagation(); setActive(i); };

  return (
    <div className="card card-case">
      <div className="card-media">
        <div className="card-actions">
          <button
            className={`card-ic card-ic-fav ${fav ? "on" : ""}`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFav({ slug: item.slug, name: item.name, price: item.price, image: color.image, brand: item.brand, isCase: true, variantId: color?.variantId }); }}
            aria-label={t("a11y.fav")} title={t("a11y.fav")}
          >
            <IconHeart className="card-fav-ic" filled={fav} />
          </button>
        </div>
        <Link to={to} className="card-img-link" aria-label={item.name}>
          <img key={color.image} src={color.image} alt={item.name} loading="lazy" className="fade-in"
               onError={(e) => { e.currentTarget.style.opacity = 0.25; }} />
        </Link>
      </div>

      <div className="card-body">
        <div className="card-row">
          <Link to={to} className="card-name">{item.name}</Link>
        </div>
        <div className="card-sub">{kind}</div>

        <div className="card-meta">
          {item.colors.length > 1 ? (
            <div className="card-colors">
              <span className="card-dots">
                {item.colors.slice(0, 4).map((c, i) => (
                  <button key={c.name} type="button"
                          className={`card-dot ${i === active ? "sel" : ""}`} style={{ background: c.hex }}
                          title={c.name} onMouseEnter={() => setActive(i)} onClick={(e) => pick(e, i)}
                          aria-label={c.name} />
                ))}
              </span>
              <span className="card-colors-n">
                {item.colors.length} {item.colors.length === 1 ? t("card.color") : t("card.colors")}
              </span>
            </div>
          ) : <span />}
          <span className="card-price-wrap">
            <span className="card-price">${item.price.toFixed(2)}</span>
          </span>
        </div>

        <button
          type="button"
          className={`card-add-cart ${added ? "done" : ""}`}
          disabled={busy || !color.variantId}
          onClick={add}
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

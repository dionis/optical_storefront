// Dónde se usa: catálogo (grid), portada (Best sellers), PDP (Más de la marca) y favoritos. Tarjeta reutilizable por props (product); botones Probármelos (cámara dorada de la lámina de marca) y Añadir al carrito (carrito navy).
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
// Derivadas redimensionadas de la foto de producto (ver imageUrl.js): la
// rejilla no necesita el original de 35 KB por tarjeta.
import { resolveImageSized, imageSrcSet } from "../data/imageUrl.js";
import { viewsBySku } from "../data/frameMediaSample.js";
import { useFrameMediaVersion } from "../data/frameMediaLive.js";
import { Icon360, IconHeart, IconDiscount, IconGender, IconFemale, IconUnisex, IconKids } from "./UiIcons.jsx";
import { DISCOUNTS_ENABLED } from "../config/features.js";

// (El descuento por hash se eliminó: el precio tachado ahora es SIEMPRE el
// `originalPrice` real del catálogo — mostrar una rebaja inventada contradice
// el principio de que el precio lo dicta el servidor.)

// Tarjeta de producto — rediseño "montura protagonista":
//  - La FOTO manda; sobre ella solo el corazón (y el sello 360° si aplica).
//  - Debajo: nombre + valoración, marca · forma, puntos de color, precio (azul
//    oscuro; rojo solo en oferta).
//  - Acción principal AZUL "Probármelos" (probador con cámara) y, más discreta,
//    "Añadir al carrito". Primero invitamos a verse la montura, luego a comprar.
export default function ProductCard({ product }) {
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const tryOnOpenKey = useTryOnOpenKey();
  const tryOn = tryOnOpenKey !== null && tryOnOpenKey === productTryOnKey(product);
  const [added, setAdded] = useState(false);
  const [genreTip, setGenreTip] = useState(false);
  const { t, tv, lang } = useLang();
  const { toggleFav, isFav, addVariant, busy } = useCart();
  const { toast } = useFeedback();
  const color = product.colors[active];
  const fav = isFav(product.slug);
  // ¿Esta montura ya tiene las 4 vistas 3D generadas? → muestra el sello "360°".
  useFrameMediaVersion();
  const hasViews = !!viewsBySku(product.sku);

  // Valoración: usamos las reseñas REALES de la tienda si existen; si no, el dato
  // del catálogo del proveedor. Solo se muestra cuando hay un nº de reseñas > 0,
  // para no inventar estrellas en monturas sin reseñas.
  const review = useReviewSummary(product.slug);
  const ratingVal = review ? review.average : (typeof product.rating === "number" ? product.rating : 0);
  const reviewCount = review ? review.count : (typeof product.reviews === "number" ? product.reviews : 0);
  const showRating = reviewCount > 0 && ratingVal > 0;

  // Oferta: precio anterior tachado + precio en rojo + etiqueta, solo si el
  // precio anterior REAL del catálogo es mayor que el actual. El % se deriva
  // de los dos precios reales (nada de rebajas inventadas por hash).
  // Descuentos apagados por producto (features.js): sin tachado ni % de rebaja.
  const hasSale = DISCOUNTS_ENABLED && typeof product.originalPrice === "number" && product.originalPrice > product.price;
  const discountOff = hasSale ? Math.round((1 - product.price / product.originalPrice) * 100) : 0;
  const oldPrice = hasSale ? product.originalPrice : 0;

  // Badge de género / edad (hombre, mujer, unisex o niños).
  const genderVal = product.attributes?.gender;
  const isKids = product.attributes?.age === "Niños";
  const GenderIcon = isKids ? IconKids
    : genderVal === "Hombres" ? IconGender
    : genderVal === "Señoras" ? IconFemale
    : genderVal === "Unisexo" ? IconUnisex
    : null;
  const genderLabel = isKids ? t("g.kids")
    : genderVal === "Hombres" ? t("g.male")
    : genderVal === "Señoras" ? t("g.female")
    : genderVal === "Unisexo" ? t("g.unisex")
    : "";

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
    <div className={`card ${hasSale ? "has-sale" : ""}`}>
      <div className="card-media">
        {/* Sello 360°: la montura ya tiene las 4 vistas 3D generadas. */}
        {hasViews && (
          <span className="card-badge-360 has-i3d" title={t("pdp.has3d")} aria-label="360°">
            {/* Icono 3D navy de la lámina; respaldo: svg + texto. */}
            <img className="i3d i3d-360" src="/ui/icons3d/navy-360.png" alt=""
                 onError={(e) => { e.currentTarget.parentElement.classList.remove("has-i3d"); e.currentTarget.remove(); }} />
            <Icon360 />
            <span className="b360-tx">360°</span>
          </span>
        )}
        {/* Única acción sobre la foto: favorito. Todo lo demás va debajo. */}
        <div className="card-actions">
          <button
            className={`card-ic card-ic-fav ${fav ? "on" : ""}`}
            onClick={() => toggleFav({ slug: product.slug, name: product.name, price: product.price, image: color.image, brand: product.brand, variantId: color.variantId })}
            aria-label={t("a11y.fav")} title={t("a11y.fav")}
          >
            {/* Corazón 3D de la lámina: blanco libre, navy marcado. */}
            {/* Corazón 3D: blanco libre, ROJO al marcar (pedido del cliente). */}
            <img className="i3d i3d-heart" src={`/ui/icons3d/${fav ? "red" : "white"}-heart.png`} alt=""
                 onError={(e) => { e.currentTarget.parentElement.classList.add("no-i3d"); e.currentTarget.remove(); }} />
            <IconHeart className="card-fav-ic" filled={fav} />
          </button>
          {GenderIcon && (
            <button
              type="button"
              className={`card-genre ${genreTip ? "on" : ""}`}
              aria-label={genderLabel}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setGenreTip((v) => !v); }}
              onMouseLeave={() => setGenreTip(false)}
            >
              {(isKids || genderVal === "Hombres" || genderVal === "Señoras") && (
                <img className="i3d i3d-genre"
                     src={`/ui/icons3d/${isKids ? "navy-kid" : genderVal === "Hombres" ? "navy2-man" : "navy2-woman"}.png`}
                     alt="" onError={(e) => { e.currentTarget.parentElement.classList.add("no-i3d"); e.currentTarget.remove(); }} />
              )}
              <GenderIcon className="card-genre-ic" />
              <span className="card-genre-tip" role="tooltip">{genderLabel}</span>
            </button>
          )}
          {hasSale && (
            <span className="card-disc-badge" title={t("card.sale")} aria-label={`-${discountOff}%`}>
              <IconDiscount className="card-disc-ic" />
              <b>-{discountOff}%</b>
            </span>
          )}
        </div>
        <Link to={`/producto/${product.slug}?color=${active}`} className="card-img-link" aria-label={product.name}>
          {/* La rejilla muestra la foto a ~280 px (560 en retina). Pedirle al
              bucket esa medida en vez del original ahorra ~25 KB POR TARJETA;
              con 48 en pantalla es más de 1 MB menos. `srcset` deja que el
              navegador elija según densidad; si el origen no admite
              redimensionado, `srcSet` llega vacío y se usa `src` como hoy. */}
          <img src={resolveImageSized(color.image, 560) || color.image}
               srcSet={imageSrcSet(color.image)}
               sizes="(max-width: 640px) 50vw, (max-width: 1100px) 33vw, 280px"
               alt={`${product.name} ${color.name}`} loading="lazy" decoding="async"
               onError={(e) => {
                 // Si la derivada falla por lo que sea, se vuelve al original
                 // antes de dar la imagen por perdida.
                 if (e.currentTarget.src !== color.image) {
                   e.currentTarget.srcset = "";
                   e.currentTarget.src = color.image;
                 } else {
                   e.currentTarget.style.opacity = 0.25;
                 }
               }} />
        </Link>
      </div>
      {TRY_ON_ENABLED && tryOn && (
        <TryOn product={product} colorIdx={active} onClose={closeTryOn}
               onAddPrescription={(payload) => {
                 // "Añadir receta" desde el probador abierto en una CARD del catálogo:
                 // antes NO se pasaba este callback, así que el botón ponía "Añadida"
                 // y NO abría la ventana de la receta (bug reportado). Igual que en la
                 // ficha (PDP): cerramos el probador y vamos al flujo de receta
                 // (/recetas/:slug) con el lector (OCR) abierto y las medidas del
                 // probador pre-rellenadas. Solo viajan datos LIGEROS y serializables
                 // (números + para quién); la imagen generada ya quedó guardada por
                 // producto en localStorage y LensProcess la recupera de ahí (evita el
                 // DataCloneError de history.pushState con imágenes reales).
                 closeTryOn();
                 const p = payload || {};
                 const light = {
                   productSku: p.productSku, colorName: p.colorName, colorIndex: p.colorIndex,
                   forWhom: p.forWhom, otherName: p.otherName,
                   pd: p.pd, pdRight: p.pdRight, pdLeft: p.pdLeft,
                   corridor: p.corridor, segHeight: p.segHeight,
                   bifocal: p.bifocal, suitable: p.suitable,
                 };
                 navigate(`/recetas/${product.slug}`, { state: { openRxOcr: true, tryOnMeasurement: light } });
               }}
               onBuyFrameOnly={(p) => {
                 // "Comprar solo el marco": directo al resumen del pedido (solo montura).
                 closeTryOn();
                 navigate(`/recetas/${product.slug}`, { state: { buyFrameOnly: true, colorIndex: p?.colorIndex } });
               }} />
      )}

      <div className="card-body">
        <div className="card-row">
          <Link to={`/producto/${product.slug}?color=${active}`} className="card-name">{product.name}</Link>
          {showRating && (
            <span className="card-rating" aria-label={`${ratingVal.toFixed(1)} / 5 · ${reviewCount}`}>
              <span className="stars" style={{ "--pct": `${Math.max(0, Math.min(100, (ratingVal / 5) * 100))}%` }} aria-hidden="true">
                <span className="stars-bg">★★★★★</span>
                <span className="stars-fg">★★★★★</span>
              </span>
              <b className="card-rating-avg">{ratingVal.toFixed(1)}</b>
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
            {hasSale && <span className="card-price-old">${oldPrice.toFixed(2)}</span>}
            <span className={`card-price ${hasSale ? "sale" : ""}`}>${product.price.toFixed(2)}</span>
          </span>
        </div>


        {/* Acción principal: probador con cámara. Diferencia la tienda — primero
            invitamos a verse la montura, después a comprar. */}
        {TRY_ON_ENABLED && (
          <button type="button" className="card-tryon btn-glass" onClick={() => openTryOn(product)}
                  aria-label={t("card.tryOn")} title={t("card.tryOn")}>
            {/* Cristal 9-slice del CSS (ETAPA 115): el fondo es la barra vacía
                de la lámina estirada sin deformar los extremos, y el contenido
                (cámara dorada + texto) es HTML vivo es/en — mismo tamaño SIEMPRE
                y a todo el ancho de la tarjeta. */}
            <span className="btn-glass-fb">
              <img className="ic-raster" src="/ui/ic-camera-gold.png" alt="" aria-hidden="true"
                   onError={(e) => e.currentTarget.remove()} />
              {t("card.tryOn")}
            </span>
          </button>
        )}
        {/* Acción secundaria: añadir SOLO la montura al carrito. */}
        <button
          type="button"
          className={`card-add-cart ${added ? "done" : "btn-glass"}`}
          disabled={busy || !color.variantId}
          onClick={addFrameOnly}
        >
          {added ? (
            <>✓ {t("case.added")}</>
          ) : (
            <>
              <span className="btn-glass-fb">
                <img className="ic-raster ic-raster-sm" src="/ui/ic-cart-navy.png" alt="" aria-hidden="true"
                     onError={(e) => e.currentTarget.remove()} />
                {t("card.addToCart")}
              </span>
            </>
          )}
        </button>
        {/* Atajo directo a receta: el cliente puede ir al flujo de lentes
            graduados SIN pasar por el probador ni por la ficha (PDP). Cubre el
            caso "no necesito probármelos, solo quiero poner la receta". */}
        <button type="button" className="card-lensflow"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(`/recetas/${product.slug}?color=${active}`); }}>
          {t("card.lensFlow")} →
        </button>
      </div>
    </div>
  );
}

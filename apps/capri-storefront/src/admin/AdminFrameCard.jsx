// Dónde se usa: modal "Ficha de montura" dentro del panel de administración
// (catálogo, punto de venta, precios). Muestra los mismos datos que la ficha
// de la tienda online (imágenes, colores, atributos, medidas, precio) sin las
// acciones de compra. Recibe un objeto `product` del catálogo (catalogStore.js).
import { useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { money } from "./adminOrders.js";
import { resolveImageSized, imageSrcSet } from "../data/imageUrl.js";
import { DISCOUNTS_ENABLED } from "../config/features.js";

const ATTRS = [
  ["brand", "brand"],
  ["shape", "attributes.shape"],
  ["material", "attributes.material"],
  ["gender", "attributes.gender"],
  ["age", "attributes.age"],
  ["rim", "attributes.rim"],
];

const MEASURES = [
  ["eye_size", "spec.eye"],
  ["bridge_size", "spec.bridge"],
  ["temple_length", "spec.temple"],
];

const get = (obj, path) => {
  const parts = path.split(".");
  let v = obj;
  for (const p of parts) { v = v?.[p]; if (v == null) return ""; }
  return v;
};

/**
 * Ficha de detalle de montura para el panel de administración.
 * Se usa como modal: el padre controla la visibilidad.
 */
export default function AdminFrameCard({ product, onClose }) {
  const { t, tv, lang } = useLang();
  const [activeColor, setActiveColor] = useState(0);
  if (!product) return null;

  const color = product.colors?.[activeColor] || product.colors?.[0];
  const mainImage = color?.image || product.colors?.[0]?.image;
  const m = (v) => (v == null ? "—" : money(v, "usd", lang));

  const hasSale = DISCOUNTS_ENABLED && typeof product.originalPrice === "number" && product.originalPrice > product.price;
  const discountPct = hasSale ? Math.round((1 - product.price / product.originalPrice) * 100) : 0;

  return (
    <div className="adm-frame-overlay" onClick={onClose}>
      <div className="adm-frame-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="adm-frame-close" onClick={onClose} aria-label={t("adm.ord.clear")}>
          <Icon name="close" size={20} />
        </button>

        <div className="adm-frame-layout">
          {/* Imagen principal */}
          <div className="adm-frame-img-area">
            {mainImage ? (
              <img
                className="adm-frame-main-img"
                src={resolveImageSized ? resolveImageSized(mainImage, 600) : mainImage}
                srcSet={imageSrcSet ? imageSrcSet(mainImage, [400, 600, 800]) : undefined}
                sizes="(max-width: 600px) 90vw, 400px"
                alt={product.name}
                loading="eager"
              />
            ) : (
              <div className="adm-frame-no-img">
                <Icon name="glasses" size={64} />
              </div>
            )}

            {/* Color swatches */}
            {product.colors?.length > 1 && (
              <div className="adm-frame-colors">
                {product.colors.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`adm-frame-swatch ${i === activeColor ? "on" : ""}`}
                    onClick={() => setActiveColor(i)}
                    title={c.label || `Color ${i + 1}`}
                  >
                    {c.image ? (
                      <img src={resolveImageSized ? resolveImageSized(c.image, 60) : c.image} alt={c.label || ""} loading="lazy" />
                    ) : (
                      <span className="adm-frame-swatch-dot" style={c.hex ? { background: c.hex } : undefined} />
                    )}
                  </button>
                ))}
              </div>
            )}
            {color?.label && <small className="adm-frame-color-label">{color.label}</small>}
          </div>

          {/* Información */}
          <div className="adm-frame-info">
            <h3 className="adm-frame-title">{product.name}</h3>
            <p className="adm-frame-brand">{product.brand}</p>

            {/* Precio */}
            <div className="adm-frame-price-row">
              <span className="adm-frame-price">{m(product.price)}</span>
              {hasSale && (
                <>
                  <span className="adm-frame-old-price">{m(product.originalPrice)}</span>
                  <span className="adm-frame-discount">-{discountPct}%</span>
                </>
              )}
            </div>

            {/* SKU */}
            {product.sku && <p className="adm-frame-sku">SKU: {product.sku}</p>}

            {/* Atributos */}
            <dl className="adm-frame-attrs">
              {ATTRS.map(([key, path]) => {
                const val = key === "brand" ? product.brand : get(product, path);
                if (!val) return null;
                return (
                  <div key={key} className="adm-frame-attr">
                    <dt>{t(`adm.frame.${key}`)}</dt>
                    <dd>{tv(String(val))}</dd>
                  </div>
                );
              })}
            </dl>

            {/* Medidas */}
            {product.attributes && (product.attributes.eye_size || product.attributes.bridge_size || product.attributes.temple_length) && (
              <div className="adm-frame-measures">
                <h4>{t("adm.frame.measures")}</h4>
                <div className="adm-frame-measure-row">
                  {MEASURES.map(([attrKey, labelKey]) => {
                    const val = product.attributes?.[attrKey];
                    if (!val) return null;
                    const display = Array.isArray(val) ? val.join("–") : val;
                    return (
                      <div key={attrKey} className="adm-frame-measure">
                        <span className="adm-frame-measure-val">{display}<small>mm</small></span>
                        <span className="adm-frame-measure-label">{t(labelKey)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Variantes/Colores count */}
            <div className="adm-frame-meta">
              {product.colors?.length > 0 && (
                <span className="adm-frame-meta-item">
                  <Icon name="palette" size={14} /> {product.colors.length} {t("adm.frame.colors")}
                </span>
              )}
              {product.medusaId && (
                <span className="adm-frame-meta-item muted">
                  ID: {product.medusaId}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

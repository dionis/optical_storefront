// Dónde se usa: modal "Ficha de montura" dentro del panel de administración
// (catálogo, punto de venta, precios). Muestra los mismos datos que la ficha
// de la tienda online (imágenes, colores, atributos, medidas, precio) sin las
// acciones de compra. Recibe un objeto `product` del catálogo (catalogStore.js).
//
// Rediseño visual (pedido del dueño): las medidas se leen por ICONO + número,
// la marca se reconoce por su LOGO y los colores se ven como MUESTRAS, no como
// el texto "3 colores". Los datos, su origen, el cierre y la accesibilidad son
// los mismos de antes: esto es solo cómo se ve.
import { useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import FrameMeasureIcon from "./frameMeasureIcons.jsx";
import { money } from "./adminOrders.js";
import { resolveImageSized, imageSrcSet } from "../data/imageUrl.js";
import { BRAND_BY_SLUG, brandByName } from "../data/brands.js";
import { DISCOUNTS_ENABLED } from "../config/features.js";

// Ficha técnica compacta. La MARCA ya no va aquí: ahora se reconoce por su logo
// en la cabecera, y repetirla como fila era justo el aire muerto que sobraba.
const ATTRS = [
  ["shape", "attributes.shape"],
  ["material", "attributes.material"],
  ["gender", "attributes.gender"],
  ["age", "attributes.age"],
  ["rim", "attributes.rim"],
];

// Medidas por orden de lectura del óptico: ojo □ puente – varilla, y el alto
// del lente al final porque no todas las monturas lo traen. La clave de rótulo
// es la MISMA que usa la tienda (spec.*), para que ficha pública y panel digan
// lo mismo con las mismas palabras.
const MEASURES = [
  ["eye_size", "spec.eye"],
  ["bridge_size", "spec.bridge"],
  ["temple_length", "spec.temple"],
  ["lens_height", "adm.pos.frame.detail.lensHeight"],
];

const get = (obj, path) => {
  const parts = path.split(".");
  let v = obj;
  for (const p of parts) { v = v?.[p]; if (v == null) return ""; }
  return v;
};

// El catálogo guarda la medida ya con su unidad ("51-53 mm") o sin ella (51).
// La ficha pinta el "mm" una sola vez, aparte y en pequeño, así que aquí se le
// quita al valor: antes salía "51-53 mm mm".
function measureNumber(v) {
  const raw = Array.isArray(v) ? v.join("–") : String(v ?? "");
  return raw.replace(/\s*mm\s*$/i, "").trim();
}

/**
 * Sello de marca: el MISMO logo que pinta la lista «Catálogo por marca» del
 * panel (data/brands.js → public/brands/). Se prefiere el logo plano
 * (`logoWide`) porque es el que se lee como marca; el medallón queda de
 * respaldo. Si la marca no está en la lista, o el fichero no carga, se cae al
 * NOMBRE de la marca — nunca a un hueco.
 */
function BrandSeal({ product, t }) {
  const [broken, setBroken] = useState(false);
  const name = product.brand;
  if (!name) return null;

  const info = BRAND_BY_SLUG[product.brand_slug] || brandByName(name);
  const logo = info ? (info.logoWide || info.logo) : null;

  // Sin logo (o roto): el nombre, con el mismo peso visual que tenía antes.
  if (!logo || broken) return <span className="adm-frame-seal is-text">{name}</span>;

  return (
    // El `title`/`aria-label` llevan el nombre de la marca porque la imagen es
    // un wordmark: quien use lector de pantalla oye "Marca Di Caprio", no un
    // nombre de fichero.
    <span className="adm-frame-seal has-logo" role="img"
          aria-label={t("adm.pos.frame.detail.brandOf", { name })}
          title={t("adm.pos.frame.detail.brandOf", { name })}>
      <img src={logo} alt="" loading="lazy" onError={() => setBroken(true)} />
    </span>
  );
}

/**
 * Ficha de detalle de montura para el panel de administración.
 * Se usa como modal: el padre controla la visibilidad.
 */
export default function AdminFrameCard({ product, onClose }) {
  const { t, tv, lang } = useLang();
  const [activeColor, setActiveColor] = useState(0);
  if (!product) return null;

  const colors = product.colors || [];
  const color = colors[activeColor] || colors[0];
  const mainImage = color?.image || colors[0]?.image;
  const m = (v) => (v == null ? "—" : money(v, "usd", lang));
  // El catálogo nombra el color en `name`; `label` es la forma que traen otras
  // fuentes. Se aceptan las dos para que la muestra nunca salga sin nombre.
  const colorName = (c) => c?.name || c?.label || "";

  const hasSale = DISCOUNTS_ENABLED && typeof product.originalPrice === "number" && product.originalPrice > product.price;
  const discountPct = hasSale ? Math.round((1 - product.price / product.originalPrice) * 100) : 0;

  const measures = MEASURES
    .map(([key, labelKey]) => ({ key, labelKey, value: measureNumber(product.attributes?.[key]) }))
    .filter((x) => x.value);

  return (
    <div className="adm-frame-overlay" onClick={onClose}>
      <div className="adm-frame-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="adm-frame-close" onClick={onClose} aria-label={t("adm.ord.clear")}>
          <Icon name="close" size={20} />
        </button>

        <div className="adm-frame-layout">
          {/* Imagen principal + muestras de color */}
          <div className="adm-frame-img-area">
            <div className="adm-frame-stage">
              {mainImage ? (
                <img
                  className="adm-frame-main-img"
                  src={resolveImageSized ? resolveImageSized(mainImage, 600) : mainImage}
                  srcSet={imageSrcSet ? imageSrcSet(mainImage, [400, 600, 800]) : undefined}
                  sizes="(max-width: 700px) 90vw, 380px"
                  alt={product.name}
                  loading="eager"
                />
              ) : (
                <div className="adm-frame-no-img">
                  <Icon name="glasses" size={64} />
                </div>
              )}
            </div>

            {/* Colores: muestras de verdad (la foto del color, o su tono) en vez
                del antiguo recuento "3 colores". Siguen siendo los botones que
                cambian la foto, así que no hay dos controles para lo mismo. */}
            {colors.length > 1 && (
              <div className="adm-frame-colors" role="group" aria-label={t("adm.pos.frame.detail.colors")}>
                {colors.map((c, i) => {
                  const cname = colorName(c) || t("adm.pos.frame.detail.colorNo", { n: i + 1 });
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`adm-frame-swatch ${i === activeColor ? "on" : ""}`}
                      onClick={() => setActiveColor(i)}
                      aria-pressed={i === activeColor}
                      aria-label={t("adm.pos.frame.detail.colorPick", { name: cname })}
                      title={cname}
                    >
                      {c.image ? (
                        <img src={resolveImageSized ? resolveImageSized(c.image, 60) : c.image} alt="" loading="lazy" />
                      ) : (
                        <span className="adm-frame-swatch-dot" style={c.hex ? { background: c.hex } : undefined} />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {colorName(color) && <small className="adm-frame-color-label">{tv(colorName(color))}</small>}
          </div>

          {/* Información */}
          <div className="adm-frame-info">
            {/* Cabecera: modelo + SKU a la izquierda, logo de la marca a la
                derecha. Antes la marca era otra línea de texto bajo el modelo. */}
            <header className="adm-frame-head">
              <div className="adm-frame-ident">
                <h3 className="adm-frame-title">{product.name}</h3>
                {product.sku && (
                  <span className="adm-frame-sku" title={t("adm.pos.frame.card.sku")}>
                    <i aria-hidden="true">{t("adm.pos.frame.card.sku")}</i> {product.sku}
                  </span>
                )}
              </div>
              <BrandSeal product={product} t={t} />
            </header>

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

            {/* Atributos: datos compactos en dos columnas, no una tabla suelta */}
            <dl className="adm-frame-attrs">
              {ATTRS.map(([key, path]) => {
                const val = get(product, path);
                if (!val) return null;
                const text = Array.isArray(val) ? val.map((x) => tv(String(x))).join(" · ") : tv(String(val));
                return (
                  <div key={key} className="adm-frame-attr">
                    <dt>{t(`adm.frame.${key}`)}</dt>
                    <dd>{text}</dd>
                  </div>
                );
              })}
            </dl>

            {/* Medidas: icono + número + unidad. El rótulo entero ("Tamaño del
                ojo") ya no ocupa una línea bajo cada número; vive en el
                title/aria-label, que es donde hace falta de verdad. */}
            {measures.length > 0 && (
              <div className="adm-frame-measures">
                <h4>{t("adm.frame.measures")}</h4>
                <ul className="adm-frame-measure-row">
                  {measures.map(({ key, labelKey, value }) => {
                    const label = t(labelKey);
                    // Un solo texto accesible por medida: el lector de pantalla
                    // dice "Tamaño del ojo: 51-53 milímetros" en vez de leer el
                    // icono, el número y la unidad por separado.
                    const spoken = t("adm.pos.frame.detail.measureOf", { label, value });
                    return (
                      <li key={key} className="adm-frame-measure" title={`${label}: ${value} ${t("adm.pos.frame.detail.mm")}`}>
                        <FrameMeasureIcon name={key} />
                        <span className="adm-frame-measure-val" aria-label={spoken}>
                          <b aria-hidden="true">{value}</b>
                          <small aria-hidden="true">{t("adm.pos.frame.detail.mm")}</small>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Pie: solo el identificador técnico. El recuento de colores se fue
                con las muestras, que ya dicen cuántos hay y cuáles son. */}
            {product.medusaId && (
              <div className="adm-frame-meta">
                <span className="adm-frame-meta-item muted">ID: {product.medusaId}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

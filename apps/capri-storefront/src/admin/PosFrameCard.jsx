// Dónde se usa: Nueva venta (PosSale.jsx). La montura elegida como ficha
// profesional: foto, marca y modelo, color (con muestra si el nombre se
// reconoce), SKU / código de barras y la ficha técnica en pastillas — medidas
// en la notación óptica «52 □ 18 140», material, forma, aro, género y edad —
// con el precio de la tienda. `compact` es la misma tarjeta en una fila de
// ~72 px para encabezar los pasos de receta, lentes y precio: el vendedor
// siempre ve qué montura está vendiendo.
//
// Los datos vienen de GET /admin/pos/products (searchPosProducts): `brand`,
// `images`, `specs` por modelo y `color`/`sku`/`barcode`/`image` por color.
// `frameLineFields(p, v)` convierte ese par en los campos que la línea de la
// venta guarda, y es lo que la tarjeta lee.
import { useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Icon from "./icons.jsx";
import { resolveImageSized } from "../data/imageUrl.js";
import { frameSpecRows } from "../data/frameSpecLabels.js";
import { hexFor } from "../data/products.js";
import "./pos-frame-card.css";
import { listPromoOf } from "./pricing/promo.js";
import "./pricing/promo.css";

/** Lo que `hexFor` devuelve cuando el nombre del color no se reconoce: sin muestra, solo texto. */
const UNKNOWN_HEX = hexFor("");

/**
 * Campos de la montura que la línea de la venta copia de un resultado del
 * buscador (`p`) y del color elegido (`v`). Los mismos nombres los lee la
 * tarjeta, así `addFrame` solo tiene que hacer `...frameLineFields(p, v)`.
 */
export function frameLineFields(p, v) {
  return {
    title: p.title,
    variant_title: v.title,
    image: v.image || p.thumbnail || null,
    price: p.price,
    // The owner's item promotion in this store (docs/PRICE-MATRIX.md): `price` is already reduced.
    price_before: p.price_before ?? null,
    discount_pct: p.discount_pct ?? null,
    brand: p.brand ?? null,
    model: p.model ?? p.title,
    color: v.color ?? v.title ?? null,
    sku: v.sku ?? null,
    barcode: v.barcode ?? null,
    images: Array.isArray(p.images) ? p.images : [],
    specs: p.specs ?? null,
    // Los demás colores del modelo, para `onChangeColor` sin volver a buscar.
    variants: Array.isArray(p.variants) ? p.variants : [],
  };
}

/** «52 □ 18 140»; con solo el ojo, «52 mm»; nada si el catálogo no trae medidas. */
export function sizeNotation(specs) {
  if (!specs) return null;
  const { eye, bridge, temple } = specs;
  if (eye != null && bridge != null && temple != null) return `${eye} □ ${bridge} ${temple}`;
  if (eye != null && bridge != null) return `${eye} □ ${bridge}`;
  if (eye != null) return `${eye} mm`;
  return null;
}

function Photo({ src, name, compact }) {
  const { t } = useLang();
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return <div className="pfc-img" role="img" aria-label={t("adm.pos.frame.card.noImage")}><Icon name="glasses" size={compact ? 22 : 36} /></div>;
  }
  return (
    <div className="pfc-img">
      <img src={resolveImageSized(src, compact ? 160 : 400)} alt={t("adm.pos.frame.card.photoOf", { name })} loading="lazy" onError={() => setBroken(true)} />
    </div>
  );
}

/**
 * `frame`: la línea de la venta (`kind: "frame"`, ver `frameLineFields`).
 * `money(n)`: formato de moneda del panel. `compact`: una sola fila.
 * `onRemove()`: muestra el botón de quitar. `onChangeColor(variant)`: convierte
 * el chip de color en un selector con los demás colores del modelo.
 */
export default function PosFrameCard({ frame, money, compact = false, onRemove, onChangeColor }) {
  const { t, lang } = useLang();
  if (!frame) return null;
  const specs = frame.specs || null;
  const name = frame.model || frame.title || "";
  const color = frame.color || frame.variant_title || "";
  const hex = color ? hexFor(color) : UNKNOWN_HEX;

  // Forma, aro, material, género y edad traducidos por frameSpecLabels.js (misma
  // tabla que la ficha del pedido); se toman por clave, sin sus rótulos.
  const rows = specs
    ? Object.fromEntries(
        frameSpecRows(
          { shape: specs.shape, style: specs.rim, material: specs.material, gender: specs.gender, age_group: specs.age_group, lens_height: specs.lens_height },
          lang,
          t
        ).map((r) => [r.key, r.value])
      )
    : {};
  const size = sizeNotation(specs);
  const pills = [
    size && { key: "size", cls: "size", title: t("adm.pos.frame.card.size"), value: size },
    rows.material && { key: "material", title: t("adm.pos.frame.card.material"), value: rows.material },
    rows.shape && { key: "shape", title: t("adm.pos.frame.card.shape"), value: rows.shape },
    rows.style && { key: "rim", title: t("adm.pos.frame.card.rim"), value: rows.style },
    (rows.gender || rows.age) && {
      key: "who",
      title: rows.gender && rows.age ? `${t("adm.pos.frame.card.gender")} · ${t("adm.pos.frame.card.age")}` : rows.gender ? t("adm.pos.frame.card.gender") : t("adm.pos.frame.card.age"),
      value: [rows.gender, rows.age].filter(Boolean).join(" · "),
    },
    !compact && rows.lensHeight && { key: "lensHeight", title: t("adm.pos.frame.card.lensHeight"), value: `B ${rows.lensHeight}` },
  ].filter(Boolean);

  const variants = Array.isArray(frame.variants) ? frame.variants : [];
  const canPick = typeof onChangeColor === "function" && variants.length > 1;
  const colorChip = color || canPick ? (
    <span className={`pfc-color ${hex === UNKNOWN_HEX ? "text" : ""}`} title={t("adm.pos.frame.card.color")}>
      {hex !== UNKNOWN_HEX && <span className="pfc-swatch" style={{ background: hex }} aria-hidden="true" />}
      {canPick ? (
        <select
          className="pfc-color-select"
          value={frame.variant_id || ""}
          aria-label={t("adm.pos.frame.card.changeColor")}
          title={t("adm.pos.frame.card.changeColor")}
          onChange={(e) => { const v = variants.find((x) => x.id === e.target.value); if (v) onChangeColor(v); }}
        >
          {variants.map((v) => <option key={v.id} value={v.id}>{v.color || v.title || v.sku || v.id}</option>)}
        </select>
      ) : color}
    </span>
  ) : null;

  const ids = (
    <div className="pfc-ids">
      {colorChip}
      {frame.sku && <span className="pfc-code"><small>{t("adm.pos.frame.card.sku")}</small>{frame.sku}</span>}
      {frame.barcode && frame.barcode !== frame.sku && <span className="pfc-code"><small>{t("adm.pos.frame.card.barcode")}</small>{frame.barcode}</span>}
    </div>
  );
  const specList = (
    <ul className="pfc-specs" aria-label={t("adm.pos.frame.card.size")}>
      {pills.length === 0 && <li className="empty">{t("adm.pos.frame.card.noSpecs")}</li>}
      {pills.map((p) => <li key={p.key} className={p.cls || ""} title={p.title}><span className="sr-only">{p.title}: </span>{p.value}</li>)}
    </ul>
  );
  const price = frame.price == null
    ? <span className="pfc-price none">{t("adm.pos.frame.card.noPrice")}</span>
    : (
      <span className="pfc-price" title={t("adm.pos.frame.card.price")}>
        {money ? money(frame.price) : frame.price}
        {listPromoOf(frame) && (
          <small className="pos-promo" title={t("adm.pm.promo", { before: money ? money(listPromoOf(frame).before) : listPromoOf(frame).before, pct: listPromoOf(frame).pct })}>
            <s>{money ? money(listPromoOf(frame).before) : listPromoOf(frame).before}</s> −{listPromoOf(frame).pct} %
          </small>
        )}
      </span>
    );
  const remove = typeof onRemove === "function" && (
    <button type="button" className="btn-xs warn pfc-remove" onClick={onRemove} aria-label={t("adm.pos.frame.card.remove")} title={t("adm.pos.frame.card.remove")}>
      <Icon name="trash" size={12} />
    </button>
  );

  return (
    <article className={`pfc ${compact ? "compact" : ""}`} aria-label={compact ? `${t("adm.pos.frame.card.selling")}: ${name}` : name}>
      <Photo src={frame.image || frame.images?.[0] || null} name={name} compact={compact} />
      <div className="pfc-body">
        <div className="pfc-head">
          <div className="pfc-title">
            {frame.brand && <span className="pfc-brand">{frame.brand}</span>}
            <h4 className="pfc-model">{name}</h4>
          </div>
          {price}
          {remove}
        </div>
        {compact ? (
          <div className="pfc-line">{ids}{specList}</div>
        ) : (
          <>
            {ids}
            {specList}
          </>
        )}
      </div>
    </article>
  );
}

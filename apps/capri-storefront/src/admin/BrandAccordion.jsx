// Dónde se usa: pestaña «Productos» del grupo Comercial (CatalogManager.jsx).
// Una marca del catálogo como acordeón que YA SE LEE CERRADO — regla del dueño:
// «cada acordeón resume antes de abrirse». La cabecera lleva el logo de la marca
// (no su nombre a secas), cuántos modelos y colores tiene, el rango de precio, el
// costo medio de proveedor, el margen medio y el interruptor de surtido; al
// abrirlo, una fila por modelo que cabe en UNA línea en pantalla ancha.
//
// Este módulo no decide nada: recibe ya calculado lo que pinta (CatalogManager
// es quien lee el surtido, los precios y los costos) y avisa por callbacks. Así
// la lógica de precios sigue viviendo en /admin/pricing/* y la de surtido en
// /admin/store-assortment/*, y aquí solo hay presentación.
import { useState } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import Accordion from "./Accordion.jsx";
import HelpTip from "./HelpTip.jsx";
import Icon from "./icons.jsx";
import { money } from "./adminOrders.js";
// La notación óptica es la MISMA que ve el vendedor en el punto de venta
// («51 □ 18 145»): se reutiliza su función en vez de volver a escribirla.
import { sizeNotation } from "./PosFrameCard.jsx";
import "./catalog-manager.css";

/** Cuántas muestras de color caben en la fila antes de resumir con «+n». */
const MAX_SWATCHES = 6;

/**
 * Medidas del modelo en notación óptica. El catálogo de Medusa trae los
 * milímetros exactos (attributes.eye/bridge/temple) y `sizeNotation` los compone;
 * el catálogo semilla solo trae tramos («51-53 mm»), así que se compone el mismo
 * patrón con los tramos — enseñar el tramo es más útil que no enseñar nada.
 */
export function modelSize(p) {
  const a = p?.attributes || {};
  const exact = sizeNotation({ eye: a.eye, bridge: a.bridge, temple: a.temple });
  if (exact) return exact;
  const strip = (v) => String(v || "").replace(/\s*mm\s*$/i, "").trim();
  const eye = strip(a.eye_size), bridge = strip(a.bridge_size), temple = strip(a.temple_length);
  if (eye && bridge && temple) return `${eye} □ ${bridge} ${temple}`;
  if (eye && bridge) return `${eye} □ ${bridge}`;
  return eye || null;
}

/**
 * Interruptor de surtido: expone u oculta algo en UNA tienda. Sin tienda elegida
 * queda deshabilitado y el `title` dice por qué — un interruptor del que el
 * operador no sabe sobre qué actúa es peor que no tenerlo.
 */
function AssortSwitch({ on, disabled, label, reason, inherit, onChange }) {
  const { t } = useLang();
  // `inherit`: el modelo no tiene regla propia y sigue la de su marca. Se dice
  // en el `title`, no con un adorno: el dueño no quiere ruido en la fila.
  const hint = disabled ? reason : inherit ? `${label} · ${t("adm.cm.swInherit")}` : label;
  return (
    <label className={`cm-sw ${disabled ? "off" : ""}`} title={hint}>
      <input
        type="checkbox"
        role="switch"
        checked={!!on}
        disabled={disabled}
        aria-label={hint}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/** Muestras de color: el dueño quiere ver el color, no leer su nombre. */
function Swatches({ colors, name }) {
  const { t } = useLang();
  const list = colors || [];
  if (!list.length) return <span className="cm-dash">{t("adm.cm.none")}</span>;
  const shown = list.slice(0, MAX_SWATCHES);
  const rest = list.length - shown.length;
  return (
    <span className="cm-swatches" aria-label={t("adm.cm.colorList", { name, list: list.map((c) => c.name).join(", ") })}>
      {shown.map((c, i) => (
        <i key={i} style={{ background: c.hex || "#b8bec8" }} title={c.name} aria-hidden="true" />
      ))}
      {rest > 0 && <b aria-hidden="true">{t("adm.cm.colorsMore", { n: rest })}</b>}
    </span>
  );
}

/**
 * Una fila de modelo. El precio de venta es el del catálogo (lo calcula el
 * servidor con la regla); el campo de al lado escribe el PRECIO PROPIO del
 * modelo por /admin/pricing/frames/override, y la pastilla «Propio» avisa de
 * que ese modelo ya no sigue la regla.
 */
function ModelRow({ p, cost, override, store, exposed, ownRule, busy, isCase, onSavePrice, onClearPrice, onDiscontinue, onSwitch, onOpen }) {
  const { t, lang } = useLang();
  const usd = (n) => money(n, "usd", lang);
  const [draft, setDraft] = useState("");
  const size = isCase ? null : modelSize(p);
  const img = p.colors?.[0]?.image;
  const name = p.name || p.sku;
  // Sin `medusaId` el modelo no existe para el servidor (catálogo semilla sin
  // Medusa): no hay a qué escribirle precio propio ni surtido.
  const linked = Boolean(p.medusaId);

  return (
    <div className={`cm-row ${exposed === false ? "hidden" : ""}`}>
      <button type="button" className="cm-thumb" title={name} aria-label={name} onClick={() => onOpen(p)}>
        {img ? <img src={img} alt="" loading="lazy" /> : <Icon name={isCase ? "box" : "glasses"} size={16} />}
      </button>

      <button type="button" className="cm-name" onClick={() => onOpen(p)}>{name}</button>

      <span className="cm-cell cm-sku">
        <small className="cm-lbl">{t("adm.cm.col.sku")}</small>
        <code>{p.sku || t("adm.cm.none")}</code>
      </span>

      <span className="cm-cell cm-colors">
        <small className="cm-lbl">{t("adm.cm.col.colors")}</small>
        <Swatches colors={p.colors} name={name} />
      </span>

      <span className="cm-cell cm-size" title={size ? t("adm.cm.sizeHint") : undefined}>
        <small className="cm-lbl">{t("adm.cm.col.size")}</small>
        {size ? <span className="cm-mono">{size}</span> : <span className="cm-dash">{t("adm.cm.none")}</span>}
      </span>

      <span className="cm-cell cm-cost" title={cost != null ? t("adm.cm.costHint") : undefined}>
        <small className="cm-lbl">{t("adm.cm.col.cost")}</small>
        {cost != null ? <span className="cm-mono">{usd(cost)}</span> : <span className="cm-dash">{t("adm.cm.none")}</span>}
      </span>

      <span className="cm-cell cm-price">
        <small className="cm-lbl">{t("adm.cm.col.price")}</small>
        <b className="cm-mono" title={override ? t("adm.cm.ownHint") : t("adm.cm.rulePrice")}>{usd(override ? override.price : p.price)}</b>
        {override && <span className="cm-badge" title={t("adm.cm.ownHint")}>{t("adm.cm.ownBadge")}</span>}
      </span>

      <span className="cm-cell cm-own">
        <small className="cm-lbl">{t("adm.cm.col.own")}</small>
        <input
          inputMode="decimal"
          className="cm-input"
          placeholder={t("adm.cm.ownPlaceholder")}
          aria-label={t("adm.cm.ownAria", { name })}
          disabled={!linked || busy}
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ""))}
        />
        <button
          type="button"
          className="btn-xs primary"
          disabled={!linked || busy || !draft}
          title={t("adm.cm.savePrice", { name })}
          aria-label={t("adm.cm.savePrice", { name })}
          onClick={() => onSavePrice(p, draft).then((ok) => { if (ok) setDraft(""); })}
        >
          <Icon name="save" size={12} />
        </button>
        {override && !override.inherited && (
          <button
            type="button"
            className="btn-xs"
            disabled={busy}
            title={t("adm.cm.clearPrice", { name })}
            aria-label={t("adm.cm.clearPrice", { name })}
            onClick={() => onClearPrice(p, override)}
          >
            <Icon name="undo" size={12} />
          </button>
        )}
      </span>

      <span className="cm-cell cm-sale">
        <small className="cm-lbl">{t("adm.cm.col.sale")}</small>
        <AssortSwitch
          on={exposed !== false}
          disabled={store.isAll || !linked || busy}
          label={t("adm.cm.swModel", { name, store: store.label })}
          reason={store.isAll ? t("adm.cm.swNoStore") : t("adm.cm.swNoId")}
          inherit={ownRule == null}
          onChange={(next) => onSwitch(p, next)}
        />
      </span>

      <button
        type="button"
        className="btn-xs warn cm-off"
        disabled={!linked || busy}
        title={t("adm.cm.discontinue", { name })}
        aria-label={t("adm.cm.discontinue", { name })}
        onClick={() => onDiscontinue(p)}
      >
        <Icon name="power" size={12} />
      </button>
    </div>
  );
}

/**
 * La marca entera. `stats` llega calculado (modelos, colores, rango de precio,
 * costo medio y margen medio) para que la cabecera cerrada ya lo diga todo.
 */
export default function BrandAccordion({
  brand, models, stats, offCount = 0, store, isCase = false, defaultOpen = false,
  brandRule = null, exposedOf, ownRuleOf, overrideOf, costOf, ruleLabel,
  busy = null, onBrandSwitch, onModelSwitch, onSavePrice, onClearPrice, onDiscontinue, onOpen,
}) {
  const { t, lang } = useLang();
  const usd = (n) => money(n, "usd", lang);
  const brandOn = brandRule !== false;

  // Pastillas del resumen: lo que el dueño pidió ver sin abrir el acordeón.
  const summary = [
    { label: t("adm.cm.b.models"), value: stats.models, strong: true },
    { label: t("adm.cm.b.colors"), value: stats.colors },
    stats.min != null && { label: t("adm.cm.b.price"), value: t("adm.cm.b.range", { min: usd(stats.min), max: usd(stats.max) }) },
    stats.cost != null && { label: t("adm.cm.b.cost"), value: usd(stats.cost) },
    stats.margin != null && { label: t("adm.cm.b.margin"), value: `${stats.margin} %`, tone: stats.margin >= 50 ? "good" : stats.margin >= 30 ? "warn" : "bad" },
    // Los descatalogados van APARTE del conteo activo: el dueño no quiere que
    // una marca parezca más grande por lo que ya no vende.
    offCount > 0 && { label: t("adm.cm.b.off"), value: offCount, tone: "muted" },
    !store.isAll && !brandOn && { label: t("adm.cm.b.hidden", { store: store.label }), value: stats.models, tone: "bad" },
  ].filter(Boolean);

  return (
    <Accordion
      id={`catalog-brand-${brand.slug}`}
      className="cm-acc"
      bodyClassName="cm-body"
      defaultOpen={defaultOpen}
      title={
        <span className="cm-brand">
          {brand.logo
            ? <img className="cm-logo" src={brand.logo} alt={t("adm.cm.logoAlt", { name: brand.name })}
                   onError={(e) => { e.currentTarget.classList.add("broken"); }} />
            : <Icon name={isCase ? "box" : "glasses"} size={16} />}
          <b>{brand.name}</b>
        </span>
      }
      subtitle={isCase ? t("adm.cm.casesSub") : ruleLabel}
      summary={summary}
      right={
        <span className="cm-brand-sw">
          <AssortSwitch
            on={brandOn}
            disabled={store.isAll || busy === `brand:${brand.slug}`}
            label={t("adm.cm.swBrand", { name: brand.name, store: store.label })}
            reason={t("adm.cm.swNoStore")}
            onChange={(next) => onBrandSwitch(brand, next)}
          />
        </span>
      }
    >
      <div className="cm-rows">
        {models.map((p) => (
          <ModelRow
            key={p.slug || p.sku}
            p={p}
            isCase={isCase}
            cost={costOf(p)}
            override={overrideOf(p)}
            exposed={exposedOf(p)}
            ownRule={ownRuleOf(p)}
            store={store}
            busy={busy === (p.slug || p.sku)}
            onSavePrice={onSavePrice}
            onClearPrice={onClearPrice}
            onDiscontinue={onDiscontinue}
            onSwitch={onModelSwitch}
            onOpen={onOpen}
          />
        ))}
        {models.length === 0 && <div className="adm-nodata">{t("adm.cm.noMatch")}</div>}
      </div>
      {!isCase && (
        <p className="cm-foot">
          <Icon name="info" size={12} /> {t("adm.cm.diffTitle")}
          <HelpTip topic="catalog.assortVsOff" />
        </p>
      )}
    </Accordion>
  );
}

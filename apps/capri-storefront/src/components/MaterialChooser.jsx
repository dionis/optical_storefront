// Dónde se usa: paso «Elegir material del cristal» del flujo de receta de la tienda
// online (pages/LensProcess.jsx, dentro de su ventana ZlxPop «zlx-pop-mat»).
//
// Diseño del dueño (24-nov-2026): recomendación según la graduación → un bloque
// que EXPLICA (el material en visión sencilla; qué es el lente en bifocal FT-28
// y progresivo) → comparativa de grosor → franja de beneficios → lista con
// etiqueta y precio. Tocar una fila o una columna elige el material y actualiza
// la explicación; «Continuar» pasa a los tratamientos. Materiales y precios son
// los de la matriz del dueño: aquí solo se pinta lo que la lista trae.
//
// Las fotos (lentes, discos de grosor, montura con las zonas) son las láminas del
// dueño recortadas en public/ui/lens/; las de la montura llevan el texto dentro,
// así que hay una por idioma. Los iconos son su juego de iconos (MaterialArt.jsx).
import { useMemo } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { L } from "../data/lensPricing.js";
import { indexLabel, isFlatTop28, materialKind, materialTags } from "../data/materialInfo.js";
import { Badge, Glyph, Medal } from "./MaterialArt.jsx";
import "../styles/material-chooser.css";

// Which of the three photographed lenses (and thickness discs) stands for a family.
const PHOTO = { cr39: "thick", poly: "medium", mid: "medium", high: "thin", ultra: "thin" };
const ROW_ICON = { cr39: "capas", poly: "escudo", mid: "pluma", high: "pluma", ultra: "pluma" };
// One icon per benefit of each family, in the order of its b1…b3 keys.
const BENEFIT_ICONS = {
  cr39: ["ojo", "verificado", "pluma"],
  poly: ["escudo", "pluma", "verificado"],
  mid: ["capas", "pluma", "verificado"],
  high: ["capas", "espejuelos", "verificado"],
  ultra: ["capas", "espejuelos", "verificado"],
};
const discPhoto = (kind) => `/ui/lens/disc-${PHOTO[kind]}.webp`;

export default function MaterialChooser({
  design, materials, priceOf, formatPrice, recommendedId, selectedId, onSelect, onContinue,
}) {
  const { t, lang } = useLang();
  // The glasses photos exist for the progressive and for the flat-top 28 bifocal;
  // any other design explains the material itself, like single vision.
  const cat = design?.cat === "prog" ? "prog" : design?.cat === "bifocal" && isFlatTop28(design) ? "bifocal" : "sv";
  const active = materials.find((m) => m.id === selectedId) || materials.find((m) => m.id === recommendedId) || materials[0] || null;
  const reco = materials.find((m) => m.id === recommendedId) || null;
  const tags = useMemo(() => materialTags(materials, priceOf), [materials, priceOf]);
  if (!active) return null;

  const kind = materialKind(active.id);
  const name = (m) => L(m.label, lang);
  const idx = indexLabel(active.id);
  const benefits = [
    t("lens.mx.kind." + kind + ".b1"),
    kind === "cr39" && tags[active.id] !== "cheapest" ? t("lens.mx.kind.cr39.b2alt") : t("lens.mx.kind." + kind + ".b2"),
    t("lens.mx.kind." + kind + ".b3"),
  ];
  const benefitIcons = BENEFIT_ICONS[kind];
  // Every lens photo the list can show, so switching material never waits for one.
  const lensKinds = [...new Set(materials.map((m) => PHOTO[materialKind(m.id)]))];
  const typeKey = cat === "prog" ? "prog" : "bif";
  const typeIcons = cat === "prog" ? ["ojo", "espejuelos", "verificado"] : ["ojo", "span", "espejuelos"];

  return (
    <div className={`mx mx-${cat} ${materials.length > 3 ? "mx-many" : ""}`}>
      {/* ── Recomendación ── */}
      {reco && (
        <div className="mx-reco">
          <Medal className="mx-reco-seal" size={38} />
          <p className="mx-reco-txt">
            <b>{t("lens.mx.recoLead")}</b>
            <span>{t("lens.mx.recoHint")}</span>
          </p>
          <span className="mx-reco-pill">{name(reco)}</span>
        </div>
      )}

      {/* ── Bloque que explica: el material (visión sencilla) o el tipo de lente ── */}
      {cat === "sv" ? (
        <section className="mx-hero mx-hero-mat" aria-live="polite">
          <div className="mx-hero-art">
            <div className="mx-hero-photos">
              {lensKinds.map((p) => (
                <img key={p} className={`mx-hero-photo ${PHOTO[kind] === p ? "on" : ""}`} src={`/ui/lens/lens-${p}.webp`}
                     alt="" aria-hidden="true" width="640" height="580" decoding="async" />
              ))}
            </div>
            <span className="mx-hero-badge">{name(active)}</span>
            <span className="mx-hero-thick"><Glyph name="thickness" size={13} /> {t("lens.mx.thick." + kind)}</span>
          </div>
          <div className="mx-hero-info">
            <h3 className="mx-hero-title">{name(active)}</h3>
            {idx && <span className="mx-hero-idx">{t("lens.mx.index", { n: idx })}</span>}
            <p className="mx-hero-desc">{t("lens.mx.kind." + kind + ".desc")}</p>
            <ul className="mx-bullets">
              {benefits.map((b, i) => (
                <li key={i}><Badge name={benefitIcons[i]} tone="gold" size={22} className="mx-bullet-ic" /> {b}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : (
        <section className={`mx-hero mx-hero-type mx-hero-${cat}`}>
          <div className="mx-scene">
            <img className="mx-scene-photo" src={`/ui/lens/glasses-${cat === "prog" ? "progressive" : "bifocal"}-${lang === "en" ? "en" : "es"}.webp`}
                 alt={t("lens.mx." + typeKey + ".photoAlt")} width="822" height="456" decoding="async" />
            <span className="mx-scene-chip">{t("lens.mx." + typeKey + ".chip")}</span>
          </div>
          <div className="mx-what">
            <h3 className="mx-what-title">{t("lens.mx." + typeKey + ".title")}</h3>
            <p className="mx-what-desc">{t("lens.mx." + typeKey + ".desc")}</p>
            <ul className="mx-what-list">
              <li><Badge name={typeIcons[0]} tone="gold" size={28} />{t("lens.mx." + typeKey + ".b1")}</li>
              <li><Badge name={typeIcons[1]} tone="gold" size={28} />{t("lens.mx." + typeKey + ".b2")}</li>
              <li>
                <Badge name={typeIcons[2]} tone="gold" size={28} />
                {cat === "prog" ? t("lens.mx.prog.b3") : materials.length === 1 ? t("lens.mx.bif.b3one") : t("lens.mx.bif.b3", { n: materials.length })}
              </li>
            </ul>
          </div>
        </section>
      )}

      {/* Este grupo solo cuenta en pantalla apaisada y baja (PC, portátil, tableta
          acostada): ahí es la columna derecha de la ventana — comparativa, lista y
          «Continuar» — junto al bloque que explica, para que todo quepa sin
          deslizar. En el resto es transparente (display: contents). */}
      <div className="mx-side">
      {/* ── Comparativa de grosor: tocar una columna también elige ── */}
      <section className="mx-compare">
        {/* El título largo de la lámina solo donde cabe en una línea. */}
        <h4 className="mx-compare-title">
          <Glyph name="capas" size={16} />
          {cat === "sv" ? t("lens.mx.compare") : <><span className="mx-wide">{t("lens.mx.compareByMat")}</span><span className="mx-narrow">{t("lens.mx.compare")}</span></>}
        </h4>
        <small className="mx-compare-note">{t("lens.mx.reference")}</small>
        <div className={`mx-compare-row ${materials.length > 4 ? "scroll" : ""}`} style={{ "--mx-cols": Math.min(materials.length, 4) }}>
          {materials.map((m) => {
            const k = materialKind(m.id);
            const n = indexLabel(m.id);
            return (
              <button type="button" key={m.id} className={`mx-col ${active.id === m.id ? "on" : ""}`}
                      aria-pressed={active.id === m.id} onClick={() => onSelect(m.id)}>
                <img className="mx-col-disc" src={discPhoto(k)} alt="" aria-hidden="true" width="440" height="160" decoding="async" />
                <b className="mx-col-name">{name(m)}</b>
                {n && <span className="mx-col-idx">({t("lens.mx.index", { n })})</span>}
                <span className="mx-col-thick">{t("lens.mx.thick." + k)}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Franja de beneficios: del material elegido; en progresivos, del lente ── */}
      {cat !== "sv" && (
        <section className="mx-strip" aria-live="polite">
          <div className="mx-strip-lead">
            <Glyph name={cat === "prog" ? "capas" : ROW_ICON[kind]} size={30} />
            <span>
              <b>{cat === "prog" ? t("lens.mx.prog.strip") : name(active)}</b>
              <small>{cat === "prog" ? t("lens.mx.prog.stripSub") : t("lens.mx.kind." + kind + ".tagline")}</small>
            </span>
          </div>
          <ul className="mx-strip-list">
            {cat === "prog" ? (
              <>
                <li><Badge name="computadora" tone="ice" size={30} /><span>{t("lens.mx.prog.u1")}</span></li>
                <li><Badge name="conduccion" tone="ice" size={30} /><span>{t("lens.mx.prog.u2")}</span></li>
                <li><Badge name="lectura" tone="ice" size={30} /><span>{t("lens.mx.prog.u3")}</span></li>
              </>
            ) : benefits.map((b, i) => (
              <li key={i}><Badge name={benefitIcons[i]} tone="ice" size={30} /><span>{b}</span></li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Lista: material, etiqueta y precio ── */}
      <div className="mx-list" role="radiogroup" aria-label={t("lens.chooseMaterial")}>
        {materials.map((m) => {
          const on = active.id === m.id;
          return (
            <button type="button" key={m.id} role="radio" aria-checked={on}
                    className={`mx-row ${on ? "on" : ""}`} onClick={() => onSelect(m.id)}>
              <span className="mx-row-radio" aria-hidden="true">{on && <Badge name="check" tone="gold" size={24} />}</span>
              <Glyph className="mx-row-ic" name={ROW_ICON[materialKind(m.id)]} size={24} />
              <span className="mx-row-name">{name(m)}</span>
              <span className="mx-row-tag">{t("lens.mx.tag." + tags[m.id])}</span>
              <span className="mx-row-price">{formatPrice(priceOf(m.id))}</span>
            </button>
          );
        })}
      </div>

      <div className="mx-foot">
        <button type="button" className="btn btn-primary zlx-pop-done zlx-step-next mx-continue" data-sfx="select"
                onClick={() => onContinue(active.id)}>
          {t("lens.mx.continue", { m: name(active) })} <span className="mx-continue-ar" aria-hidden="true">→</span>
        </button>
      </div>
      </div>
    </div>
  );
}

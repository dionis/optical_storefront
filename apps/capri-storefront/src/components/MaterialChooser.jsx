// Dónde se usa: paso «Elegir material del cristal» del flujo de receta de la tienda
// online (pages/LensProcess.jsx, dentro de su ventana ZlxPop «zlx-pop-mat»).
//
// Diseño del dueño (24-nov-2026): recomendación según la graduación → un bloque
// que EXPLICA (el material en visión sencilla; qué es el lente en bifocal y
// progresivo) → comparativa de grosor → lista con etiqueta y precio. Tocar una
// fila elige el material y actualiza la explicación; «Continuar» pasa a los
// tratamientos. Materiales y precios son los de la matriz del dueño: aquí solo
// se pinta lo que la lista trae.
import { useMemo } from "react";
import { useLang } from "../i18n/LanguageContext.jsx";
import { L } from "../data/lensPricing.js";
import { indexLabel, isFlatTop28, materialKind, materialTags, relativeThickness } from "../data/materialInfo.js";
import {
  AwardSeal, GlassesScene, GoldCheck, LensDisc, LensHeroArt,
  IcBook, IcCar, IcCheckRing, IcEye, IcFeather, IcGlasses, IcLaptop, IcLayers,
  IcShield, IcSpan, IcSparkles, IcSun, IcTag, IcThin,
} from "./MaterialArt.jsx";
import "../styles/material-chooser.css";

const KIND_ICON = { cr39: IcLayers, poly: IcShield, mid: IcFeather, high: IcFeather, ultra: IcFeather };
// One icon per bullet of each material family, in the order of its b1…b3 keys.
const KIND_BULLET_ICONS = {
  cr39: [IcEye, IcTag, IcFeather],
  poly: [IcShield, IcFeather, IcSun],
  mid: [IcThin, IcFeather, IcTag],
  high: [IcThin, IcGlasses, IcSparkles],
  ultra: [IcThin, IcGlasses, IcSparkles],
};

export default function MaterialChooser({
  design, materials, priceOf, formatPrice, recommendedId, selectedId, onSelect, onContinue,
}) {
  const { t, lang } = useLang();
  const cat = design?.cat === "prog" ? "prog" : design?.cat === "bifocal" ? "bifocal" : "sv";
  const active = materials.find((m) => m.id === selectedId) || materials.find((m) => m.id === recommendedId) || materials[0] || null;
  const reco = materials.find((m) => m.id === recommendedId) || null;
  const tags = useMemo(() => materialTags(materials, priceOf), [materials, priceOf]);
  if (!active) return null;

  const kind = materialKind(active.id);
  const name = (m) => L(m.label, lang);
  const idx = indexLabel(active.id);
  const cheapestIsActive = tags[active.id] === "cheapest";
  const bullets = [
    t("lens.mx.kind." + kind + ".b1"),
    kind === "cr39" && !cheapestIsActive ? t("lens.mx.kind.cr39.b2alt") : t("lens.mx.kind." + kind + ".b2"),
    t("lens.mx.kind." + kind + ".b3"),
  ];
  const bulletIcons = KIND_BULLET_ICONS[kind];
  const ft28 = cat === "bifocal" && isFlatTop28(design);

  return (
    <div className={`mx mx-${cat}`}>
      {/* ── Recomendación ── */}
      {reco && (
        <div className="mx-reco">
          <AwardSeal className="mx-reco-seal" />
          <div className="mx-reco-txt">
            <p className="mx-reco-lead">
              <b>{t("lens.mx.recoLead")}</b>
              <span className="mx-reco-pill">{name(reco)}</span>
            </p>
            <p className="mx-reco-hint">{t("lens.mx.recoHint")}</p>
          </div>
        </div>
      )}

      {/* ── Bloque que explica: el material (visión sencilla) o el tipo de lente ── */}
      {cat === "sv" ? (
        <section className={`mx-hero mx-hero-mat mx-k-${kind}`} aria-live="polite">
          <div className="mx-hero-art">
            <span className="mx-hero-badge">
              <b>{name(active)}</b>
            </span>
            <LensHeroArt className="mx-hero-lens" thickness={relativeThickness(active.id)} />
            <span className="mx-hero-thick"><IcThin size={14} /> {t("lens.mx.thick." + kind)}</span>
          </div>
          <div className="mx-hero-info">
            <h3 className="mx-hero-title">{name(active)}</h3>
            {idx && <span className="mx-hero-idx">{t("lens.mx.index", { n: idx })}</span>}
            <p className="mx-hero-desc">{t("lens.mx.kind." + kind + ".desc")}</p>
            <ul className="mx-bullets">
              {bullets.map((b, i) => (
                <li key={i}><GoldCheck className="mx-bullet-ic" size={18} /> {b}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : (
        <section className={`mx-hero mx-hero-type mx-hero-${cat}`}>
          <div className="mx-scene">
            <span className="mx-scene-chip">{cat === "prog" ? t("lens.mx.prog.chip") : ft28 ? t("lens.mx.bif.chip") : L(design.label, lang)}</span>
            <GlassesScene
              className="mx-scene-svg"
              kind={cat === "prog" ? "progressive" : "bifocal"}
              flatTop={ft28}
              labels={cat === "prog"
                ? { far: t("lens.mx.prog.far"), farSub: t("lens.mx.prog.farSub"), mid: t("lens.mx.prog.mid"), midSub: t("lens.mx.prog.midSub"), near: t("lens.mx.prog.near"), nearSub: t("lens.mx.prog.nearSub") }
                : { far: t("lens.mx.bif.far"), farSub: t("lens.mx.bif.farSub"), near: t("lens.mx.bif.near"), nearSub: t("lens.mx.bif.nearSub"), seg: ft28 ? t("lens.mx.bif.seg") : "" }}
            />
          </div>
          <div className="mx-what">
            <h3 className="mx-what-title">{cat === "prog" ? t("lens.mx.prog.title") : ft28 ? t("lens.mx.bif.title") : t("lens.mx.bifGen.title")}</h3>
            <p className="mx-what-desc">{cat === "prog" ? t("lens.mx.prog.desc") : ft28 ? t("lens.mx.bif.desc") : t("lens.mx.bifGen.desc")}</p>
            <ul className="mx-what-list">
              {cat === "prog" ? (
                <>
                  <li><span className="mx-what-ic"><IcEye size={17} /></span>{t("lens.mx.prog.b1")}</li>
                  <li><span className="mx-what-ic"><IcGlasses size={17} /></span>{t("lens.mx.prog.b2")}</li>
                  <li><span className="mx-what-ic"><IcCheckRing size={17} /></span>{t("lens.mx.prog.b3")}</li>
                </>
              ) : (
                <>
                  <li><span className="mx-what-ic"><IcEye size={17} /></span>{t("lens.mx.bif.b1")}</li>
                  <li><span className="mx-what-ic"><IcSpan size={17} /></span>{ft28 ? t("lens.mx.bif.b2") : t("lens.mx.bifGen.b2")}</li>
                  <li><span className="mx-what-ic"><IcGlasses size={17} /></span>{materials.length === 1 ? t("lens.mx.bif.b3one") : t("lens.mx.bif.b3", { n: materials.length })}</li>
                </>
              )}
            </ul>
          </div>
        </section>
      )}

      {/* ── Comparativa de grosor: tocar una columna también elige ── */}
      <section className="mx-compare">
        <h4 className="mx-compare-title"><IcLayers size={16} /> {cat === "sv" ? t("lens.mx.compare") : t("lens.mx.compareByMat")}</h4>
        <small className="mx-compare-note">{t("lens.mx.reference")}</small>
        <div className={`mx-compare-row ${materials.length > 4 ? "scroll" : ""}`} style={{ "--mx-cols": Math.min(materials.length, 4) }}>
          {materials.map((m) => {
            const k = materialKind(m.id);
            const n = indexLabel(m.id);
            return (
              <button type="button" key={m.id} className={`mx-col ${active.id === m.id ? "on" : ""}`}
                      aria-pressed={active.id === m.id} onClick={() => onSelect(m.id)}>
                <LensDisc className="mx-col-disc" thickness={relativeThickness(m.id)} />
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
            {cat === "prog" ? <IcLayers size={30} /> : (() => { const I = KIND_ICON[kind]; return <I size={30} />; })()}
            <span>
              <b>{cat === "prog" ? t("lens.mx.prog.strip") : name(active)}</b>
              <small>{cat === "prog" ? t("lens.mx.prog.stripSub") : t("lens.mx.kind." + kind + ".tagline")}</small>
            </span>
          </div>
          <ul className="mx-strip-list">
            {cat === "prog" ? (
              <>
                <li><IcLaptop size={24} /><span>{t("lens.mx.prog.u1")}</span></li>
                <li><IcCar size={24} /><span>{t("lens.mx.prog.u2")}</span></li>
                <li><IcBook size={24} /><span>{t("lens.mx.prog.u3")}</span></li>
              </>
            ) : bullets.map((b, i) => {
              const I = bulletIcons[i];
              return <li key={i}><I size={24} /><span>{b}</span></li>;
            })}
          </ul>
        </section>
      )}

      {/* ── Lista: material, etiqueta y precio ── */}
      <div className="mx-list" role="radiogroup" aria-label={t("lens.chooseMaterial")}>
        {materials.map((m) => {
          const on = active.id === m.id;
          const I = KIND_ICON[materialKind(m.id)];
          return (
            <button type="button" key={m.id} role="radio" aria-checked={on}
                    className={`mx-row ${on ? "on" : ""}`} onClick={() => onSelect(m.id)}>
              <span className="mx-row-radio" aria-hidden="true">{on && <GoldCheck size={24} />}</span>
              <I className="mx-row-ic" size={24} />
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
  );
}

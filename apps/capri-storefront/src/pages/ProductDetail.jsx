import { useState, useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { trackView } from "../admin/analytics.js";
import { useCatalog, recommendedCases, matchProduct } from "../data/catalogStore.js";
import ProductCard from "../components/ProductCard.jsx";
import CaseCard from "../components/CaseCard.jsx";
import Reviews from "../components/Reviews.jsx";
// Probador: el switch elige la interfaz (prod / dev-respaldo / legacy). Ver TryOnSwitch.jsx.
import TryOn from "../components/TryOnSwitch.jsx";
import { useCart } from "../components/CartContext.jsx";
import { useFeedback } from "../components/Feedback.jsx";
import { useLang } from "../i18n/LanguageContext.jsx";
import { TRY_ON_ENABLED } from "../config/features.js";
import { frameMatEdu } from "../data/lensEducation.js";
import { IconMontura } from "../components/LensGraphics.jsx";
import { IconMaterial, IconMeasures, IconGender, IconFemale, IconUnisex, IconKids, IconCamera, IconCart, Icon360 } from "../components/UiIcons.jsx";
import GlassesLoader from "../components/GlassesLoader.jsx";
import { useReviewSummary } from "../components/ReviewSummaryContext.jsx";
// Vistas 3D generadas (4 ángulos) por montura. Ver docs/frame-media-generation.md §A.10.
import { GENERATED_INDEX, GENERATED_VIEWS, videosBySku } from "../data/frameMediaSample.js";
import { resolveImage, resolveMedia } from "../data/imageUrl.js";
import { BRAND_BY_SLUG } from "../data/brands.js";
import { measureBBox, getCachedBBox, fitTransform } from "../data/frameFit.js";

// El catálogo NO trae un slug fiable, así que la unión con las vistas generadas se
// hace por SKU normalizado (coincide en las 21 monturas del piloto).
const SKU_TO_HANDLE = {};
for (const f of GENERATED_INDEX) {
  SKU_TO_HANDLE[String(f.sku || "").toLowerCase().replace(/\s+/g, "")] = f.handle;
}
const VIEW_ORDER = ["front", "left", "back", "right"];

// A veces la generación IA deja un lado duplicado o faltante (p.ej. sólo
// "left"). Construimos las 4 vistas y, si un lado falta o se repite, usamos su
// par con efecto espejo (scaleX(-1)) para tener izquierda y derecha distintas.
function build360(cv) {
  if (!cv) return {};
  const out = {};
  for (const k of VIEW_ORDER) if (cv[k]) out[k] = { key: cv[k], mirror: false };
  // La IA suele generar el lado derecho mirando en la MISMA dirección que el
  // izquierdo (o directamente falta). Volteamos SIEMPRE la vista derecha con CSS
  // (o, si no existe, usamos el espejo de la izquierda) para que izquierda y
  // derecha miren a lados opuestos. Aplica a miniatura y a imagen ampliada.
  const L = cv.left, R = cv.right;
  if (R) out.right = { key: R, mirror: true };
  else if (L) out.right = { key: L, mirror: true };
  return out;
}

// Las medidas del catalogo a veces vienen como intervalo ("51-53"). Mostramos un
// solo valor: el promedio del intervalo, redondeado.
function oneMeasure(v) {
  if (v == null || v === "") return v;
  const s = String(v).trim();
  const m = s.match(/(\d+(?:\.\d+)?)\s*[-–—aA]\s*(\d+(?:\.\d+)?)/);
  if (m) return String(Math.round((parseFloat(m[1]) + parseFloat(m[2])) / 2));
  return s;
}

export default function ProductDetail() {
  const { slug } = useParams();
  const { products: PRODUCTS, productBySlug, loading } = useCatalog();
  const product = matchProduct(slug, productBySlug, PRODUCTS);
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [tab, setTab] = useState("detalles");
  // Eje de VISTA (front/left/right/back). Independiente del color (active): solo
  // cambia qué se pinta en el visor central; se reinicia a "frontal" al cambiar de
  // montura o de color.
  const [view, setView] = useState("front");
  useEffect(() => { setView("front"); }, [slug, active]);
  // Timers del botón 360 (giro continuo al mantener pulsado).
  const spinTimer = useRef(null);
  const spinHold = useRef(null);
  useEffect(() => () => { clearTimeout(spinHold.current); clearInterval(spinTimer.current); }, []);
  // Auto-recorte del blanco: mide el bbox de cada imagen del color actual y calcula
  // el transform que la ajusta a su recuadro (recorta el máximo de blanco). Se
  // recalcula al cambiar de montura/color y al redimensionar (web ↔ responsive).
  const stackRef = useRef(null);
  const mainRef = useRef(null);
  const [fits, setFits] = useState({});
  useEffect(() => {
    const p = product;
    if (!p) { setFits({}); return; }
    const gv = GENERATED_VIEWS[SKU_TO_HANDLE[String(p.sku || "").toLowerCase().replace(/\s+/g, "")]];
    const col = p.colors[active];
    const v360 = build360(gv && col ? gv[col.name] : null);
    const entries = VIEW_ORDER.filter((v) => v360[v]).map((v) => ({ v, src: resolveImage(v360[v].key), mirror: v360[v].mirror }));
    const singleSrc = col ? col.image : null;
    let alive = true;
    const recompute = () => {
      if (!alive) return;
      if (entries.length) {
        const el = stackRef.current; if (!el) return;
        const W = el.clientWidth, H = el.clientHeight, next = {};
        for (const { v, src, mirror } of entries) {
          const bb = getCachedBBox(src);
          const st = bb ? fitTransform(W, H, bb, mirror) : null;
          if (st) next[v] = st;
        }
        setFits(next);
      } else {
        const el = mainRef.current; if (!el) return;
        const bb = getCachedBBox(singleSrc);
        const st = bb ? fitTransform(el.clientWidth, el.clientHeight, bb, false) : null;
        setFits(st ? { single: st } : {});
      }
    };
    const srcs = entries.length ? entries.map((e) => e.src) : [singleSrc];
    Promise.all(srcs.map((s) => measureBBox(s))).then(() => recompute());
    recompute();
    const ro = new ResizeObserver(recompute);
    const target = entries.length ? stackRef.current : mainRef.current;
    if (target) ro.observe(target);
    return () => { alive = false; ro.disconnect(); };
  }, [product, active]);
  // Precarga de las 4 vistas del color actual → giro fluido sin parpadeo.
  useEffect(() => {
    if (!product) return;
    const cv = GENERATED_VIEWS[SKU_TO_HANDLE[String(product.sku || "").toLowerCase().replace(/\s+/g, "")]];
    const c = product.colors[active];
    const set = cv && c ? cv[c.name] : null;
    if (!set) return;
    Object.values(set).forEach((k) => { if (k) { const im = new Image(); im.src = resolveImage(k); } });
  }, [product, active]);
  // React Router reuses this same component instance across two URLs that match the
  // same route (/producto/:slug -> /producto/:slug), so a plain `useState(false)` for
  // "is the try-on open" would survive a navigation to a DIFFERENT product instead of
  // resetting with it. Closing it from a useEffect keyed on `slug` looked like the fix,
  // but an effect runs AFTER the render that already has the new `product` — for that
  // one render, <TryOn3D> is still mounted with the new product's data and its iframe's
  // `src` changes mid-flight, one render before the effect closes it. Storing which
  // slug the try-on was opened FOR and comparing it to the current slug closes it in
  // the very same render the slug changes in, no effect and no gap. This is what
  // showed up as "DOMException: the document is not fully active" and the whole try-on
  // appearing to restart under a different SKU.
  const [tryOnSlug, setTryOnSlug] = useState(null);
  const tryOn = tryOnSlug === slug;
  const { addVariant, toggleFav, isFav, busy } = useCart();
  const { toast } = useFeedback();
  const { t, tv, lang } = useLang();
  const navigate = useNavigate();
  // Hook order matters: this must run before the `if (!product)` early return,
  // or React sees a different hook count between renders and crashes.
  const review = useReviewSummary(slug);
  useEffect(() => { if (product) try { trackView(); } catch {} }, [slug]);


  // Add the frame at its base price via the server cart (no local total).
  const addFrame = async (variantId) => {
    if (!variantId) { toast({ tone: "info", message: t("cart.noVariant") }); return; }
    try { await addVariant(variantId); toast({ tone: "success", message: t("common.addCart") }); }
    catch { toast({ tone: "error", message: t("cart.addError") }); }
  };

  if (!product) {
    // Deep-link / refresh guard: the live catalog (and this slug) only exists once
    // the startup load settles. While it's in flight, show a loader instead of a
    // false "not found"; only reject once loading has finished and the slug is
    // genuinely absent.
    if (loading) {
      return (
        <div className="section">
          <GlassesLoader />
        </div>
      );
    }
    return <div className="section"><p>{t("notfound")} <Link to="/catalogo">{t("notfound.link")}</Link></p></div>;
  }

  const color = product.colors[active];

  // Vistas generadas (4 ángulos) de ESTE color, si existen para este SKU. Los
  // valores son claves R2 → se resuelven con resolveImage(). Si una vista no carga,
  // cae a la imagen actual del color (nunca un recuadro roto). Sin vistas: ficha
  // como hoy.
  const genViews = GENERATED_VIEWS[SKU_TO_HANDLE[String(product.sku || "").toLowerCase().replace(/\s+/g, "")]];
  const colorViews = genViews && color ? genViews[color.name] : null;
  const views360 = build360(colorViews);
  const hasViews = Object.keys(views360).length > 0;
  const curView = views360[view];
  const mainSrc = curView ? resolveImage(curView.key) : (color ? color.image : "");
  const mainMirror = !!(curView && curView.mirror);

  // Vídeo comercial de ESTE color, si existe. Sale del MISMO fixture que las vistas,
  // no de la metadata de Medusa: leerlo de Medusa exigiría VITE_USE_MEDUSA=true, y ese
  // flag deja fuera 118 monturas del catálogo (solo admite 9 colecciones), entre ellas
  // 20 de las 21 que hoy tienen medios. Precio de esta decisión: el fixture es una foto
  // fija — hay que regenerarlo tras cada corrida con `media fixture` y desplegar.
  const genVideos = videosBySku(product.sku);
  const videoKey = genVideos && color ? genVideos[color.name] : null;
  const videoSrc = videoKey ? resolveMedia(videoKey) : null;
  // Un vídeo puede existir sin las 4 vistas, así que el rail se muestra por
  // cualquiera de las dos cosas.
  const showRail = hasViews || !!videoSrc;
  const showingVideo = view === "video" && !!videoSrc;

  const related = PRODUCTS.filter((p) => p.brand_slug === product.brand_slug && p.slug !== product.slug).slice(0, 4);
  const cases = recommendedCases(product.sku, 3);

  // Requisito 6: info comercial del marco al abrirlo.
  //  - número de serie (modelo) = SKU; colección/marca = brand.
  //  - material del marco + explicación de calidad (para qué sirve / para qué no)
  //    con la copia comercial bilingüe de FRAME_MATERIAL_EDU.
  const frameMaterials = product.attributes.material || [];
  // Primer material del marco que tenga copia educativa disponible.
  const eduMaterial = frameMaterials.find((m) => frameMatEdu(m, lang)) || frameMaterials[0];
  const frameEdu = eduMaterial ? frameMatEdu(eduMaterial, lang) : null;

  // Datos clave para la ficha estilo mockup: forma, medidas (ojo-puente-varilla)
  // y género con su icono.
  const shapeLabel = tv(product.attributes.shape);
  // Sello de marca (monograma): iniciales de la marca; el nombre completo sale
  // al pasar el cursor. Los logos de marca son wordmarks externos, así que un
  // monograma es más limpio y fiable como "sello de calidad".
  const brandWords = (product.brand || "").trim().split(/\s+/).filter(Boolean);
  const brandInitials = (brandWords.length >= 2 ? (brandWords[0][0] + brandWords[1][0]) : (brandWords[0] || "").slice(0, 1)).toUpperCase();
  // Sello de calidad = logo REAL de la marca (el mismo del catálogo/sección Marcas).
  // Si no hay logo para esta marca, cae al monograma de iniciales.
  const brandInfo = BRAND_BY_SLUG[product.brand_slug];
  const brandLogo = brandInfo ? brandInfo.logo : null;
  const measures = [product.attributes.eye_size, product.attributes.bridge_size, product.attributes.temple_length]
    .map(oneMeasure).filter((x) => x != null && x !== "").join(" - ");
  const genderVal = product.attributes.gender;
  const isKidsFrame = product.attributes.age === "Niños";
  const GenderIcon = isKidsFrame ? IconKids
    : genderVal === "Hombres" ? IconGender
    : genderVal === "Señoras" ? IconFemale
    : genderVal === "Unisexo" ? IconUnisex
    : IconGender;
  const genderLabel = isKidsFrame ? t("g.kids")
    : genderVal === "Hombres" ? t("g.male")
    : genderVal === "Señoras" ? t("g.female")
    : genderVal === "Unisexo" ? t("g.unisex")
    : (genderVal ? tv(genderVal) : "");

  // Botón 360: clic = avanza una vista; mantener pulsado = giro continuo. El
  // orden de VIEW_ORDER (front → left → back → right) da sensación de giro.
  const spin360 = (dir = 1) => {
    const avail = VIEW_ORDER.filter((v) => views360[v]);
    if (!avail.length) return;
    setView((prev) => {
      const i = avail.indexOf(prev);
      return avail[((i < 0 ? 0 : i) + dir + avail.length) % avail.length];
    });
  };
  const start360 = (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    spin360(1);
    clearTimeout(spinHold.current);
    clearInterval(spinTimer.current);
    spinHold.current = setTimeout(() => {
      spinTimer.current = setInterval(() => spin360(1), 190);
    }, 320);
  };
  const stop360 = () => { clearTimeout(spinHold.current); clearInterval(spinTimer.current); spinTimer.current = null; };

  return (
    <div className="pdp">
      <div className="breadcrumb">
        <button type="button" className="bc-back" onClick={() => navigate(-1)}>← {t("pdp.back")}</button> / <Link to="/catalogo">{t("pdp.frames")}</Link> / <span>{product.name}</span>
      </div>

      <div className="pdp-grid">
        <div className="pdp-gallery">
          <div className={`pdp-stage ${showRail ? "has-views" : ""}`}>
            {showRail && (
              <div className="pdp-views" role="tablist" aria-label={t("pdp.views")}>
                {hasViews && VIEW_ORDER.map((vw) => views360[vw] ? (
                  <button key={vw} type="button" role="tab" aria-selected={view === vw}
                          className={`pdp-view ${view === vw ? "sel" : ""}`}
                          onClick={() => setView(vw)} title={t(`pdp.view.${vw}`)}>
                    <img src={resolveImage(views360[vw].key)} alt={t(`pdp.view.${vw}`)} loading="lazy"
                         className={views360[vw].mirror ? "mirror" : ""}
                         onError={(e) => { if (color && e.currentTarget.src !== color.image) e.currentTarget.src = color.image; }} />
                  </button>
                ) : null)}
                {/* Un elemento más del rail, no una fila aparte: el vídeo es otra
                    vista de la misma montura. Sin póster generado, la miniatura es la
                    foto del color con un ▶ encima. */}
                {videoSrc && (
                  <button type="button" role="tab" aria-selected={view === "video"}
                          className={`pdp-view pdp-view-video ${view === "video" ? "sel" : ""}`}
                          onClick={() => setView("video")} title={t("pdp.view.video")}>
                    <img src={color.image} alt={t("pdp.view.video")} loading="lazy" />
                    <span className="pdp-view-play" aria-hidden>▶</span>
                  </button>
                )}
              </div>
            )}
            <div ref={mainRef} className={`pdp-main zlx-float ${zoom ? "zoom" : ""}`} onClick={() => setZoom((z) => !z)}>
              {!showingVideo && (<>
              <button className={`heart ${isFav(product.slug) ? "on" : ""}`}
                      onClick={(e) => { e.stopPropagation(); toggleFav({ slug: product.slug, name: product.name, price: product.price, image: color.image, brand: product.brand, variantId: (product.colors[0] || {}).variantId }); }}
                      aria-label={t("a11y.fav")}>{isFav(product.slug) ? "♥" : "♡"}</button>
              {/* Identidad arriba a la derecha: sello de marca (hover → nombre) + modelo/color. */}
              <div className="pdp-idtag" onClick={(e) => e.stopPropagation()}>
                <span className={`pdp-brandseal ${brandLogo ? "has-logo" : ""}`} tabIndex={0} role="img" aria-label={product.brand} title={product.brand}>
                  {brandLogo && (
                    <img className="pdp-brandseal-img" src={brandLogo} alt={product.brand} loading="lazy"
                         onError={(e) => { const s = e.currentTarget.closest(".pdp-brandseal"); if (s) s.classList.remove("has-logo"); e.currentTarget.style.display = "none"; }} />
                  )}
                  <span className="pdp-brandseal-mono">{brandInitials}</span>
                  <span className="pdp-brandseal-tip">{product.brand}</span>
                </span>
                <h1 className="pdp-idtag-model">{product.name}{color ? ` · ${color.name}` : ""}</h1>
              </div>
              </>)}
              {showingVideo ? (
                <video
                  key={videoSrc}
                  className="fade-in pdp-video"
                  src={videoSrc}
                  /* Todavía no se generan pósters: la foto del color hace de cartel. */
                  poster={color.image}
                  controls
                  playsInline
                  /* "metadata", no "none". Veo devuelve el MP4 con el índice `moov` al
                     FINAL (sin faststart), y con preload="none" Firefox no va a buscarlo:
                     el vídeo simplemente no arranca. Chrome sí lo pide por rango y disimula
                     el problema — de ahí el clásico "en Chrome va y en Firefox no".
                     Con "metadata" el navegador trae solo el índice (decenas de KB), no el
                     clip entero, así que sigue sin descargarse el megabyte hasta que alguien
                     pulsa play. El arreglo de fondo es remuxar con `-movflags +faststart`. */
                  preload="metadata"
                  /* El visor hace zoom al hacer clic; sin frenar la propagación,
                     pulsar "play" dispararía el zoom en vez de reproducir. */
                  onClick={(e) => e.stopPropagation()}
                />
              ) : hasViews ? (
                /* Las 4 vistas pre-renderizadas y apiladas; sólo cambia la opacidad
                   → giro continuo sin parpadeo al cambiar de foto. */
                <div className="pdp-360stack" ref={stackRef}>
                  {VIEW_ORDER.filter((v) => views360[v]).map((v) => (
                    <div key={v} className={`pdp-360fit ${view === v ? "on" : ""}`} style={fits[v] || undefined}>
                      <img src={resolveImage(views360[v].key)} draggable="false"
                           alt={`${product.name} ${color.name} · ${t(`pdp.view.${v}`)}`}
                           className={`pdp-360frame ${views360[v].mirror ? "mirror" : ""} ${view === v ? "on" : ""}`}
                           onError={(e) => { if (color && e.currentTarget.src !== color.image) e.currentTarget.src = color.image; }} />
                    </div>
                  ))}
                </div>
              ) : (
                <img src={mainSrc} alt={`${product.name} ${color.name} · ${t(`pdp.view.${view}`)}`} className={mainMirror ? "mirror" : ""}
                     style={fits.single ? { transform: (mainMirror ? "scaleX(-1) " : "") + fits.single.transform, transformOrigin: fits.single.transformOrigin } : undefined}
                     onError={(e) => { if (color && e.currentTarget.src !== color.image) e.currentTarget.src = color.image; else e.currentTarget.style.opacity = 0.3; }} />
              )}
              {hasViews && !showingVideo && (
                <button type="button" className="pdp-360" aria-label="360°" title="360°"
                        onPointerDown={start360} onPointerUp={stop360}
                        onPointerLeave={stop360} onPointerCancel={stop360}
                        onClick={(e) => e.stopPropagation()}>
                  <img src="/icon-360.png" alt="360°" />
                </button>
              )}
              {/* Selector de color (solo circulos) centrado, en la linea del boton 360.
                  Sin texto: el color ya sale en el titulo (DC 50 · Grey). */}
              {!showingVideo && product.colors.length > 1 && (
                <div className="pdp-swatches" onClick={(e) => e.stopPropagation()}>
                  {product.colors.map((c, i) => (
                    <button key={c.name} type="button" className={`pdp-swatch ${i === active ? "sel" : ""}`}
                            style={{ background: c.hex }} onClick={(e) => { e.stopPropagation(); setActive(i); }}
                            aria-label={c.name} title={c.name} />
                  ))}
                </div>
              )}
              {/* Estrellas abajo-izquierda (misma linea que colores y 360). Vacias y
                  semi-transparentes si no hay reseñas; se llenan segun el promedio. */}
              {!showingVideo && (
                <div className="pdp-stars" onClick={(e) => e.stopPropagation()}
                     aria-label={review ? `${review.average.toFixed(1)} / 5 (${review.count})` : t("rev.none")}
                     title={review ? `${review.average.toFixed(1)} / 5 · ${review.count}` : t("rev.none")}>
                  <span className="pdp-stars-base">★★★★★</span>
                  <span className="pdp-stars-fill" style={{ width: `${((review ? review.average : 0) / 5) * 100}%` }}>★★★★★</span>
                </div>
              )}
              {TRY_ON_ENABLED && (
                <button className="pdp-ar" onClick={(e) => { e.stopPropagation(); setTryOnSlug(slug); }}>◈ {t("card.ar")}</button>
              )}
            </div>
          </div>

          <div className="pdp-thumbs">
            {product.colors.map((c, i) => (
              <button key={c.name} className={`pdp-thumb ${i === active ? "sel" : ""}`} onClick={() => setActive(i)}>
                <img src={c.image} alt={c.name} onError={(e)=>{e.currentTarget.style.opacity=0.3;}} />
              </button>
            ))}
          </div>
        </div>

        <div className="pdp-info">
          {/* Datos clave con iconos: material · medidas · género. */}
          <div className="pdp-facts">
            {frameMaterials.length > 0 && (
              <div className="pdp-fact">
                <IconMaterial className="pdp-fact-ic" />
                <div className="pdp-fact-tx"><span className="pdp-fact-k">{t("spec.material")}</span><b>{frameMaterials.map(tv).join(" · ")}</b></div>
              </div>
            )}
            {measures && (
              <div className="pdp-fact">
                <IconMeasures className="pdp-fact-ic" />
                <div className="pdp-fact-tx"><span className="pdp-fact-k">{t("pdp.metaMeasures")}</span><b>{measures}</b></div>
              </div>
            )}
            {genderLabel && (
              <div className="pdp-fact">
                <GenderIcon className="pdp-fact-ic" />
                <div className="pdp-fact-tx"><span className="pdp-fact-k">{t("spec.gender")}</span><b>{genderLabel}</b></div>
              </div>
            )}
          </div>

          {/* Acciones: probar con cámara + añadir al carrito (abre el flujo de
              recetas para elegir lentes y comprar — no se pierde esa función). */}
          <div className="pdp-actions2">
            {TRY_ON_ENABLED && (
              <button type="button" className="btn btn-primary big pdp-cta" onClick={() => setTryOnSlug(slug)}>
                <IconCamera className="pdp-cta-ic" /> {t("tryon.cta")}
              </button>
            )}
            <button type="button" className="btn btn-outline big pdp-cta"
                    onClick={() => navigate(`/recetas/${product.slug}?color=${active}`)}>
              <IconCart className="pdp-cta-ic" /> {t("card.addToCart")}
            </button>
          </div>
        </div>
      </div>

      {/* Pestañas: Detalles del producto · Medidas · Opiniones. */}
      <div className="pdp-tabs" role="tablist" aria-label={product.name}>
        <button type="button" role="tab" aria-selected={tab === "detalles"} className={`pdp-tab ${tab === "detalles" ? "on" : ""}`} onClick={() => setTab("detalles")}>{t("pdp.tab.details")}</button>
        <button type="button" role="tab" aria-selected={tab === "medidas"} className={`pdp-tab ${tab === "medidas" ? "on" : ""}`} onClick={() => setTab("medidas")}>{t("pdp.tab.measures")}</button>
        <button type="button" role="tab" aria-selected={tab === "opiniones"} className={`pdp-tab ${tab === "opiniones" ? "on" : ""}`} onClick={() => setTab("opiniones")}>{t("pdp.tab.reviews")} ({review ? review.count : 0})</button>
      </div>

      <div className="pdp-tabpanel">
        {tab === "detalles" && (
          <div className="pdp-details">
            {/* Ficha comercial del marco: modelo, colección, material. */}
            <div className="frame-id">
              <span className="frame-id-chip"><span className="frame-id-k">{t("frame.model")}</span> {product.sku}</span>
              <span className="frame-id-chip"><span className="frame-id-k">{t("frame.collection")}</span> {product.brand}</span>
              {frameMaterials.length > 0 && (
                <span className="frame-id-chip"><IconMontura className="frame-id-ic" size={16} aria-hidden="true" /><span className="frame-id-k">{t("frame.material")}</span> {frameMaterials.map(tv).join(" · ")}</span>
              )}
            </div>

            <table className="specs">
              <tbody>
                <tr><td>{t("spec.brand")}</td><td>{product.brand}</td></tr>
                <tr><td>{t("spec.shape")}</td><td>{tv(product.attributes.shape) || "—"}</td></tr>
                <tr><td>{t("spec.material")}</td><td>{product.attributes.material.map(tv).join(", ")}</td></tr>
                <tr><td>{t("spec.gender")}</td><td>{tv(product.attributes.gender)}</td></tr>
                <tr><td>{t("spec.age")}</td><td>{tv(product.attributes.age)}</td></tr>
                <tr><td>{t("spec.eye")}</td><td>{oneMeasure(product.attributes.eye_size)}</td></tr>
                <tr><td>{t("spec.bridge")}</td><td>{oneMeasure(product.attributes.bridge_size)}</td></tr>
                <tr><td>{t("spec.temple")}</td><td>{oneMeasure(product.attributes.temple_length)}</td></tr>
              </tbody>
            </table>

            {/* Educación de calidad del material del marco. */}
            {frameEdu && (
              <div className="frame-quality">
                <div className="frame-quality-head">
                  <IconMontura className="frame-quality-ic" size={20} aria-hidden="true" />
                  <b>{t("frame.qualityTitle")}: {tv(eduMaterial)}</b>
                </div>
                {frameEdu.quality && <p className="frame-quality-lead">{frameEdu.quality}</p>}
                <ul className="frame-quality-list">
                  <li className="good"><span aria-hidden>✓</span> <span><b>{t("frame.goodFor")}:</b> {frameEdu.good}</span></li>
                  <li className="bad"><span aria-hidden>✕</span> <span><b>{t("frame.badFor")}:</b> {frameEdu.bad}</span></li>
                </ul>
              </div>
            )}
          </div>
        )}

        {tab === "medidas" && (
          <div className="pdp-measures">
            <div className="pdp-measure">
              <IconMeasures className="pdp-measure-ic" />
              <span className="pdp-measure-k">{t("spec.eye")}</span>
              <b>{oneMeasure(product.attributes.eye_size)} mm</b>
            </div>
            <div className="pdp-measure">
              <IconMeasures className="pdp-measure-ic" />
              <span className="pdp-measure-k">{t("spec.bridge")}</span>
              <b>{oneMeasure(product.attributes.bridge_size)} mm</b>
            </div>
            <div className="pdp-measure">
              <IconMeasures className="pdp-measure-ic" />
              <span className="pdp-measure-k">{t("spec.temple")}</span>
              <b>{oneMeasure(product.attributes.temple_length)} mm</b>
            </div>
          </div>
        )}

        {tab === "opiniones" && (
          <Reviews product={product} />
        )}
      </div>

      {/* Cross-sell: recommended cases */}
      <section className="section case-cross">
        <div className="case-cross-head">
          <h2 className="section-title">{t("case.recommend")}</h2>
          <span className="muted">{t("case.recommendSub")}</span>
        </div>
        <div className="case-grid three">
          {cases.map((c) => <CaseCard key={c.slug} item={c} compact />)}
        </div>
      </section>

      {related.length > 0 && (
        <section className="section">
          <h2 className="section-title">{t("pdp.moreOf")} {product.brand}</h2>
          <div className="product-grid">
            {related.map((p) => <ProductCard key={p.slug} product={p} />)}
          </div>
        </section>
      )}

      {TRY_ON_ENABLED && tryOn && (
        <TryOn product={product} colorIdx={active} onClose={() => setTryOnSlug(null)} />
      )}
    </div>
  );
}

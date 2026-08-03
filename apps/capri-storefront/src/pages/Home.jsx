import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BRANDS } from "../data/brands.js";
import { brandHeroImage, brandInfo } from "../data/brandMedia.js";
import { LOOKBOOK_BY_ID, lookbookTag } from "../data/lookbook.js";
import { useCatalog } from "../data/catalogStore.js";
import ProductCard from "../components/ProductCard.jsx";
import { useLang } from "../i18n/LanguageContext.jsx";

const IMG = "https://caprioptics.com/wp-content/uploads/";

// Carrusel del hero: usa las fotos del lookbook (subidas por el usuario). `ref` = id en lookbook.js.
// Imágenes NO repetidas con el collage ni las tarjetas de estilo (ver auditoría abajo).
const HERO_SLIDES = [
  { ref: 2, tk: "hero.s1.title", sk: "hero.s1.sub", badge: "hero.s1.badge", to: "/catalogo?gender=Hombres" },
  { ref: 5, tk: "hero.s2.title", sk: "hero.s2.sub", badge: "hero.s2.badge", to: "/catalogo?gender=Se%C3%B1oras" },
  { ref: 14, tk: "hero.s3.title", sk: "hero.s3.sub", badge: "hero.s3.badge", to: "/catalogo?gender=Se%C3%B1oras" },
];
// Tira lateral de "looks reales": otras fotos del lookbook, sin repetir con el resto de la home.
const HERO_THUMBS = [
  { ref: 7, to: "/catalogo?gender=Se%C3%B1oras" },
  { ref: 11, to: "/catalogo?gender=Hombres" },
  { ref: 4, to: "/catalogo?gender=Se%C3%B1oras" },
];

const STYLE_CHIPS = [
  { key: "home.chip.all", to: "/catalogo" },
  { key: "home.chip.women", param: "gender", value: "Señoras" },
  { key: "home.chip.men", param: "gender", value: "Hombres" },
  { key: "home.chip.unisex", param: "gender", value: "Unisexo" },
  { key: "home.chip.kids", param: "age", value: "Niños" },
  { key: "home.chip.aviator", param: "shape", value: "Aviador" },
  { key: "home.chip.cateye", param: "shape", value: "Ojo de gato" },
  { key: "home.chip.round", param: "shape", value: "Redondo" },
];

// Íconos inline (SVG, sin dependencias) para cada chip de estilo. Mejoran la
// lectura sobre todo en móvil, donde el texto solo se ve pobre. `currentColor`
// hace que hereden el color del chip (y su estado hover/activo).
const svg = (children) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const CHIP_ICONS = {
  "home.chip.all": svg(<><circle cx="6.5" cy="14" r="3.3" /><circle cx="17.5" cy="14" r="3.3" /><path d="M9.8 13.4c1.2-1.1 3.2-1.1 4.4 0M2.6 12l1.6-2M21.4 12l-1.6-2" /></>),
  "home.chip.women": svg(<><circle cx="12" cy="8" r="5" /><path d="M12 13v8M9 18h6" /></>),
  "home.chip.men": svg(<><circle cx="10" cy="14" r="5" /><path d="M15 9l5-5M15 4h5v5" /></>),
  "home.chip.unisex": svg(<><circle cx="12" cy="7" r="3.6" /><path d="M5.5 20c0-3.6 2.9-6.2 6.5-6.2S18.5 16.4 18.5 20" /></>),
  "home.chip.kids": svg(<><circle cx="12" cy="6" r="3" /><path d="M12 9v6M8.5 21l3.5-6 3.5 6M8.5 12.5h7" /></>),
  "home.chip.aviator": svg(<><path d="M3 10h7c0 3-1.6 5-3.5 5S3 13 3 10z" /><path d="M14 10h7c0 3-1.6 5-3.5 5S14 13 14 10z" /><path d="M10 11h4M3 10 2 9M21 10l1-1" /></>),
  "home.chip.cateye": svg(<><path d="M2 12c2-3 6-3 8-.5-.2 2.2-2 3.5-4 3.5S2.4 14 2 12z" /><path d="M14 11.5c2-2.5 6-2.5 8 .5-.4 2-2.1 3-4 3s-3.8-1.3-4-3.5z" /><path d="M10 11.5h4" /></>),
  "home.chip.round": svg(<><circle cx="7" cy="13" r="4" /><circle cx="17" cy="13" r="4" /><path d="M11 12.5h2M3.4 11 2 9.6M20.6 11 22 9.6" /></>),
};

const SHAPES = [
  { key: "home.shape.round", value: "Redondo", lens: "round" },
  { key: "home.shape.square", value: "Cuadrado", lens: "square" },
  { key: "home.shape.rect", value: "Rectángulo", lens: "rect" },
  { key: "home.shape.aviator", value: "Aviador", lens: "aviator" },
  { key: "home.shape.cat", value: "Ojo de gato", lens: "cat" },
  { key: "home.shape.oval", value: "Oval", lens: "oval" },
];

// Cada "mood" lleva a un filtro real del catálogo (género/forma). `ref` = id del lookbook.
const MOODS = [
  { ref: 16, tk: "home.mood1.t", dk: "home.mood1.d", to: "/catalogo?gender=Unisexo" },
  { ref: 15, tk: "home.mood2.t", dk: "home.mood2.d", to: "/catalogo?shape=Cuadrado" },
  { ref: 10, tk: "home.mood3.t", dk: "home.mood3.d", to: "/catalogo?shape=Redondo" },
];

// Collage: solo retratos de UNA persona con espejuelos. Cada foto se liga a un marco real
// del catálogo (de la marca correspondiente): al pasar el cursor muestra el marco a comprar,
// al hacer clic va a su ficha para comprarlo. `brand` = brand_slug para elegir el producto.
const COLLAGE = [
  { ref: 1, brand: "di-caprio" },
  { ref: 3, brand: "candy-shoppe" },
  { ref: 6, brand: "peachtree" },
  { ref: 8, brand: "grande" },
  { ref: 9, brand: "trendy" },
  { ref: 13, brand: "simply-lite" },
];

// Elige el marco (producto) a comprar para cada foto del collage.
function pickFrame(products, brandSlug, i) {
  if (brandSlug) {
    const hit = products.find((p) => p.brand_slug === brandSlug);
    if (hit) return hit;
  }
  return products[i % products.length];
}

const chipHref = (c) => c.to || `/catalogo?${c.param}=${encodeURIComponent(c.value)}`;

function Lens({ type, x }) {
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 5, strokeLinejoin: "round" };
  if (type === "round") return <circle cx={x} cy="30" r="15" {...s} />;
  if (type === "oval") return <ellipse cx={x} cy="30" rx="17" ry="12" {...s} />;
  if (type === "square") return <rect x={x - 15} y="17" width="30" height="26" rx="6" {...s} />;
  if (type === "rect") return <rect x={x - 18} y="20" width="36" height="20" rx="6" {...s} />;
  if (type === "aviator") return <path d={`M${x - 16} 20 h32 l-4 15 q-3 8 -12 8 q-9 0 -12 -8 z`} {...s} />;
  if (type === "cat") return <path d={`M${x - 17} 21 q7 -5 17 -3 q10 2 15 1 q-2 12 -12 16 q-13 4 -19 -6 q-3 -5 -1 -8 z`} {...s} />;
  return null;
}
function GlassesIcon({ type }) {
  return (
    <svg viewBox="0 0 100 60" width="60" height="36" aria-hidden="true">
      <Lens type={type} x={28} />
      <Lens type={type} x={72} />
      <path d="M43 28 q7 -6 14 0" fill="none" stroke="currentColor" strokeWidth="4" />
    </svg>
  );
}

export default function Home() {
  const { t, lang } = useLang();
  const { products: PRODUCTS } = useCatalog();
  const featured = PRODUCTS.slice(0, 12);

  // Carrusel del hero (avance automático + control manual)
  const [slide, setSlide] = useState(0);
  // Marca destacada en la sección Marcas (cambia al pasar el cursor).
  // Por defecto una marca cuya foto no aparece en ninguna otra parte de la home.
  const [hoverBrand, setHoverBrand] = useState("flexure");
  const nSlides = HERO_SLIDES.length;
  useEffect(() => {
    const id = setInterval(() => setSlide((s) => (s + 1) % nSlides), 5500);
    return () => clearInterval(id);
  }, [nSlides]);

  // Animación de aparición al hacer scroll
  useEffect(() => {
    const els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) { els.forEach((el) => el.classList.add("is-in")); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [PRODUCTS.length]);

  return (
    <div>
      <section className="hero-zee">
        <div className="hero-zee-inner">
          <div className="hero-zee-left" key={slide}>
            <span className="hero-kicker">Óptica El Rancho · RUBI_LENS</span>
            <h1 className="hero-zee-title">{t(HERO_SLIDES[slide].tk)}</h1>
            <p className="hero-zee-sub">{t(HERO_SLIDES[slide].sk)}</p>
            <div className="hero-cta">
              <Link to="/catalogo" className="btn btn-primary">{t("hero.cta1")}</Link>
              <Link to="/catalogo" className="btn btn-outline">{t("hero.cta2")}</Link>
            </div>
          </div>

          <div className="hero-zee-main">
            {HERO_SLIDES.map((s, i) => (
              <Link key={i} to={s.to} aria-label={t(s.tk)} data-model={lookbookTag(s.ref)}
                    className={`hero-zee-photo${i === slide ? " is-active" : ""}`}>
                <img src={LOOKBOOK_BY_ID[s.ref].src} alt="" loading={i === 0 ? "eager" : "lazy"}
                     onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
              </Link>
            ))}
            <span className="hero-badge" key={`b${slide}`}>
              {t(HERO_SLIDES[slide].badge).split("\n").map((l, i) => <span key={i}>{l}</span>)}
            </span>
            <button className="hero-arrow prev" aria-label="Anterior"
                    onClick={() => setSlide((s) => (s - 1 + nSlides) % nSlides)}>‹</button>
            <button className="hero-arrow next" aria-label="Siguiente"
                    onClick={() => setSlide((s) => (s + 1) % nSlides)}>›</button>
            <div className="hero-dots">
              {HERO_SLIDES.map((_, i) => (
                <button key={i} className={i === slide ? "is-on" : ""} aria-label={`Slide ${i + 1}`}
                        onClick={() => setSlide(i)} />
              ))}
            </div>
          </div>

          <div className="hero-zee-strip">
            {HERO_THUMBS.map((th, i) => (
              <Link className="hero-thumb" key={i} to={th.to} aria-label={t("hero.cta1")} data-model={lookbookTag(th.ref)}>
                <img src={LOOKBOOK_BY_ID[th.ref].src} alt="" loading="lazy"
                     onError={(e) => { const p = e.currentTarget.closest(".hero-thumb"); if (p) p.style.display = "none"; }} />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section style-picker reveal">
        <div className="section-center">
          <h2 className="section-title">{t("home.style.title")}</h2>
          <p className="section-sub">{t("home.style.sub")}</p>
        </div>
        <div className="chip-row">
          {STYLE_CHIPS.map((c) => (
            <Link key={c.key} to={chipHref(c)} className="style-chip">
              {CHIP_ICONS[c.key] && <span className="style-chip-ic">{CHIP_ICONS[c.key]}</span>}
              <span>{t(c.key)}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="section moods-section reveal">
        <div className="split split-70-30">
          <div className="mood-grid">
            {MOODS.map((m) => (
              <Link key={m.tk} to={m.to} className="mood-card" data-model={lookbookTag(m.ref)}>
                <div className="mood-img">
                  <img src={LOOKBOOK_BY_ID[m.ref].src} alt={t(m.tk)} loading="lazy"
                       onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  <span className="mood-badge">{t("home.moods.badge")}</span>
                </div>
                <div className="mood-body">
                  <h3>{t(m.tk)}</h3>
                  <p>{t(m.dk)}</p>
                  <span className="mood-link">{t("home.moods.badge")} →</span>
                </div>
              </Link>
            ))}
          </div>
          <aside className="split-aside">
            <span className="aside-kicker">RUBI_LENS</span>
            <h2 className="section-title left">{t("home.moods.title")}</h2>
            <p className="section-sub left">{t("home.moods.aside.text")}</p>
            <Link to="/catalogo" className="btn btn-primary">{t("home.moods.aside.cta")}</Link>
          </aside>
        </div>
      </section>

      <section className="section shape-shop reveal">
        <div className="split split-30-70">
          <aside className="split-aside">
            <span className="aside-kicker">RUBI_LENS</span>
            <h2 className="section-title left">{t("home.shapes.title")}</h2>
            <p className="section-sub left">{t("home.shapes.sub")}</p>
            <Link to="/catalogo" className="btn btn-outline">{t("home.shapes.cta")}</Link>
          </aside>
          <div className="shape-row">
            {SHAPES.map((s) => (
              <Link key={s.value} to={`/catalogo?shape=${encodeURIComponent(s.value)}`} className="shape-tile">
                <span className="shape-ico"><GlassesIcon type={s.lens} /></span>
                <span className="shape-name">{t(s.key)}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section collage-section reveal">
        <div className="section-center">
          <h2 className="section-title">{t("home.collage.title")}</h2>
          <p className="section-sub">{t("home.collage.sub")}</p>
        </div>
        <div className="collage">
          {COLLAGE.map((c, i) => {
            const prod = PRODUCTS.length ? pickFrame(PRODUCTS, c.brand, i) : null;
            if (!prod) return null;
            const frame = prod.colors && prod.colors[0] ? prod.colors[0].image : "";
            return (
              <Link key={i} to={`/producto/${prod.slug}`} className="collage-tile"
                    data-sku={prod.sku || prod.name} data-model={lookbookTag(c.ref)}
                    data-brand={LOOKBOOK_BY_ID[c.ref].brand || prod.brand}
                    aria-label={`Comprar ${prod.name}`}>
                <img className="collage-face" src={LOOKBOOK_BY_ID[c.ref].src} alt="" loading="lazy"
                     onError={(e) => { const t = e.currentTarget.closest(".collage-tile"); if (t) t.style.display = "none"; }} />
                <span className="collage-hover">
                  <img className="collage-frame" src={frame} alt={prod.name} loading="lazy" />
                  <span className="collage-info">
                    <b>{prod.name}</b>
                    <em>${Number(prod.price).toFixed(2)}</em>
                    <span className="collage-buy">{t("home.collage.buy")}</span>
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="section props reveal">
        <div className="prop"><span>◈</span><b>{t("prop.ar")}</b><small>{t("prop.ar.sub")}</small></div>
        <div className="prop"><span>℞</span><b>{t("prop.rx")}</b><small>{t("prop.rx.sub")}</small></div>
        <div className="prop"><span>⇄</span><b>{t("prop.warranty")}</b><small>{t("prop.warranty.sub")}</small></div>
        <div className="prop"><span>✈</span><b>{t("prop.ship")}</b><small>{t("prop.ship.sub")}</small></div>
      </section>

      <section className="section reveal">
        <div className="section-head">
          <h2 className="section-title">{t("section.bestsellers")}</h2>
          <Link to="/catalogo" className="see-all">{t("section.seeall")}</Link>
        </div>
        <div className="product-scroller">
          {featured.map((p) => (
            <div className="scroller-item" key={p.slug}><ProductCard product={p} /></div>
          ))}
        </div>
      </section>

      <section className="promo-band reveal">
        <div className="promo-inner">
          <div className="promo-text">
            <span className="promo-kicker">{t("home.promo.kicker")}</span>
            <h2>{t("home.promo.title")}</h2>
            <p>{t("home.promo.text")}</p>
            <div className="promo-cta">
              <Link to="/catalogo" className="btn btn-primary">{t("home.promo.cta1")}</Link>
              <Link to="/catalogo" className="btn btn-outline">{t("home.promo.cta2")}</Link>
            </div>
          </div>
          <div className="promo-art" aria-hidden="true"><span className="promo-emoji">👓</span></div>
        </div>
      </section>

      <section id="marcas" className="section brands-section reveal">
        <div className="section-center">
          <h2 className="section-title">{t("section.brands")}</h2>
          <p className="section-sub">{t("section.brands.sub")}</p>
        </div>
        <div className="brands-layout">
          <div className="brands-circles">
            {BRANDS.map((b) => (
              <Link key={b.slug} to={`/marca/${b.slug}`} title={b.name}
                    className={`brand-circle${hoverBrand === b.slug ? " is-active" : ""}`}
                    onMouseEnter={() => setHoverBrand(b.slug)}
                    onFocus={() => setHoverBrand(b.slug)}>
                <img src={b.logo} alt={b.name} loading="lazy"
                     onError={(e) => { e.currentTarget.style.display = "none"; }} />
              </Link>
            ))}
          </div>
          {(() => {
            const binfo = brandInfo(hoverBrand, lang, hoverBrand);
            return (
              <Link to={`/marca/${hoverBrand}`} className="brand-feature" key={hoverBrand}>
                <img src={brandHeroImage(hoverBrand)} alt={binfo.title} loading="lazy"
                     onError={(e) => { e.currentTarget.style.display = "none"; }} />
                <div className="brand-feature-text">
                  <h3>{binfo.title}</h3>
                  <p>{binfo.desc}</p>
                  <span className="brand-feature-cta">{t("home.brands.cta")}</span>
                </div>
              </Link>
            );
          })()}
        </div>
      </section>

    </div>
  );
}

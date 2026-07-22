import { Link } from "react-router-dom";
import { BRANDS } from "../data/brands.js";
import { PRODUCTS } from "../data/products.js";
import ProductCard from "../components/ProductCard.jsx";
import { useLang } from "../i18n/LanguageContext.jsx";

export default function Home() {
  const { t } = useLang();
  const featured = PRODUCTS.slice(0, 8);

  return (
    <div>
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-text">
            <h1>{t("hero.title").split("\n").map((l, i) => <span key={i}>{l}<br /></span>)}</h1>
            <p>{t("hero.subtitle")}</p>
            <div className="hero-cta">
              <Link to="/catalogo" className="btn btn-primary">{t("hero.cta1")}</Link>
              <Link to="/catalogo?age=Niños" className="btn btn-outline">{t("hero.cta2")}</Link>
            </div>
          </div>
          <div className="hero-art">
            <img src={PRODUCTS[0].colors[0].image} alt="" onError={(e)=>{e.currentTarget.style.visibility='hidden';}} />
          </div>
        </div>
      </section>

      <section id="marcas" className="section">
        <div className="section-center">
          <h2 className="section-title">{t("section.brands")}</h2>
          <p className="section-sub">{t("section.brands.sub")}</p>
        </div>
        <div className="brands-grid">
          {BRANDS.map((b) => (
            <Link key={b.slug} to={`/marca/${b.slug}`} className="brand-chip" title={b.name}>
              <div className="brand-logo-wrap">
                <img src={b.logo} alt={b.name} loading="lazy"
                     onError={(e)=>{e.currentTarget.style.display='none';}} />
              </div>
              <span className="brand-label">{b.name}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">{t("section.bestsellers")}</h2>
          <Link to="/catalogo" className="see-all">{t("section.seeall")}</Link>
        </div>
        <div className="product-grid">
          {featured.map((p) => <ProductCard key={p.slug} product={p} />)}
        </div>
      </section>

      <section className="section props">
        <div className="prop"><span>◈</span><b>{t("prop.ar")}</b><small>{t("prop.ar.sub")}</small></div>
        <div className="prop"><span>℞</span><b>{t("prop.rx")}</b><small>{t("prop.rx.sub")}</small></div>
        <div className="prop"><span>⇄</span><b>{t("prop.warranty")}</b><small>{t("prop.warranty.sub")}</small></div>
        <div className="prop"><span>✈</span><b>{t("prop.ship")}</b><small>{t("prop.ship.sub")}</small></div>
      </section>
    </div>
  );
}

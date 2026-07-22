import { Link } from "react-router-dom";
import { BRANDS } from "../data/brands.js";
import { PRODUCTS } from "../data/products.js";
import ProductCard from "../components/ProductCard.jsx";

export default function Home() {
  const featured = PRODUCTS.slice(0, 8);

  return (
    <div>
      {/* Hero */}
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-text">
            <h1>Espejuelos de marca,<br />hechos para ti</h1>
            <p>Monturas premium de las colecciones Capri Optics. Pruébalas con el probador virtual y añade tus lentes con receta.</p>
            <div className="hero-cta">
              <Link to="/catalogo" className="btn btn-dark">Comprar espejuelos</Link>
              <Link to="/catalogo?age=Niños" className="btn btn-outline">Infantiles</Link>
            </div>
          </div>
          <div className="hero-art">
            <img src={PRODUCTS[0].colors[0].image} alt="Montura destacada"
                 onError={(e)=>{e.currentTarget.style.visibility='hidden';}} />
          </div>
        </div>
      </section>

      {/* Brands */}
      <section id="marcas" className="section">
        <h2 className="section-title">Marcas</h2>
        <div className="brands-grid">
          {BRANDS.map((b) => (
            <Link key={b.slug} to={`/marca/${b.slug}`} className="brand-chip" title={b.name}>
              <img src={b.logo} alt={b.name} loading="lazy"
                   onError={(e)=>{e.currentTarget.replaceWith(document.createTextNode(b.name));}} />
            </Link>
          ))}
        </div>
      </section>

      {/* Featured */}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Los más vendidos</h2>
          <Link to="/catalogo" className="see-all">Ver todo →</Link>
        </div>
        <div className="product-grid">
          {featured.map((p) => <ProductCard key={p.slug} product={p} />)}
        </div>
      </section>

      {/* Value props */}
      <section className="section props">
        <div className="prop"><span>◈</span><b>Probador virtual</b><small>Prueba cualquier montura con tu cámara</small></div>
        <div className="prop"><span>℞</span><b>Lentes con receta</b><small>Sube tu receta y elige tus lentes</small></div>
        <div className="prop"><span>⇄</span><b>30 días de garantía</b><small>Devoluciones sin complicaciones</small></div>
        <div className="prop"><span>✈</span><b>Envío gratis</b><small>En pedidos superiores a $59</small></div>
      </section>
    </div>
  );
}

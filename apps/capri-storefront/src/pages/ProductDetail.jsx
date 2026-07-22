import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { PRODUCT_BY_SLUG, PRODUCTS } from "../data/products.js";
import ProductCard from "../components/ProductCard.jsx";
import { useCart } from "../components/CartContext.jsx";

export default function ProductDetail() {
  const { slug } = useParams();
  const product = PRODUCT_BY_SLUG[slug];
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState(false);
  const { addItem } = useCart();
  const navigate = useNavigate();

  if (!product) {
    return <div className="section"><p>Producto no encontrado. <Link to="/catalogo">Ver catálogo</Link></p></div>;
  }

  const color = product.colors[active];
  const related = PRODUCTS.filter((p) => p.brand_slug === product.brand_slug && p.slug !== product.slug).slice(0, 4);

  return (
    <div className="pdp">
      <div className="breadcrumb">
        <Link to="/">Inicio</Link> / <Link to={`/marca/${product.brand_slug}`}>{product.brand}</Link> / <span>{product.name}</span>
      </div>

      <div className="pdp-grid">
        {/* Gallery */}
        <div className="pdp-gallery">
          <div className={`pdp-main ${zoom ? "zoom" : ""}`} onClick={() => setZoom((z) => !z)}>
            <img key={color.image} src={color.image} alt={`${product.name} ${color.name}`}
                 className="fade-in"
                 onError={(e)=>{e.currentTarget.style.opacity=0.3;}} />
            <span className="pdp-ar">◈ Probador AR</span>
          </div>
          <div className="pdp-thumbs">
            {product.colors.map((c, i) => (
              <button key={c.name} className={`pdp-thumb ${i === active ? "sel" : ""}`} onClick={() => setActive(i)}>
                <img src={c.image} alt={c.name} onError={(e)=>{e.currentTarget.style.opacity=0.3;}} />
              </button>
            ))}
          </div>
        </div>

        {/* Info */}
        <div className="pdp-info">
          <div className="pdp-brand">{product.brand}</div>
          <h1 className="pdp-title">{product.name}</h1>
          <div className="pdp-meta">
            <span className="stars">★ {product.rating}</span>
            <span className="muted">· {product.reviews} reseñas</span>
          </div>
          <div className="pdp-price">${product.price.toFixed(2)} <span className="muted small">montura · lentes desde $6.95</span></div>

          <div className="pdp-color-row">
            <span className="lbl">Color: <b>{color.name}</b></span>
            <div className="swatches lg">
              {product.colors.map((c, i) => (
                <button key={c.name} className={`swatch ${i === active ? "sel" : ""}`} style={{ background: c.hex }}
                        title={c.name} onClick={() => setActive(i)} aria-label={c.name} />
              ))}
            </div>
          </div>

          <div className="pdp-actions">
            <button className="btn btn-dark big" onClick={() => navigate(`/recetas/${product.slug}?color=${active}`)}>
              Seleccionar lentes →
            </button>
            <button className="btn btn-outline big" onClick={() => addItem({ sku: product.sku, name: product.name, color: color.name, total: product.price })}>
              Añadir montura · ${product.price.toFixed(2)}
            </button>
          </div>

          <table className="specs">
            <tbody>
              <tr><td>Marca</td><td>{product.brand}</td></tr>
              <tr><td>Forma</td><td>{product.attributes.shape || "—"}</td></tr>
              <tr><td>Material</td><td>{product.attributes.material.join(", ")}</td></tr>
              <tr><td>Género</td><td>{product.attributes.gender}</td></tr>
              <tr><td>Clase de edad</td><td>{product.attributes.age}</td></tr>
              <tr><td>Tamaño del ojo</td><td>{product.attributes.eye_size}</td></tr>
              <tr><td>Tamaño del puente</td><td>{product.attributes.bridge_size}</td></tr>
              <tr><td>Largo de la sien</td><td>{product.attributes.temple_length}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {related.length > 0 && (
        <section className="section">
          <h2 className="section-title">Más de {product.brand}</h2>
          <div className="product-grid">
            {related.map((p) => <ProductCard key={p.slug} product={p} />)}
          </div>
        </section>
      )}
    </div>
  );
}

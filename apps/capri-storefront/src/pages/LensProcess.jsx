import { useMemo, useState } from "react";
import { useParams, useSearchParams, useNavigate, Link } from "react-router-dom";
import { PRODUCT_BY_SLUG } from "../data/products.js";
import { useCart } from "../components/CartContext.jsx";

const USAGE = [
  { key: "sv-dist", label: "Visión sencilla (lejos)", desc: "Miopía o hipermetropía", price: 6.95 },
  { key: "sv-read", label: "Visión sencilla (lectura)", desc: "Solo para leer", price: 6.95 },
  { key: "progressive", label: "Progresivos", desc: "Lejos + cerca sin línea", price: 49.0 },
  { key: "frame-only", label: "Solo montura", desc: "Sin lentes graduados", price: 0 },
];
const INDEX = [
  { key: "1.50", label: "1.50 estándar", desc: "Recetas bajas", price: 0 },
  { key: "1.59", label: "1.59 policarbonato", desc: "Resistente, ideal niños", price: 20 },
  { key: "1.61", label: "1.61 delgado", desc: "Recetas medias", price: 35 },
  { key: "1.67", label: "1.67 ultradelgado", desc: "Recetas altas", price: 60 },
];
const COATINGS = [
  { key: "ar", label: "Antirreflejo", price: 8 },
  { key: "blue", label: "Filtro luz azul", price: 20 },
  { key: "photo", label: "Fotocromático", price: 45 },
  { key: "tint", label: "Tinte de sol", price: 15 },
];

const STEPS = ["Uso", "Lente", "Receta", "Resumen"];

export default function LensProcess() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const product = PRODUCT_BY_SLUG[slug];
  const colorIdx = Number(params.get("color") || 0);
  const navigate = useNavigate();
  const { addItem } = useCart();

  const [step, setStep] = useState(0);
  const [usage, setUsage] = useState(null);
  const [index, setIndex] = useState(null);
  const [coatings, setCoatings] = useState([]);
  const [rx, setRx] = useState({ od_sph: "", od_cyl: "", od_axis: "", os_sph: "", os_cyl: "", os_axis: "", pd: "", add: "" });
  const [uploaded, setUploaded] = useState(null);

  if (!product) return <div className="section"><p>Producto no encontrado. <Link to="/catalogo">Ver catálogo</Link></p></div>;
  const color = product.colors[colorIdx] || product.colors[0];
  const frameOnly = usage?.key === "frame-only";

  const total = useMemo(() => {
    let t = product.price;
    if (usage) t += usage.price;
    if (index && !frameOnly) t += index.price;
    if (!frameOnly) t += coatings.reduce((s, c) => s + c.price, 0);
    return Math.round(t * 100) / 100;
  }, [product.price, usage, index, coatings, frameOnly]);

  const toggleCoat = (c) =>
    setCoatings((prev) => (prev.find((x) => x.key === c.key) ? prev.filter((x) => x.key !== c.key) : [...prev, c]));

  const canNext =
    (step === 0 && usage) ||
    (step === 1 && (frameOnly || index)) ||
    (step === 2) ||
    step === 3;

  const finish = () => {
    addItem({
      sku: product.sku, name: product.name, color: color.name,
      usage: usage?.label, index: index?.key, coatings: coatings.map((c) => c.label), total,
    });
    alert("¡Añadido al carrito! (demo)");
    navigate(`/producto/${product.slug}`);
  };

  return (
    <div className="lens">
      <div className="lens-head">
        <Link to={`/producto/${product.slug}`} className="back">← Volver a {product.name}</Link>
        <div className="steps">
          {STEPS.map((s, i) => (
            <div key={s} className={`stepdot ${i === step ? "on" : ""} ${i < step ? "done" : ""}`} onClick={() => i < step && setStep(i)}>
              <span>{i < step ? "✓" : i + 1}</span>{s}
            </div>
          ))}
        </div>
      </div>

      <div className="lens-grid">
        <div className="lens-body">
          {step === 0 && (
            <div>
              <h2>¿Para qué usarás tus lentes?</h2>
              <div className="opt-grid">
                {USAGE.map((u) => (
                  <button key={u.key} className={`opt-card ${usage?.key === u.key ? "sel" : ""}`} onClick={() => setUsage(u)}>
                    <b>{u.label}</b><small>{u.desc}</small>
                    <span className="opt-price">{u.price ? `+ $${u.price.toFixed(2)}` : "Incluido"}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <h2>{frameOnly ? "Solo montura seleccionada" : "Elige el material del lente"}</h2>
              {frameOnly ? (
                <p className="muted">Continuarás sin lentes graduados. Puedes pasar al resumen.</p>
              ) : (
                <>
                  <div className="opt-grid">
                    {INDEX.map((ix) => (
                      <button key={ix.key} className={`opt-card ${index?.key === ix.key ? "sel" : ""}`} onClick={() => setIndex(ix)}>
                        <b>{ix.label}</b><small>{ix.desc}</small>
                        <span className="opt-price">{ix.price ? `+ $${ix.price}` : "Incluido"}</span>
                      </button>
                    ))}
                  </div>
                  <h3 className="mt">Tratamientos (opcional)</h3>
                  <div className="coat-row">
                    {COATINGS.map((c) => (
                      <label key={c.key} className={`coat ${coatings.find((x) => x.key === c.key) ? "sel" : ""}`}>
                        <input type="checkbox" checked={!!coatings.find((x) => x.key === c.key)} onChange={() => toggleCoat(c)} />
                        {c.label} <span>+${c.price}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {step === 2 && (
            <div>
              <h2>Tu receta</h2>
              {frameOnly ? (
                <p className="muted">Sin lentes graduados — no se requiere receta.</p>
              ) : (
                <>
                  <div className="rx-upload">
                    <label className="upload-box">
                      <input type="file" accept="image/*,application/pdf" hidden
                             onChange={(e) => setUploaded(e.target.files?.[0]?.name || null)} />
                      <span>📤 Sube una foto de tu receta</span>
                      <small>{uploaded ? `Archivo: ${uploaded}` : "La leeremos automáticamente (OCR)"}</small>
                    </label>
                    <span className="or">o ingrésala manualmente</span>
                  </div>
                  <table className="rx-table">
                    <thead><tr><th></th><th>ESF (SPH)</th><th>CIL (CYL)</th><th>EJE (AXIS)</th></tr></thead>
                    <tbody>
                      <tr>
                        <td>OD (derecho)</td>
                        <td><input value={rx.od_sph} onChange={(e) => setRx({ ...rx, od_sph: e.target.value })} placeholder="0.00" /></td>
                        <td><input value={rx.od_cyl} onChange={(e) => setRx({ ...rx, od_cyl: e.target.value })} placeholder="0.00" /></td>
                        <td><input value={rx.od_axis} onChange={(e) => setRx({ ...rx, od_axis: e.target.value })} placeholder="0" /></td>
                      </tr>
                      <tr>
                        <td>OS (izquierdo)</td>
                        <td><input value={rx.os_sph} onChange={(e) => setRx({ ...rx, os_sph: e.target.value })} placeholder="0.00" /></td>
                        <td><input value={rx.os_cyl} onChange={(e) => setRx({ ...rx, os_cyl: e.target.value })} placeholder="0.00" /></td>
                        <td><input value={rx.os_axis} onChange={(e) => setRx({ ...rx, os_axis: e.target.value })} placeholder="0" /></td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="rx-extra">
                    <label>DP (PD) <input value={rx.pd} onChange={(e) => setRx({ ...rx, pd: e.target.value })} placeholder="63" /></label>
                    <label>ADD <input value={rx.add} onChange={(e) => setRx({ ...rx, add: e.target.value })} placeholder="+2.00" /></label>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div>
              <h2>Resumen del pedido</h2>
              <ul className="summary">
                <li><span>Montura {product.name} · {color.name}</span><b>${product.price.toFixed(2)}</b></li>
                {usage && <li><span>Uso: {usage.label}</span><b>{usage.price ? `$${usage.price.toFixed(2)}` : "Incluido"}</b></li>}
                {index && !frameOnly && <li><span>Lente {index.label}</span><b>{index.price ? `$${index.price}` : "Incluido"}</b></li>}
                {!frameOnly && coatings.map((c) => <li key={c.key}><span>{c.label}</span><b>${c.price}</b></li>)}
              </ul>
              <p className="muted small">Los precios de lentes se calculan en el servidor en la versión conectada al backend Medusa.</p>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="lens-side">
          <img src={color.image} alt={product.name} onError={(e)=>{e.currentTarget.style.opacity=0.3;}} />
          <div className="lens-side-name">{product.name} · {color.name}</div>
          <div className="lens-side-total"><span>Total</span><b>${total.toFixed(2)}</b></div>
          <div className="lens-nav">
            {step > 0 && <button className="btn btn-outline" onClick={() => setStep((s) => s - 1)}>Atrás</button>}
            {step < 3 ? (
              <button className="btn btn-dark" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>Continuar</button>
            ) : (
              <button className="btn btn-dark" onClick={finish}>Añadir al carrito</button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

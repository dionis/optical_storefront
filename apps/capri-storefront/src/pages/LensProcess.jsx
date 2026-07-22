import { useMemo, useState } from "react";
import { useParams, useSearchParams, useNavigate, Link } from "react-router-dom";
import { PRODUCT_BY_SLUG } from "../data/products.js";
import { useCart } from "../components/CartContext.jsx";
import { useLang } from "../i18n/LanguageContext.jsx";

const USAGE = [
  { key: "sv-dist", label: "usage.svDist", desc: "usage.svDist.d", price: 6.95 },
  { key: "sv-read", label: "usage.svRead", desc: "usage.svRead.d", price: 6.95 },
  { key: "progressive", label: "usage.prog", desc: "usage.prog.d", price: 49.0 },
  { key: "frame-only", label: "usage.frame", desc: "usage.frame.d", price: 0 },
];
const INDEX = [
  { key: "1.50", label: "idx.std", desc: "idx.std.d", price: 0 },
  { key: "1.59", label: "idx.poly", desc: "idx.poly.d", price: 20 },
  { key: "1.61", label: "idx.thin", desc: "idx.thin.d", price: 35 },
  { key: "1.67", label: "idx.ultra", desc: "idx.ultra.d", price: 60 },
];
const COATINGS = [
  { key: "ar", label: "coat.ar", price: 8 },
  { key: "blue", label: "coat.blue", price: 20 },
  { key: "photo", label: "coat.photo", price: 45 },
  { key: "tint", label: "coat.tint", price: 15 },
];

export default function LensProcess() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const { t } = useLang();
  const product = PRODUCT_BY_SLUG[slug];
  const colorIdx = Number(params.get("color") || 0);
  const navigate = useNavigate();
  const { addItem } = useCart();

  const STEPS = [t("lens.step.use"), t("lens.step.lens"), t("lens.step.rx"), t("lens.step.summary")];
  const [step, setStep] = useState(0);
  const [usage, setUsage] = useState(null);
  const [index, setIndex] = useState(null);
  const [coatings, setCoatings] = useState([]);
  const [rx, setRx] = useState({ od_sph: "", od_cyl: "", od_axis: "", os_sph: "", os_cyl: "", os_axis: "", pd: "", add: "" });
  const [uploaded, setUploaded] = useState(null);

  if (!product) return <div className="section"><p>{t("notfound")} <Link to="/catalogo">{t("notfound.link")}</Link></p></div>;
  const color = product.colors[colorIdx] || product.colors[0];
  const frameOnly = usage?.key === "frame-only";

  const total = useMemo(() => {
    let x = product.price;
    if (usage) x += usage.price;
    if (index && !frameOnly) x += index.price;
    if (!frameOnly) x += coatings.reduce((s, c) => s + c.price, 0);
    return Math.round(x * 100) / 100;
  }, [product.price, usage, index, coatings, frameOnly]);

  const toggleCoat = (c) =>
    setCoatings((prev) => (prev.find((x) => x.key === c.key) ? prev.filter((x) => x.key !== c.key) : [...prev, c]));

  const canNext = (step === 0 && usage) || (step === 1 && (frameOnly || index)) || step === 2 || step === 3;

  const finish = () => {
    addItem({ sku: product.sku, name: product.name, color: color.name, usage: usage?.key, index: index?.key, total });
    alert(t("lens.added"));
    navigate(`/producto/${product.slug}`);
  };
  const money = (v) => (v ? `+ $${v.toFixed ? v.toFixed(2) : v}` : t("lens.included"));

  return (
    <div className="lens">
      <div className="lens-head">
        <Link to={`/producto/${product.slug}`} className="back">← {t("lens.back")} {product.name}</Link>
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
              <h2>{t("lens.q.use")}</h2>
              <div className="opt-grid">
                {USAGE.map((u) => (
                  <button key={u.key} className={`opt-card ${usage?.key === u.key ? "sel" : ""}`} onClick={() => setUsage(u)}>
                    <b>{t(u.label)}</b><small>{t(u.desc)}</small>
                    <span className="opt-price">{u.price ? `+ $${u.price.toFixed(2)}` : t("lens.included")}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <h2>{frameOnly ? t("lens.frameOnlyTitle") : t("lens.q.lens")}</h2>
              {frameOnly ? (
                <p className="muted">{t("lens.frameOnlyDesc")}</p>
              ) : (
                <>
                  <div className="opt-grid">
                    {INDEX.map((ix) => (
                      <button key={ix.key} className={`opt-card ${index?.key === ix.key ? "sel" : ""}`} onClick={() => setIndex(ix)}>
                        <b>{t(ix.label)}</b><small>{t(ix.desc)}</small>
                        <span className="opt-price">{ix.price ? `+ $${ix.price}` : t("lens.included")}</span>
                      </button>
                    ))}
                  </div>
                  <h3 className="mt">{t("lens.treatments")}</h3>
                  <div className="coat-row">
                    {COATINGS.map((c) => (
                      <label key={c.key} className={`coat ${coatings.find((x) => x.key === c.key) ? "sel" : ""}`}>
                        <input type="checkbox" checked={!!coatings.find((x) => x.key === c.key)} onChange={() => toggleCoat(c)} />
                        {t(c.label)} <span>+${c.price}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {step === 2 && (
            <div>
              <h2>{t("lens.q.rx")}</h2>
              {frameOnly ? (
                <p className="muted">{t("lens.rx.none")}</p>
              ) : (
                <>
                  <div className="rx-upload">
                    <label className="upload-box">
                      <input type="file" accept="image/*,application/pdf" hidden
                             onChange={(e) => setUploaded(e.target.files?.[0]?.name || null)} />
                      <span>📤 {t("lens.upload")}</span>
                      <small>{uploaded ? `${t("lens.upload.file")}: ${uploaded}` : t("lens.upload.sub")}</small>
                    </label>
                    <span className="or">{t("lens.or")}</span>
                  </div>
                  <table className="rx-table">
                    <thead><tr><th></th><th>ESF/SPH</th><th>CIL/CYL</th><th>EJE/AXIS</th></tr></thead>
                    <tbody>
                      <tr>
                        <td>{t("lens.right")}</td>
                        <td><input value={rx.od_sph} onChange={(e) => setRx({ ...rx, od_sph: e.target.value })} placeholder="0.00" /></td>
                        <td><input value={rx.od_cyl} onChange={(e) => setRx({ ...rx, od_cyl: e.target.value })} placeholder="0.00" /></td>
                        <td><input value={rx.od_axis} onChange={(e) => setRx({ ...rx, od_axis: e.target.value })} placeholder="0" /></td>
                      </tr>
                      <tr>
                        <td>{t("lens.left")}</td>
                        <td><input value={rx.os_sph} onChange={(e) => setRx({ ...rx, os_sph: e.target.value })} placeholder="0.00" /></td>
                        <td><input value={rx.os_cyl} onChange={(e) => setRx({ ...rx, os_cyl: e.target.value })} placeholder="0.00" /></td>
                        <td><input value={rx.os_axis} onChange={(e) => setRx({ ...rx, os_axis: e.target.value })} placeholder="0" /></td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="rx-extra">
                    <label>DP/PD <input value={rx.pd} onChange={(e) => setRx({ ...rx, pd: e.target.value })} placeholder="63" /></label>
                    <label>ADD <input value={rx.add} onChange={(e) => setRx({ ...rx, add: e.target.value })} placeholder="+2.00" /></label>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div>
              <h2>{t("lens.summary")}</h2>
              <ul className="summary">
                <li><span>{t("card.frame")} {product.name} · {color.name}</span><b>${product.price.toFixed(2)}</b></li>
                {usage && <li><span>{t("lens.use")}: {t(usage.label)}</span><b>{usage.price ? `$${usage.price.toFixed(2)}` : t("lens.included")}</b></li>}
                {index && !frameOnly && <li><span>{t("lens.lens")} {t(index.label)}</span><b>{index.price ? `$${index.price}` : t("lens.included")}</b></li>}
                {!frameOnly && coatings.map((c) => <li key={c.key}><span>{t(c.label)}</span><b>${c.price}</b></li>)}
              </ul>
              <p className="muted small">{t("lens.note")}</p>
            </div>
          )}
        </div>

        <aside className="lens-side">
          <img src={color.image} alt={product.name} onError={(e)=>{e.currentTarget.style.opacity=0.3;}} />
          <div className="lens-side-name">{product.name} · {color.name}</div>
          <div className="lens-side-total"><span>{t("lens.total")}</span><b>${total.toFixed(2)}</b></div>
          <div className="lens-nav">
            {step > 0 && <button className="btn btn-outline" onClick={() => setStep((s) => s - 1)}>{t("lens.back2")}</button>}
            {step < 3 ? (
              <button className="btn btn-primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>{t("lens.continue")}</button>
            ) : (
              <button className="btn btn-primary" onClick={finish}>{t("lens.addCart")}</button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
